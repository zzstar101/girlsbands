// 重新翻译「译文就是原文」的条目：模型把日文原样返回、被当作译文存下的（2026-10-07 查出 62 条）。
// 删掉这些译文和翻译尝试记录，再逐条翻一次（新的提示词和原样回传检测）。
//   bun scripts/retranslate-echoed.ts [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { translateArticle } from "@girlsbands/backend/editorial/translate";
import { stopBoss } from "@girlsbands/backend/jobs/queue";

const dry = process.argv.includes("--dry");
const rows = await sql<{ id: string }[]>`
  SELECT t.article_id AS id FROM translations t
  JOIN articles a ON a.id = t.article_id JOIN publications p ON p.article_id = a.id
  WHERE p.visibility = 'public' AND t.origin = 'model'
    AND regexp_replace(t.body_text, '\\s', '', 'g') = regexp_replace(coalesce(a.x_post->>'text', a.body_text), '\\s', '', 'g')
  ORDER BY p.timeline_at DESC`;
console.log(`echoed translations: ${rows.length}`);
let translated = 0;
for (const r of rows) {
  if (dry) continue;
  await sql`DELETE FROM translations WHERE article_id = ${r.id} AND origin = 'model'`;
  await sql`DELETE FROM translation_attempts WHERE article_id = ${r.id}`;
  const res = await translateArticle(r.id);
  if (res.status !== "skipped") translated += 1;
  console.log(r.id, res.status, res.reason ?? "");
}
console.log(`translated ${translated}/${rows.length}`);
await stopBoss();
await closeDb();
