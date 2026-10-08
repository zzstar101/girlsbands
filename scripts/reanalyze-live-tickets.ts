// 灰度重跑「演出信息抽取」（W8 阶段 B）：Live 与票务条目里，已经有过一次分析、但还没有 output.live 的，
// 交给 worker 重新分析一次。**必须换一个新的 attemptTag**：同一份输入重跑只会命中回执，不花钱也不问模型
// （providers/receipts.ts 的 identity 只看 system/user/model/promptVersion/temperature + attemptTag）。
// 重跑期间这些条目的 grouping_status 会短暂回到 pending（events/group.ts），所以挑没人看的时段跑。
//   bun scripts/reanalyze-live-tickets.ts [--limit N] [--tag X] [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { queueProcessing } from "@girlsbands/backend/jobs/content";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { LIVE_CATEGORIES } from "@girlsbands/industry/taxonomy";

const args = process.argv.slice(2);
const value = (name: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const limit = Number(value("--limit") ?? 500);
const tag = value("--tag") ?? `live-ticket-${new Date().toISOString().slice(0, 10)}`;
const dry = args.includes("--dry");

// 只挑「这场演出还没被读出来过」的条目：公开分类是 Live 或票务，这一次分析里抽到了开演日期（没有日期就
// 推不出演出身份，这一步没有意义），而且还没有 output.live（已经有了就不必再花钱）。
const rows = await sql<{ article_id: string }[]>`
  SELECT DISTINCT p.article_id
  FROM publications p
  JOIN analyses an ON an.id = p.analysis_id
  CROSS JOIN LATERAL (SELECT an.output AS out) o
  WHERE p.category IN ${sql([...LIVE_CATEGORIES])}
    AND o.out->'fact'->'deadlines' @> '[{"kind":"event"}]'::jsonb
    AND NOT (o.out ? 'live')
  ORDER BY p.article_id
  LIMIT ${limit}`;

console.log(`candidates: ${rows.length}, tag: ${tag}`);
if (dry) {
  for (const r of rows) console.log(r.article_id);
  await closeDb();
} else {
  let queued = 0;
  for (const r of rows) {
    if (await queueProcessing(r.article_id, { attemptTag: tag })) queued += 1;
  }
  console.log(`queued: ${queued}`);
  await stopBoss();
  await closeDb();
}
