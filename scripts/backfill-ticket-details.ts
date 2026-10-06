// 补抓会员购与 allcpp 详情；正文经 upsertMaterial 形成修订并重新分析。
// node --env-file=.env scripts/backfill-ticket-details.ts [--limit N] [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { upsertMaterial } from "@girlsbands/backend/content/materials";
import { fetchTicketDetail, type DetailAdapter } from "@girlsbands/backend/sources/detail-adapters";
import { stopBoss } from "@girlsbands/backend/jobs/queue";

const args = process.argv.slice(2);
const value = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const limit = Math.max(1, Number(value("--limit") ?? 1000));
const dry = args.includes("--dry");
const sources = [
  { id: "json-bilibili-show", adapter: "bilibili-show" as const },
  { id: "json-cpp-only-events", adapter: "allcpp-event" as const },
];
let attempted = 0, updated = 0, missing = 0;
for (const source of sources) {
  const rows = await sql<{ id: string; url: string; title: string; excerpt: string | null; published_at: Date | null; author: string | null; media: unknown }[]>`
    SELECT id, url, title, excerpt, published_at, author, media FROM articles
    WHERE source_id = ${source.id} ORDER BY discovered_at DESC LIMIT ${limit}`;
  for (const row of rows) {
    const id = new URL(row.url).searchParams.get(source.adapter === "allcpp-event" ? "event" : "id");
    if (!id) { missing += 1; continue; }
    attempted += 1;
    let detail;
    try { detail = await fetchTicketDetail(source.adapter as DetailAdapter, id); } catch { detail = null; }
    if (!detail) { missing += 1; continue; }
    if (dry) { console.log(`would update ${row.id}: ${row.title}`); continue; }
    await upsertMaterial({ sourceId: source.id, url: row.url, title: detail.title || row.title, author: row.author,
      publishedAt: row.published_at, excerpt: row.excerpt, bodyHtml: detail.bodyHtml, bodyText: detail.bodyText,
      bodyStatus: "ok", media: detail.media, via: "fetch", id: row.id });
    updated += 1;
  }
}
console.log(`ticket details: attempted ${attempted}, ${dry ? "would update" : "updated"} ${dry ? attempted - missing : updated}, missing ${missing}`);
await stopBoss();
await closeDb();
