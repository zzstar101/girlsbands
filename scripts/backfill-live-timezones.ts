// 回填海外公演的钟（迁移 0074）：日本来源公告的香港、台北公演，演出与受理时刻原先都存成了日本时间。
// 只看还没结束的演出 —— 已经结束的场次没人再按它的时刻行动，不值得为它花钱。
//
// 两步，按顺序跑：
//   1. bun scripts/backfill-live-timezones.ts --ask [--limit N] [--tag X] [--dry]
//      还没认出所在地、但原文看起来像海外公演的条目，换一个新的 attemptTag 交给 worker 重新分析，让 live
//      步骤读出 place / timezone。**必须换 tag**：同一份输入重跑只会命中回执，不花钱也不问模型。整条分析
//      都会重跑（与 scripts/reanalyze-live-tickets.ts 一样），所以只挑像海外的那几条。
//   2. 等 worker 跑完后：bun scripts/backfill-live-timezones.ts [--limit N] [--dry]
//      对这些演出的每条事实重跑一次挂接（events/live.ts 的 linkLiveEvent）：会场词表认得出所在地的、
//      live 步骤读到了地点的，把演出的钟改过来，并按每轮受理自己那句话重写轮次的钟。可重复跑。
//      不需要第 1 步也能先跑一次：会场在词表里的演出当场就改好。
// 公告自己那一支的日期（抽选开始之类）不落库，读取时按原句里的「現地時間」换钟（publication/deadlines.ts），
// 演出的钟改好就跟着对了。
import { closeDb, sql } from "@girlsbands/backend/db";
import { linkLiveEvent } from "@girlsbands/backend/events/live";
import { queueProcessing } from "@girlsbands/backend/jobs/content";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { beijingDate } from "@girlsbands/contracts/time";

const args = process.argv.slice(2);
const value = (name: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const limit = Number(value("--limit") ?? 500);
const tag = value("--tag") ?? `live-timezone-${new Date().toISOString().slice(0, 10)}`;
const dry = args.includes("--dry");
const ask = args.includes("--ask");
// 还没结束：最后一天（单日场就是开演日）按北京日历还没过去。差一天的时区边界不要紧，多算一场只是多看一眼。
const today = beijingDate(new Date());

// 「看起来像海外」只用来决定值不值得重新问模型，不拿来定钟：定钟的永远是会场词表或模型读到的地点。
const OVERSEAS = "香港|台北|台湾|台灣|高雄|台中|ソウル|韓国|韓國|釜山|上海|北京|広州|广州|成都|深圳|シンガポール|マレーシア|クアラルンプール|バンコク|ジャカルタ|マニラ|海外|アジア|ASIA|Asia|Hong Kong|Taipei|Seoul";

if (ask) {
  const rows = await sql<{ article_id: string }[]>`
    SELECT DISTINCT p.article_id
    FROM live_events le
    JOIN facts f ON f.live_event_id = le.id
    JOIN fact_articles fa ON fa.fact_id = f.id
    JOIN publications p ON p.article_id = fa.article_id
    JOIN articles a ON a.id = p.article_id
    JOIN analyses an ON an.id = p.analysis_id
    WHERE COALESCE(le.ends_on, le.starts_on) >= ${today}::date
      AND le.timezone = 'Asia/Tokyo'
      AND NOT (COALESCE(an.output->'live'->>'timezone', '') <> '')
      AND concat_ws(' ', a.title, a.body_text, a.excerpt, p.title) ~ ${OVERSEAS}
    ORDER BY p.article_id
    LIMIT ${limit}`;
  console.log(`re-ask candidates: ${rows.length}, tag: ${tag}`);
  if (dry) {
    for (const r of rows) console.log(r.article_id);
    await closeDb();
  } else {
    let queued = 0;
    for (const r of rows) if (await queueProcessing(r.article_id, { attemptTag: tag })) queued += 1;
    console.log(`queued: ${queued}（worker 跑完后不带 --ask 再跑一次）`);
    await stopBoss();
    await closeDb();
  }
} else {
  const rows = await sql<{ fact_id: number; article_id: string; public_id: string; timezone: string }[]>`
    SELECT DISTINCT ON (f.id) f.id AS fact_id, p.article_id, le.public_id::text AS public_id, le.timezone
    FROM live_events le
    JOIN facts f ON f.live_event_id = le.id
    JOIN fact_articles fa ON fa.fact_id = f.id
    JOIN publications p ON p.article_id = fa.article_id
    WHERE COALESCE(le.ends_on, le.starts_on) >= ${today}::date
    ORDER BY f.id, p.selected DESC, p.published_at DESC NULLS LAST
    LIMIT ${limit}`;
  console.log(`facts of upcoming lives: ${rows.length}`);
  if (dry) {
    for (const r of rows) console.log(`${r.public_id}\t${r.timezone}\tfact ${r.fact_id}\t${r.article_id}`);
  } else {
    for (const r of rows) await linkLiveEvent(r.fact_id, r.article_id);
    const changed = await sql<{ public_id: string; title: string; timezone: string }[]>`
      SELECT public_id::text AS public_id, title, timezone FROM live_events
      WHERE COALESCE(ends_on, starts_on) >= ${today}::date AND timezone NOT IN ('Asia/Tokyo', 'Asia/Shanghai')
      ORDER BY starts_on`;
    console.log(`upcoming lives on an overseas clock: ${changed.length}`);
    for (const r of changed) console.log(`${r.public_id}\t${r.timezone}\t${r.title}`);
  }
  await closeDb();
}
