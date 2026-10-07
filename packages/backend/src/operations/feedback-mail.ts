// Feedback by email: every new feedback is forwarded to the owner's mailbox (FEEDBACK_EMAIL), with the
// screenshot attached, so it arrives even where the internal Feishu chat is not set up. The admin page
// can answer a reader who left an address; the answer goes out from the site's address and is logged in
// feedback_replies.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "@girlsbands/industry/site";
import { beijingDate, beijingTime } from "@girlsbands/contracts/time";
import { audit } from "../audit.ts";
import { config, credential } from "../config.ts";
import { sql } from "../db.ts";
import { send } from "../subscriptions/send.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The owner's mailbox for feedback; unset means feedback is not emailed. */
export function feedbackEmail(): string | null {
  return credential("integrations", "FEEDBACK_EMAIL") || null;
}

/**
 * Emails one feedback to the owner, once. Throws when sending fails, so the forwarding sweep tries again.
 * The reader's address is the Reply-To, which makes a quick answer from the mailbox possible as well.
 */
export async function forwardFeedbackByEmail(id: number): Promise<"sent" | "disabled"> {
  const to = feedbackEmail();
  if (!to) return "disabled";
  const [fb] = await sql<{ id: number; content: string; email: string | null; page_url: string | null; screenshot_key: string | null; created_at: Date; target_kind: string | null; target_id: string | null; target_field: string | null; expected: string | null }[]>`
    SELECT id, content, email, page_url, screenshot_key, created_at, target_kind, target_id, target_field, expected
    FROM feedback WHERE id = ${id} AND emailed_at IS NULL`;
  if (!fb) return "disabled";
  const lines: Array<[string, string]> = [];
  if (fb.target_kind) {
    lines.push(["针对", `${[fb.target_kind, fb.target_id].filter(Boolean).join(" ")}${fb.target_field ? ` · ${fb.target_field}` : ""}${fb.expected ? ` → ${fb.expected}` : ""}`]);
  }
  lines.push(["页面", fb.page_url ?? "—"], ["邮箱", fb.email ?? "（未留）"], ["时间", `${beijingDate(fb.created_at)} ${beijingTime(fb.created_at)}（北京时间）`]);
  const admin = `${config.siteUrl}/admin/feedback`;

  const attachments: Array<{ filename: string; content: Buffer }> = [];
  if (fb.screenshot_key?.startsWith("local:")) {
    const name = fb.screenshot_key.slice("local:".length);
    if (/^[\w.-]+$/.test(name)) {
      const data = await readFile(path.join(config.dataDir, "feedback-screenshots", name)).catch(() => null);
      if (data) attachments.push({ filename: `feedback-${fb.id}${path.extname(name)}`, content: data });
    }
  }
  const head = fb.content.replace(/\s+/g, " ").slice(0, 40);
  const result = await send({
    to,
    replyTo: fb.email,
    subject: `[反馈 #${fb.id}] ${head}`,
    text: `${fb.content}\n\n${lines.map(([k, v]) => `${k}：${v}`).join("\n")}${attachments.length ? "\n截图：见附件" : ""}\n\n在后台处理与回复：${admin}`,
    html: `<div style="font:15px/1.7 -apple-system,'PingFang SC',sans-serif;color:#111">
<p style="white-space:pre-wrap;margin:0 0 16px">${esc(fb.content)}</p>
<table style="font-size:13px;color:#555;border-collapse:collapse">${lines.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;white-space:nowrap">${k}</td><td>${/^https?:/.test(v) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v)}</td></tr>`).join("")}</table>
${attachments.length ? `<p style="font-size:13px;color:#555">截图：见附件</p>` : ""}
<p style="margin-top:20px"><a href="${admin}" style="color:#e4006f">在后台处理与回复 →</a></p></div>`,
    attachments,
  });
  if (result.status !== "sent") throw new Error(`feedback email: ${result.response}`);
  await sql`UPDATE feedback SET emailed_at = now() WHERE id = ${id}`;
  return "sent";
}

/** A reply that cannot be sent as asked; the admin API answers 400 (statusCode). */
export class ReplyRefused extends Error {
  statusCode = 400;
}

/** Answers a reader from the site's address, logs the answer, and marks the feedback as replied. */
export async function replyFeedback(id: number, body: string, actor: string): Promise<{ status: "sent" | "failed"; response: string } | null> {
  const text = body.trim();
  if (!text) throw new ReplyRefused("回复内容不能为空");
  if (text.length > 5000) throw new ReplyRefused("回复最多 5000 字");
  const [fb] = await sql<{ id: number; content: string; email: string | null; created_at: Date }[]>`
    SELECT id, content, email, created_at FROM feedback WHERE id = ${id}`;
  if (!fb) return null;
  if (!fb.email) throw new ReplyRefused("这条反馈没有留邮箱，无法回复");
  const quote = fb.content.length > 600 ? `${fb.content.slice(0, 600)}…` : fb.content;
  const when = beijingDate(fb.created_at);
  const result = await send({
    to: fb.email,
    subject: `回复：你在 ${SITE.name} 的反馈`,
    text: `${text}\n\n—— ${SITE.name}\n${config.siteUrl}\n\n你在 ${when} 写道：\n${quote.split("\n").map((l) => `> ${l}`).join("\n")}`,
    html: `<div style="font:15px/1.75 -apple-system,'PingFang SC',sans-serif;color:#111;max-width:560px">
<p style="white-space:pre-wrap;margin:0">${esc(text)}</p>
<p style="margin:20px 0 0;color:#555">—— <a href="${config.siteUrl}" style="color:#e4006f;text-decoration:none">${esc(SITE.name)}</a></p>
<div style="margin-top:28px;padding:10px 14px;border-left:3px solid #ddd;color:#777;font-size:13px">
<div style="margin-bottom:4px">你在 ${when} 写道：</div><div style="white-space:pre-wrap">${esc(quote)}</div></div></div>`,
  });
  await sql.begin(async (tx) => {
    await tx`INSERT INTO feedback_replies (feedback_id, body, actor, status, response) VALUES (${id}, ${text}, ${actor}, ${result.status}, ${result.response})`;
    if (result.status === "sent") await tx`UPDATE feedback SET status = 'replied', updated_at = now() WHERE id = ${id}`;
    await audit(actor, "feedback.reply", `feedback:${id}`, null, null, { status: result.status }, { db: tx });
  });
  return result;
}
