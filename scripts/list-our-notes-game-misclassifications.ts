// List likely Our Notes game-internal items currently filed as physical Live/ticket.
// Read-only by default; review the JSONL output before any editorial override is applied.
//   bun scripts/list-our-notes-game-misclassifications.ts [--limit N]
import { closeDb, sql } from "@girlsbands/backend/db";

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit")] >= 0 ? args[args.indexOf("--limit") + 1] : 500);

const rows = await sql<{
  article_id: string;
  title: string;
  url: string;
  category: string | null;
  tags: string[];
  excerpt: string | null;
  body_text: string | null;
  analysis_id: string | null;
}[]>`
  SELECT p.article_id, a.title, a.url, p.category, p.tags,
         a.excerpt, a.body_text, p.analysis_id::text
  FROM publications p
  JOIN articles a ON a.id = p.article_id
  WHERE p.category IN ('live', 'ticket')
    AND (
      lower(a.title || ' ' || coalesce(a.excerpt, '') || ' ' || coalesce(a.body_text, '')) ~ '(our[[:space:]]?notes|アワーノーツ)'
      OR p.tags && ARRAY['entity:our-notes']::text[]
    )
    AND lower(a.title || ' ' || coalesce(a.excerpt, '') || ' ' || coalesce(a.body_text, '')) ~ '(游戏内|游戏活动|卡池|活动剧情|挑战[[:space:]]*live|挑战live|イベント|アップデート|更新|game[[:space:]]+event)'
  ORDER BY a.timeline_at DESC
  LIMIT ${limit}`;

console.log(JSON.stringify({ count: rows.length, candidates: rows }, null, 2));
await closeDb();
