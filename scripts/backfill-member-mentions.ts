// 回填 member_mentions（0063_member_mentions.sql）：W13 之前发布的报道没有成员提及行，不必重新发布
// 一遍就能补上。取的是 publications 里已经定稿的那几列（title / original_title / summary / body_mode），
// 所以算出来的结果与 publish.ts 当时写下的完全一致（正文只在 body_mode='full' 时参与匹配）。
// 可重复跑：每篇整篇重写，已经不在公开池里的报道（不 eligible）旧行会被删掉。
//   bun scripts/backfill-member-mentions.ts [--limit N] [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { deriveMemberMentions } from "@girlsbands/backend/publication/member-mentions";

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 10_000;
const dry = args.includes("--dry");

interface Row {
  article_id: string;
  title: string | null;
  original_title: string | null;
  summary: string | null;
  body_mode: string | null;
  body_text: string | null;
}

const rows = await sql<Row[]>`
  SELECT p.article_id, p.title, p.original_title, p.summary, p.body_mode, a.body_text
  FROM publications p
  JOIN articles a ON a.id = p.article_id
  WHERE p.eligible
  ORDER BY p.timeline_at DESC, p.article_id DESC
  LIMIT ${limit}`;

// 与 publish 的「不 eligible 就删掉」同一条规则：下架 / 不再收录的报道不留旧行。
const stale = await sql`
  DELETE FROM member_mentions mm
  WHERE NOT EXISTS (SELECT 1 FROM publications p WHERE p.article_id = mm.article_id AND p.eligible)`;

console.log(`candidates: ${rows.length}, stale rows removed: ${stale.count}`);
if (dry) {
  for (const r of rows) console.log(`${r.article_id}\t${r.title ?? ""}`);
} else {
  let written = 0;
  let withMentions = 0;
  for (const r of rows) {
    const ids = await deriveMemberMentions(sql, r.article_id, true, {
      title: r.title,
      originalTitle: r.original_title,
      summary: r.summary,
      body: r.body_mode === "full" ? (r.body_text ?? "").slice(0, 12_000) : null,
    });
    written += ids.length;
    if (ids.length > 0) withMentions += 1;
  }
  console.log(`mentions written: ${written} (${withMentions} 篇报道点了名)`);
}
await closeDb();
