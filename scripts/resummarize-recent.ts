// 导读改写（2026-10-07）：rules-domain 加了「普通日语词一律译成中文」之后，把最近 N 天的精选条目重跑一次分析。
// 不带 --tag：prefilter / score / structure 等提示词没变，命中回执不花钱；只有引用 rules-domain 的
// understand / summarize 是新身份，真正调用模型。限流在 providers/receipts.ts 里，排队多少都不会冲过每分钟预算。
//   bun scripts/resummarize-recent.ts [--days 7] [--limit N] [--all] [--dry]
// 默认只挑精选（selected）；--all 连同所有公开可见条目。
import { closeDb, sql } from "@girlsbands/backend/db";
import { queueProcessing } from "@girlsbands/backend/jobs/content";
import { stopBoss } from "@girlsbands/backend/jobs/queue";

const args = process.argv.slice(2);
const value = (name: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const days = Number(value("--days") ?? 7);
const limit = Number(value("--limit") ?? 2000);
const all = args.includes("--all");
const dry = args.includes("--dry");

const rows = await sql<{ article_id: string }[]>`
  SELECT p.article_id
  FROM publications p
  JOIN articles a ON a.id = p.article_id
  WHERE p.visibility = 'public'
    AND (${all} OR p.selected)
    AND a.processing_state = 'analyzed'
    AND coalesce(a.published_at, a.created_at) > now() - make_interval(days => ${days})
  ORDER BY coalesce(a.published_at, a.created_at) DESC
  LIMIT ${limit}`;

console.log(`candidates: ${rows.length} (last ${days} days, ${all ? "all public" : "selected"})`);
if (dry) {
  await closeDb();
} else {
  let queued = 0;
  for (const r of rows) if (await queueProcessing(r.article_id)) queued += 1;
  console.log(`queued: ${queued}`);
  await stopBoss();
  await closeDb();
}
