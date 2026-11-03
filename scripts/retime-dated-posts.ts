// 一次性：官网公告的列表大多只印日期（「2026.11.03」），解析出来就是当天 00:00，也就是北京的前一天
// 23:00。时间线又按「每件事最早的一条」锚定（publication/timeline.ts），于是一条只写日期的官网公告会把
// 同一件事更晚的 X 报道一起拖到昨天深夜，好几条还会挤在同一个 00:00 上。
//
// 这里按 content/materials.ts 的 decideTimeline 现在对「只印日期」的处理补一遍历史数据：
// 时间线位置改成收录时间（不晚过来源写的那天的结束），published_at 不动（显示仍是来源写的那天），
// 再按 publish.ts 的规则重算 publications.sort_at。
//   bun scripts/retime-dated-posts.ts            # 先看会改哪些
//   bun scripts/retime-dated-posts.ts --apply    # 真的写进去
import { closeDb, sql } from "@girlsbands/backend/db";

const apply = process.argv.includes("--apply");
const DAY_MS = 86_400_000;

const rows = await sql<{ id: string; source_id: string; published_at: Date; discovered_at: Date }[]>`
  SELECT a.id, a.source_id, a.published_at, a.discovered_at
  FROM articles a JOIN sources s ON s.id = a.source_id
  WHERE s.kind = 'web_list'
    AND a.published_at IS NOT NULL
    AND a.timeline_at = a.published_at
    AND ((a.published_at AT TIME ZONE 'Asia/Tokyo')::time = '00:00:00'
      OR (a.published_at AT TIME ZONE 'Asia/Shanghai')::time = '00:00:00')
  ORDER BY a.discovered_at DESC`;

/** Same day the source named, seen when we saw it: never later than that day's end, never past discovery. */
const retimed = rows.map((r) => ({
  ...r,
  at: new Date(Math.min(r.discovered_at.getTime(), r.published_at.getTime() + DAY_MS - 60_000)),
}));

const bySource = new Map<string, number>();
for (const r of retimed) bySource.set(r.source_id, (bySource.get(r.source_id) ?? 0) + 1);
for (const r of retimed.slice(0, 15)) console.log(`${r.id}  ${r.published_at.toISOString()} → ${r.at.toISOString()}  ${r.source_id}`);
console.log(`${retimed.length} 条只印日期的文章：`, [...bySource].map(([s, n]) => `${s} ${n}`).join("、"));
if (!apply) {
  console.log("（dry run；加 --apply 写入）");
  await closeDb();
  process.exit(0);
}

const facts = new Set<number>();
for (const r of retimed) {
  await sql`UPDATE articles SET timeline_at = ${r.at} WHERE id = ${r.id}`;
  await sql`UPDATE publications SET sort_at = ${r.at}, updated_at = now() WHERE article_id = ${r.id}`;
  for (const f of await sql<{ fact_id: number }[]>`SELECT fact_id FROM publications WHERE article_id = ${r.id} AND fact_id IS NOT NULL`)
    facts.add(Number(f.fact_id));
}

// publish.ts 的规则：精选条目坐在「同一件事最早的一条」上，事实内的成员动了就要重算。
for (const factId of facts) {
  await sql`
    UPDATE publications p SET sort_at = anchor.t, updated_at = now()
    FROM (
      SELECT min(a.timeline_at) AS t FROM publications p2 JOIN articles a ON a.id = p2.article_id
      WHERE p2.fact_id = ${factId} AND p2.eligible AND p2.visibility = 'public'
    ) AS anchor
    WHERE p.fact_id = ${factId} AND p.selected AND anchor.t IS NOT NULL`;
}
console.log(`updated ${retimed.length} articles, ${facts.size} facts re-anchored`);
await closeDb();
