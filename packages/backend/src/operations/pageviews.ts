import { createHash } from "node:crypto";
import { sql } from "../db.ts";
import { credential } from "../config.ts";

export function pageVisitorHash(ip: string, ua: string, date = new Date(), secret = credential("auth", "SESSION_SECRET") ?? "dev-feedback-secret"): string {
  const day = date.toISOString().slice(0, 10);
  const salt = createHash("sha256").update(`${secret}:${day}`).digest("hex");
  return createHash("sha256").update(`${salt}:${ip}:${ua}`).digest("hex");
}
export async function recordPageView(input: { path: string; referrer?: string | null; ip: string; ua: string; device: "mobile" | "tablet" | "desktop"; country?: string | null }): Promise<"stored" | "limited" | "ignored"> {
  if (input.path.startsWith("/admin") || input.path.startsWith("/api/") || input.path.length > 500) return "ignored";
  const visitor = pageVisitorHash(input.ip, input.ua);
  const referrerHost = (() => { try { return input.referrer ? new URL(input.referrer).hostname.slice(0, 253) : null; } catch { return null; } })();
  const itemId = /^\/items\/([a-zA-Z0-9_-]{1,80})(?:\/|$)/.exec(input.path)?.[1] ?? null;
  const result = await sql<{ id: number }[]>`INSERT INTO page_views (path,item_id,referrer_host,device,visitor_day_hash,country)
    SELECT ${input.path},${itemId},${referrerHost},${input.device},${visitor},${input.country ?? null}
    WHERE (SELECT count(*) FROM page_views WHERE visitor_day_hash=${visitor} AND at > now()-interval '1 minute') < 120 RETURNING id`;
  return result.length ? "stored" : "limited";
}
export async function prunePageViews(): Promise<void> { await sql`DELETE FROM page_views WHERE at < now()-interval '90 days'`; }
