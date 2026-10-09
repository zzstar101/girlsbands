// 晚到帖子的回填（content/materials.ts decideTimeline 改成按原发帖时间排之后）：
//   1. 发帖后 1 小时以上才抓到、之前按「抓到的时间」排进时间线的条目：timeline_at 改回原发帖时间。
//   2. 这些条目重新投影一次（publishArticle 幂等）：时间线位置跟着改；抓到时截止已经过了的通知
//      （publication/rules.ts expiredOnArrival）退出精选。同一事实的其他报道也重排一次，让阅读组的锚点跟上。
// 已经发出去的日报、邮件、推送不动。可重复跑。
//   bun scripts/retime-late-posts.ts [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { publishArticle } from "@girlsbands/backend/publication/publish";

const dry = process.argv.includes("--dry");

const late = await sql<{ id: string; title: string; published_at: Date; discovered_at: Date; selected: boolean | null }[]>`
  SELECT a.id, a.title, a.published_at, a.discovered_at, p.selected
  FROM articles a LEFT JOIN publications p ON p.article_id = a.id
  WHERE a.published_at IS NOT NULL
    AND a.published_at < a.discovered_at - interval '1 hour'
    AND a.timeline_at = a.discovered_at
  ORDER BY a.discovered_at DESC`;
const hours = (r: { published_at: Date; discovered_at: Date }) => (r.discovered_at.getTime() - r.published_at.getTime()) / 3600_000;
console.log(`late posts placed by discovery time: ${late.length}（其中已精选 ${late.filter((r) => r.selected).length}）`);
for (const r of late.filter((r) => r.selected).slice(0, 20)) console.log(`  +${hours(r).toFixed(1)}h  ${r.id}  ${r.title.slice(0, 50)}`);

// 已经改过时间、但仍在精选里的晚到帖子也再投影一次，让后来补上的「抓到时已截止」规则落到它们身上。
const selectedLate = await sql<{ id: string; selected: boolean }[]>`
  SELECT a.id, p.selected FROM articles a JOIN publications p ON p.article_id = a.id
  WHERE (p.selected OR p.selected_ready_at IS NOT NULL) AND a.published_at IS NOT NULL AND a.published_at < a.discovered_at - interval '1 hour'
    AND a.timeline_at <> a.discovered_at`;
console.log(`selected/candidate late posts to re-check: ${selectedLate.length}`);

if (!dry && (late.length || selectedLate.length)) {
  const ids = [...new Set([...late.map((r) => r.id), ...selectedLate.map((r) => r.id)])];
  const wasSelected = new Set([...late.filter((r) => r.selected).map((r) => r.id), ...selectedLate.filter((r) => r.selected).map((r) => r.id)]);
  await sql`UPDATE articles SET timeline_at = published_at WHERE id = ANY(${late.map((r) => r.id)}) AND timeline_at = discovered_at`;
  const siblings = await sql<{ article_id: string }[]>`
    SELECT DISTINCT p2.article_id FROM publications p JOIN publications p2 ON p2.fact_id = p.fact_id
    WHERE p.article_id = ANY(${ids}) AND p.fact_id IS NOT NULL AND p2.article_id <> ALL(${ids})`;
  const all = [...ids, ...siblings.map((s) => s.article_id)];
  let n = 0;
  let unselected = 0;
  for (const id of all) {
    try {
      const before = wasSelected.has(id);
      const res = await publishArticle(id);
      if (before && res && !res.selected) {
        unselected++;
        console.log(`  退出精选 ${id}`);
      }
    } catch (error) {
      console.warn(`  ${id}: ${(error as Error).message}`);
    }
    if (++n % 100 === 0) console.log(`  ${n}/${all.length}`);
  }
  console.log(`republished ${all.length}（晚到 ${ids.length} + 同事实 ${siblings.length}），退出精选 ${unselected}`);
}
await closeDb();
