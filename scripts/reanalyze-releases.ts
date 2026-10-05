// 重跑「发售信息抽取」（W11 阶段 B）：分类或标签命中「音像作品 / 商品特典」、但还没有 output.release 的条目，
// 交给 worker 重新分析一次。**不带 --tag 是有意的**：articles.processing_attempt_tag 会沿用这条上一次评估
// 用的标签（coalesce），所以只有新加的 release 这一步是没见过的身份、要真花钱，前面的 prefilter / score /
// structure / live / understand / summarize 全部命中回执（providers/receipts.ts）。要强制整条链重来才传 --tag。
// 重跑期间这些条目的 grouping_status 会短暂回到 pending（events/group.ts），所以挑没人看的时段跑。
//   node --env-file=.env scripts/reanalyze-releases.ts [--limit N] [--tag X] [--pace MS] [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { queueProcessing } from "@girlsbands/backend/jobs/content";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { MERCH_TAGS, RELEASE_TAGS } from "@girlsbands/industry/taxonomy";

const args = process.argv.slice(2);
const value = (name: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const limit = Number(value("--limit") ?? 500);
const tag = value("--tag");
// The model provider caps 120 requests a minute; a burst of articles each making one real call walks
// straight into it, and a retried article comes back five minutes later. Pacing the queue is cheaper
// than the backoff.
const pace = Number(value("--pace") ?? 0);
const dry = args.includes("--dry");

const categories = ["release", "merch"];
const allTags = [...RELEASE_TAGS, ...MERCH_TAGS];

// 只挑「这张碟还没被读出来过」的条目：公开分类或标签说是发售/周边，而且还没有 output.release。
const rows = await sql<{ article_id: string }[]>`
  SELECT DISTINCT p.article_id
  FROM publications p
  WHERE (p.category IN ${sql(categories)} OR p.tags && ${allTags}::text[])
    AND NOT EXISTS (SELECT 1 FROM analyses an WHERE an.article_id = p.article_id AND an.output ? 'release')
  ORDER BY p.article_id
  LIMIT ${limit}`;

console.log(`candidates: ${rows.length}, tag: ${tag ?? "(沿用各自的 processing_attempt_tag)"}`);
if (dry) {
  for (const r of rows) console.log(r.article_id);
  await closeDb();
} else {
  let queued = 0;
  for (const r of rows) {
    if (await queueProcessing(r.article_id, { attemptTag: tag })) queued += 1;
    if (pace > 0) await new Promise((resolve) => setTimeout(resolve, pace));
  }
  console.log(`queued: ${queued}`);
  await stopBoss();
  await closeDb();
}
