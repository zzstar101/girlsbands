// Feedback: content, optional email, page URL, one optional screenshot. The screenshot
// goes to the internal Feishu chat and only its image key is stored. Abuse control uses an unreadable
// source identifier (HMAC of client IP + UA family), per-source bans and a per-minute limit.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.ts";
import { Rejected, rateLimit, sourceFingerprint } from "./abuse.ts";
import { sql } from "../db.ts";
import { feishuInternalEnabled, forwardFeedbackToFeishu } from "../notify/feishu.ts";

/** 反馈被拒绝的公开错误；与订阅共用同一套 429/400 语义。 */
export { Rejected as FeedbackRejected } from "./abuse.ts";

/** The picture's real type from its first bytes (what the browser claimed is not trusted). */
export function sniffImageType(data: Buffer): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString("latin1"))) return "image/gif";
  return null;
}

/** What a reader can be pointing at (W18): a piece of content, or a source they want us to add. */
export const FEEDBACK_TARGET_KINDS = ["article", "story", "topic", "release", "live", "venue", "source"] as const;
/** Which part of that content they say is wrong. */
export const FEEDBACK_TARGET_FIELDS = ["title", "date", "venue", "price", "translation", "category", "duplicate", "other"] as const;

export interface FeedbackInput {
  content: string;
  email?: string | null;
  pageUrl?: string | null;
  screenshot?: { mime: string; data: Buffer } | null;
  /** Set by the "报告问题" dialog: which content and which part of it. Null on the plain form. */
  targetKind?: string | null;
  targetId?: string | null;
  targetField?: string | null;
  /** What the reader says it should be. */
  expected?: string | null;
  ip: string;
  userAgent: string;
}

function targetOf(input: FeedbackInput): { kind: string | null; id: string | null; field: string | null; expected: string | null } {
  const kind = input.targetKind?.trim() || null;
  const id = input.targetId?.trim().slice(0, 200) || null;
  const field = input.targetField?.trim() || null;
  const expected = input.expected?.trim().slice(0, 500) || null;
  if (kind && !(FEEDBACK_TARGET_KINDS as readonly string[]).includes(kind)) throw new Rejected(400, "invalid_request", "纠错目标不正确。");
  if (field && !(FEEDBACK_TARGET_FIELDS as readonly string[]).includes(field)) throw new Rejected(400, "invalid_request", "纠错类型不正确。");
  // "哪里错了" without "说的是哪一条" cannot be acted on: refuse rather than store a half record.
  if (!kind && (id || field || expected)) throw new Rejected(400, "invalid_request", "请说明这条纠错是针对哪一条内容。");
  return { kind, id, field, expected };
}

export async function submitFeedback(input: FeedbackInput): Promise<{ id: number }> {
  const content = input.content.trim();
  if (content.length < 2) throw new Rejected(400, "invalid_request", "请写下反馈内容。");
  if (content.length > 5000) throw new Rejected(400, "invalid_request", "反馈内容最多 5000 字。");
  const email = input.email?.trim() || null;
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Rejected(400, "invalid_request", "邮箱格式不正确。");
  const pageUrl = input.pageUrl?.trim().slice(0, 500) || null;
  const target = targetOf(input);
  const source = sourceFingerprint(input.ip, input.userAgent);
  const [banned] = await sql`SELECT 1 FROM feedback_bans WHERE source_hash = ${source}`;
  if (banned) throw new Rejected(403, "forbidden", "暂时无法提交反馈。");
  rateLimit(source);

  let screenshotKey: string | null = null;
  if (input.screenshot) {
    // Some phones send JPEGs as image/jpg or with no type at all: the bytes decide.
    const mime = sniffImageType(input.screenshot.data);
    if (!mime) throw new Rejected(400, "invalid_request", "截图需要是 PNG、JPG、WebP 或 GIF。");
    if (input.screenshot.data.length > 8 * 1024 * 1024) throw new Rejected(400, "invalid_request", "截图最大 8MB。");
    // The first bytes are not enough: a PNG signature followed by noise would be kept and offered to
    // Feishu again and again. Decoding the whole picture settles it (a long phone capture fits the cap).
    const decodes = await sharp(input.screenshot.data, { limitInputPixels: 60_000_000, failOn: "error" }).stats().then(() => true, () => false);
    if (!decodes) throw new Rejected(400, "invalid_request", "截图无法识别，请换一张图片。");
    // Stored locally only until it is forwarded (notify/feishu.ts); the database keeps only an identifier.
    // Forwarding or erasing one feedback removes its file, even if another used the same picture.
    const name = `${randomUUID()}.${mime.split("/")[1]}`;
    const dir = path.join(config.dataDir, "feedback-screenshots");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), input.screenshot.data);
    screenshotKey = `local:${name}`;
  }
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO feedback (content, email, page_url, screenshot_key, source_hash, forward_error,
                          target_kind, target_id, target_field, expected)
    VALUES (${content}, ${email}, ${pageUrl}, ${screenshotKey}, ${source}, 'pending',
            ${target.kind}, ${target.id}, ${target.field}, ${target.expected}) RETURNING id`;
  const id = row!.id;
  void forwardFeedbackToFeishu(id).catch(() => {});
  return { id };
}

/**
 * Every few minutes: feedback that did not reach the internal chat (Feishu down, a screenshot upload
 * failing) is tried again for a week. Newer than a few minutes is still being sent by its submission.
 */
export async function forwardPendingFeedback(): Promise<{ sent: number; failed: number }> {
  if (!feishuInternalEnabled()) return { sent: 0, failed: 0 };
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM feedback WHERE forwarded_at IS NULL AND forward_error IS NOT NULL
      AND created_at < now() - interval '5 minutes' AND created_at > now() - interval '7 days'
    ORDER BY id LIMIT 20`;
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      if ((await forwardFeedbackToFeishu(r.id)) === "sent") sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}
