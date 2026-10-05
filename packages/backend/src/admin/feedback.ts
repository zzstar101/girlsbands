// Feedback handling: list, status and note, per-source bans, and deletion on request
// (privacy notice: feedback material is removed once handling ends or when the sender asks).
import type { AdminFeedback, AdminFeedbackTargets, BeforeJson } from "@girlsbands/contracts/admin";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { audit, Conflict } from "../audit.ts";

export const FEEDBACK_STATUSES = ["new", "triaged", "replied", "resolved", "spam"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export async function listFeedback(f: { status?: string; q?: string; page?: number }): Promise<BeforeJson<AdminFeedback>> {
  const page = Math.max(1, f.page ?? 1);
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const rows = await sql<BeforeJson<AdminFeedback["rows"][number]>[]>`
    SELECT fb.id, fb.content, fb.email, fb.page_url, split_part(fb.screenshot_key, ':', 1) AS screenshot, fb.source_hash, fb.status, fb.note,
           fb.forwarded_at, fb.forward_error, fb.created_at, fb.updated_at,
           fb.target_kind, fb.target_id, fb.target_field, fb.expected,
           EXISTS (SELECT 1 FROM feedback_bans b WHERE b.source_hash = fb.source_hash) AS banned,
           (SELECT count(*)::int FROM feedback o WHERE o.source_hash = fb.source_hash) AS from_source
    FROM feedback fb
    WHERE (${f.status ?? null}::text IS NULL OR fb.status = ${f.status ?? null})
      AND (${q}::text IS NULL OR fb.content ILIKE ${q} OR fb.email ILIKE ${q} OR fb.page_url ILIKE ${q})
    ORDER BY fb.created_at DESC LIMIT 50 OFFSET ${(page - 1) * 50}`;
  const counts = await sql<{ status: string; n: number }[]>`SELECT status, count(*)::int AS n FROM feedback GROUP BY 1`;
  const bans = await sql<BeforeJson<AdminFeedback["bans"][number]>[]>`SELECT source_hash, reason, created_by, created_at FROM feedback_bans ORDER BY created_at DESC LIMIT 100`;
  return { page, rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), bans };
}

/**
 * The same feedback, seen by what it is about (W18): corrections aimed at one piece of content are put
 * side by side, so the admin can act on one edit instead of reading the same complaint three times.
 * Sorted by how many different people said it, because that is the closest thing to a priority.
 *
 * Source submissions (`/submit`) are not grouped: they point at nothing on the site yet, so each one is
 * its own lead and they are listed by time instead.
 */
export async function listFeedbackTargets(): Promise<BeforeJson<AdminFeedbackTargets>> {
  const groups = await sql<BeforeJson<AdminFeedbackTargets["groups"][number]>[]>`
    SELECT fb.target_kind, fb.target_id, count(*)::int AS n, count(DISTINCT fb.source_hash)::int AS sources,
           max(fb.created_at) AS latest,
           json_agg(json_build_object(
             'id', fb.id, 'content', fb.content, 'email', fb.email, 'page_url', fb.page_url,
             'screenshot', split_part(fb.screenshot_key, ':', 1), 'source_hash', fb.source_hash,
             'status', fb.status, 'note', fb.note, 'forwarded_at', fb.forwarded_at, 'forward_error', fb.forward_error,
             'created_at', fb.created_at, 'updated_at', fb.updated_at,
             'target_kind', fb.target_kind, 'target_id', fb.target_id, 'target_field', fb.target_field, 'expected', fb.expected,
             'banned', EXISTS (SELECT 1 FROM feedback_bans b WHERE b.source_hash = fb.source_hash),
             'from_source', (SELECT count(*)::int FROM feedback o WHERE o.source_hash = fb.source_hash)
           ) ORDER BY fb.created_at DESC) AS rows
    FROM feedback fb
    WHERE fb.target_kind IS NOT NULL AND fb.target_kind <> 'source'
    GROUP BY fb.target_kind, fb.target_id
    ORDER BY sources DESC, latest DESC LIMIT 50`;
  const submissions = await sql<BeforeJson<AdminFeedbackTargets["submissions"]>>`
    SELECT fb.id, fb.content, fb.email, fb.page_url, split_part(fb.screenshot_key, ':', 1) AS screenshot, fb.source_hash, fb.status, fb.note,
           fb.forwarded_at, fb.forward_error, fb.created_at, fb.updated_at,
           fb.target_kind, fb.target_id, fb.target_field, fb.expected,
           EXISTS (SELECT 1 FROM feedback_bans b WHERE b.source_hash = fb.source_hash) AS banned,
           (SELECT count(*)::int FROM feedback o WHERE o.source_hash = fb.source_hash) AS from_source
    FROM feedback fb WHERE fb.target_kind = 'source' ORDER BY fb.created_at DESC LIMIT 50`;
  return { groups, submissions };
}

export async function updateFeedback(id: number, input: { status?: string; note?: string | null; version: string }, actor: string) {
  if (input.status && !FEEDBACK_STATUSES.includes(input.status as FeedbackStatus)) throw new Error(`unknown status ${input.status}`);
  return sql.begin(async (tx) => {
    const [before] = await tx`SELECT id, status, note, updated_at FROM feedback WHERE id = ${id} FOR UPDATE`;
    if (!before) return null;
    if (new Date(before.updated_at as Date).toISOString() !== input.version) throw new Conflict("这条反馈已被修改，请刷新后再操作");
    const [after] = await tx`
      UPDATE feedback SET status = coalesce(${input.status ?? null}, status), note = ${input.note === undefined ? before.note : input.note}, updated_at = now()
      WHERE id = ${id} RETURNING id, status, note, updated_at`;
    await audit(actor, "feedback.update", `feedback:${id}`, null, { status: before.status, note: before.note }, { status: after!.status, note: after!.note }, { db: tx });
    return after;
  });
}

/** Refuses further feedback from one source (an unreadable hash of IP and browser family). */
export async function banSource(sourceHash: string, reason: string, actor: string) {
  if (!reason.trim()) throw new Error("reason is required");
  await sql`INSERT INTO feedback_bans (source_hash, reason, created_by) VALUES (${sourceHash}, ${reason}, ${actor}) ON CONFLICT (source_hash) DO NOTHING`;
  await audit(actor, "feedback.ban", `feedback-source:${sourceHash}`, reason, null, null);
}

export async function unbanSource(sourceHash: string, actor: string) {
  const rows = await sql`DELETE FROM feedback_bans WHERE source_hash = ${sourceHash} RETURNING reason`;
  if (rows.length) await audit(actor, "feedback.unban", `feedback-source:${sourceHash}`, null, { reason: rows[0]!.reason }, null);
}

function screenshotPath(key: string | null): string | null {
  if (!key?.startsWith("local:")) return null;
  const name = key.slice("local:".length);
  return /^[\w.-]+$/.test(name) ? path.join(config.dataDir, "feedback-screenshots", name) : null;
}

export async function feedbackScreenshot(id: number): Promise<string | null> {
  const [row] = await sql<{ screenshot_key: string | null }[]>`SELECT screenshot_key FROM feedback WHERE id = ${id}`;
  return screenshotPath(row?.screenshot_key ?? null);
}

/** Removes the sender's material (text, email, page, screenshot) and keeps only the handling record. */
export async function eraseFeedback(id: number, reason: string, actor: string) {
  if (!reason.trim()) throw new Error("reason is required");
  const [row] = await sql<{ screenshot_key: string | null }[]>`SELECT screenshot_key FROM feedback WHERE id = ${id}`;
  if (!row) return null;
  const file = screenshotPath(row.screenshot_key);
  if (file) await unlink(file).catch(() => {});
  await sql`UPDATE feedback SET content = '（已按要求删除）', email = NULL, page_url = NULL, screenshot_key = NULL, updated_at = now() WHERE id = ${id}`;
  await audit(actor, "feedback.erase", `feedback:${id}`, reason, null, null);
  return { erased: true };
}
