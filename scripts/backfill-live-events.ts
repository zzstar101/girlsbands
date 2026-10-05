// 回填 facts.live_event_id：W8 之前归好的事实里，有些本来就够得着演出身份（公告写了哪天、哪场），
// 不必等下一篇报告才认出来。可重复跑，已挂上的只补空字段（lives/link.ts 的 patchLiveEvent）。
//   node --env-file=.env scripts/backfill-live-events.ts [--limit N] [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { linkLiveEvent } from "@girlsbands/backend/events/live";

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 500;
const dry = args.includes("--dry");

// 一条事实只挑一个报告：优先已选入的，其次最新一次分析（同一个条目可能有两次分析）。
const rows = await sql<{ fact_id: number; article_id: string }[]>`
  SELECT DISTINCT ON (f.id) f.id AS fact_id, p.article_id
  FROM facts f
  JOIN fact_articles fa ON fa.fact_id = f.id
  JOIN publications p ON p.article_id = fa.article_id
  JOIN analyses an ON an.article_id = p.article_id
  WHERE f.live_event_id IS NULL AND an.output->'fact'->'deadlines' @> '[{"kind":"event"}]'::jsonb
  ORDER BY f.id, p.selected DESC, an.input_revision DESC
  LIMIT ${limit}`;

console.log(`candidates: ${rows.length}`);
if (dry) {
  for (const r of rows) console.log(`${r.fact_id}\t${r.article_id}`);
  await closeDb();
} else {
  let linked = 0;
  let unlinked = 0;
  for (const r of rows) {
    const id = await linkLiveEvent(r.fact_id, r.article_id);
    if (id === null) {
      unlinked += 1;
      console.log(`no identity: fact ${r.fact_id} (${r.article_id})`);
    } else {
      linked += 1;
    }
  }
  console.log(`linked: ${linked}, no identity: ${unlinked}`);
  await closeDb();
}
