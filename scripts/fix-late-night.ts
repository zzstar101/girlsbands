// 一次性：把已经发布的标题和摘要里「今晚 26:05」这种日本深夜档写法换成次日凌晨（contracts/time.ts
// lateNightClock）。只改模型写的中文标题和摘要，原文标题（X 帖子直接拿正文当标题的那种）不动。
//   node scripts/fix-late-night.ts            # 先看会改哪些
//   node scripts/fix-late-night.ts --apply    # 真的写进去
import { lateNightClock } from "@girlsbands/contracts/time";
import { closeDb, sql } from "@girlsbands/backend/db";

const apply = process.argv.includes("--apply");
const rows = await sql<{ article_id: string; title: string; summary: string | null; title_zh: string | null }[]>`
  SELECT p.article_id, p.title, p.summary, an.title_zh
  FROM publications p LEFT JOIN analyses an ON an.id = p.analysis_id
  WHERE p.title ~ '(2[4-9]|30)[:：][0-5][0-9]' OR p.summary ~ '(2[4-9]|30)[:：][0-5][0-9]'`;
let changed = 0;
for (const r of rows) {
  const title = r.title_zh && r.title === r.title_zh.trim() ? lateNightClock(r.title) : r.title;
  const summary = r.summary ? lateNightClock(r.summary) : r.summary;
  if (title === r.title && summary === r.summary) continue;
  changed += 1;
  if (title !== r.title) console.log(`${r.article_id}  ${r.title}\n    → ${title}`);
  if (apply) await sql`UPDATE publications SET title = ${title}, summary = ${summary}, updated_at = now() WHERE article_id = ${r.article_id}`;
}
console.log(`${apply ? "updated" : "would update"} ${changed} of ${rows.length}`);
await closeDb();
