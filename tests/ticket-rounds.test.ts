// 一场演出的每一次受理（ticket_rounds）怎么建、状态怎么算、日期在雷达与演出页上怎么出现。写的是它们
// 会出错的方式：同一条公告重跑两次写两行、后来的报告把受理日改早、状态只看当天不看轮次、同一天在雷达
// 里出现两次、公告下架了日期还挂着能点进去的原文。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { linkLiveEvent } from "@girlsbands/backend/events/live";
import { deadlineMonths, deadlineRange, upcomingDeadlines } from "@girlsbands/backend/publication/deadlines";
import { loadLive } from "@girlsbands/backend/publication/lives";
import { roundNote, roundSlotKind, roundStatus, roundsOf } from "@girlsbands/backend/publication/tickets";
import { buildApp } from "../apps/api/src/app.ts";

const T = `round-${tag()}`;
// JST 2026-10-01 12:00.
const NOW = new Date("2026-10-01T03:00:00Z");
after(closeDb);

let n = 0;

interface ReportOpts {
  category: string | null;
  deadlines?: unknown[];
  subjects?: string[];
  tags?: string[];
  title?: string;
  live?: Record<string, unknown>;
  visibility?: string;
  participation?: string;
  sourceConfig?: Record<string, unknown>;
}

/** 模型在 `analyses.output.live.rounds` 里写下的一个轮次（缺的字段一律补成 null）。 */
function round(parts: Record<string, unknown>): Record<string, unknown> {
  return { platform: null, applyStart: null, applyEnd: null, resultOn: null, paymentDueOn: null, quote: "", ...parts };
}

/** 一条已发布的报告：source / article / analysis / publication 四行，跟真实链路里的一篇情报一样。 */
async function report(opts: ReportOpts): Promise<string> {
  n += 1;
  const id = `${T}-a${n}`;
  const sourceId = `${T}-s${n}`;
  const at = new Date("2026-09-30T00:00:00Z");
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, config, created_at, next_fetch_at)
            VALUES (${sourceId}, ${`媒体 ${n}`}, 'rss', 'T1', ${opts.participation ?? "editorial"}, ${sql.json((opts.sourceConfig ?? {}) as never)}, ${at}, '2100-01-01')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, excerpt)
            VALUES (${id}, ${sourceId}, ${id}, ${`https://example.org/${id}`}, ${opts.title ?? `报道 ${n}`}, ${at}, ${at}, '原文正文')`;
  const [analysis] = await sql`INSERT INTO analyses (article_id, input_revision, origin, output, subjects)
    VALUES (${id}, 1, 'model', ${sql.json({ scope: "single", fact: { deadlines: opts.deadlines ?? [] }, ...(opts.live ? { live: opts.live } : {}) } as never)}, ${opts.subjects ?? []}) RETURNING id`;
  await sql`INSERT INTO publications (article_id, analysis_id, revision, visibility, eligible, selected, title, source_id, channel, first_party, url, published_at, visible_after, discovered_at, timeline_at, body_mode, sort_at, tags, category)
    VALUES (${id}, ${analysis!.id}, 1, ${opts.visibility ?? "public"}, true, false, ${opts.title ?? `报道 ${n}`}, ${sourceId}, 'news', false, ${`https://example.org/${id}`}, ${at}, ${at}, ${at}, ${at}, 'summary', ${at}, ${(opts.tags ?? []) as never}::text[], ${opts.category})`;
  return id;
}

async function factOf(articleIds: string[], title: string): Promise<number> {
  const [story] = await sql`INSERT INTO stories (public_id, title) VALUES (${randomUUID()}, ${title}) RETURNING id`;
  const [fact] = await sql`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${++n}`}, ${story!.id}, ${title}) RETURNING id`;
  for (const articleId of articleIds) {
    await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${articleId}, 'report')`;
  }
  return Number(fact!.id);
}

async function liveFact(opts: ReportOpts): Promise<{ factId: number; articleId: string }> {
  const articleId = await report(opts);
  const factId = await factOf([articleId], opts.title ?? `演出 ${n}`);
  return { factId, articleId };
}

/** 写回分析结果：阶段 B 重跑时同一条公告会带着更全的轮次回来。 */
async function rewrite(articleId: string, live: Record<string, unknown>): Promise<void> {
  await sql`UPDATE analyses SET output = ${sql.json({
    scope: "single",
    fact: { deadlines: [{ kind: "event", at: "2026-11-03" }] },
    live,
  } as never)} WHERE article_id = ${articleId}`;
}

interface StoredRound {
  id: string;
  public_id: string;
  kind: string;
  platform: string | null;
  timezone: string;
  apply_start_at: string | null;
  apply_end_at: string | null;
  result_on: string | null;
  payment_due_on: string | null;
}

const storedRounds = (liveEventId: number) => sql<StoredRound[]>`
  SELECT id, public_id, kind, platform, timezone, apply_start_at, apply_end_at, result_on, payment_due_on
  FROM ticket_rounds WHERE live_event_id = ${liveEventId} ORDER BY apply_start_at, kind`;

const eventsOf = async (roundId: string) => (await sql<{ kind: string }[]>`
  SELECT kind FROM ticket_round_events WHERE ticket_round_id = ${roundId} ORDER BY kind`).map((r) => r.kind);

test("同一条公告重跑两次只有一行，后来的报告只补空，写明时刻算精度变好", async () => {
  const { factId, articleId } = await liveFact({
    category: "ticket",
    deadlines: [{ kind: "event", at: "2026-11-03" }],
    subjects: ["girls-band-cry"],
    title: `赤色の響祭 先行 ${T}`,
    live: { title: `赤色の響祭 ${T}`, rounds: [round({ kind: "fc", platform: "イープラス", applyStart: "2026-10-05", quote: "FC先行受付は10月5日より" })] },
  });
  const id = await linkLiveEvent(factId, articleId);
  assert.notEqual(id, null);
  assert.equal(await linkLiveEvent(factId, articleId), id, "重挂同一条事实不会多一行");
  let rounds = await storedRounds(id!);
  assert.equal(rounds.length, 1);
  assert.deepEqual(await eventsOf(rounds[0]!.id), ["opened"], "第一次见到受理开始，记进时间线");

  // 后来的报告把同一条受理写全了：截止日与当落日。补空，不改期。
  await rewrite(articleId, { title: `赤色の響祭 ${T}`, rounds: [round({ kind: "fc", platform: "イープラス", applyStart: "2026-10-05", applyEnd: "2026-10-12", resultOn: "2026-10-18", quote: "10月5日〜10月12日" })] });
  assert.equal(await linkLiveEvent(factId, articleId), id);
  rounds = await storedRounds(id!);
  assert.equal(rounds.length, 1, "同一轮受理仍然只有一行");
  assert.deepEqual(
    { ...rounds[0], id: undefined, public_id: undefined },
    { kind: "fc", platform: "イープラス", timezone: "Asia/Tokyo", apply_start_at: "2026-10-05", apply_end_at: "2026-10-12", result_on: "2026-10-18", payment_due_on: null, id: undefined, public_id: undefined },
  );
  assert.deepEqual(await eventsOf(rounds[0]!.id), ["closed", "opened", "result"], "每多一种节点就追加一行");

  // 原先只写到日、新的写明了时刻 —— 那是精度变好，键（日期段）不变。
  await rewrite(articleId, { title: `赤色の響祭 ${T}`, rounds: [round({ kind: "fc", applyStart: "2026-10-05T20:00" })] });
  assert.equal(await linkLiveEvent(factId, articleId), id);
  rounds = await storedRounds(id!);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0]!.apply_start_at, "2026-10-05T20:00");

  // 另一轮受理（一般贩售）是另一行。
  await rewrite(articleId, {
    title: `赤色の響祭 ${T}`,
    rounds: [round({ kind: "fc", applyStart: "2026-10-05T20:00" }), round({ kind: "general", platform: "チケットぴあ", applyStart: "2026-10-20", applyEnd: "2026-10-27" })],
  });
  assert.equal(await linkLiveEvent(factId, articleId), id);
  assert.deepEqual((await storedRounds(id!)).map((r) => `${r.kind} ${r.apply_start_at}`), ["fc 2026-10-05T20:00", "general 2026-10-20"]);
});

test("没有日期的轮次不落库，说不清的受理算一般贩售，同一天的重复只写一行", async () => {
  const { factId, articleId } = await liveFact({
    category: "live",
    deadlines: [{ kind: "event", at: "2026-12-01" }],
    subjects: ["mygo"],
    title: `MyGO 巡演 ${T}`,
    live: {
      title: `MyGO 巡演 ${T}`,
      rounds: [
        round({ kind: "fc", platform: "イープラス", quote: "受付中" }),
        round({ kind: "说不清", applyStart: "2026-11-01" }),
        round({ kind: "general", applyStart: "2026-11-01", quote: "11月1日" }),
      ],
    },
  });
  const id = await linkLiveEvent(factId, articleId);
  const rounds = await storedRounds(id!);
  assert.deepEqual(rounds.map((r) => `${r.kind} ${r.apply_start_at}`), ["general 2026-11-01"], "只有带日期的那条留下，kind 落到一般贩售，同一天的两条合成一条");
  assert.equal(await eventsOf(rounds[0]!.id).then((k) => k.length), 1);
});

test("状态按轮次自己那一地的钟算：公布、受理中、等当落、当落已出、待缴款、已结束", () => {
  const at = (parts: { applyStart?: string; applyEnd?: string; resultOn?: string; paymentDueOn?: string }) =>
    roundStatus({ applyStart: null, applyEnd: null, resultOn: null, paymentDueOn: null, ...parts }, "Asia/Tokyo", NOW);
  assert.equal(at({ applyStart: "2026-10-05" }), "announced", "还没开始受理");
  assert.equal(at({ applyStart: "2026-09-30", applyEnd: "2026-10-10" }), "open");
  assert.equal(at({ applyStart: "2026-09-01", applyEnd: "2026-09-20", resultOn: "2026-10-10" }), "awaiting_result", "截止了、当落还没出");
  assert.equal(at({ applyStart: "2026-09-01", applyEnd: "2026-09-20", resultOn: "2026-09-25" }), "result_out");
  assert.equal(at({ applyStart: "2026-09-01", applyEnd: "2026-09-20", resultOn: "2026-09-25", paymentDueOn: "2026-10-15" }), "payment_open", "写了缴款期限时，读者的下一个动作是缴款");
  assert.equal(at({ applyStart: "2026-09-01", applyEnd: "2026-09-20", resultOn: "2026-09-25", paymentDueOn: "2026-09-30" }), "closed");
  assert.equal(at({ applyEnd: "2026-10-01" }), "open", "截止当天算到那一地的 23:59，不是零点就算过期");
  assert.equal(at({ applyEnd: "2026-10-01T12:00" }), "closed", "写了时刻就按绝对时刻比");
  assert.equal(
    roundStatus({ applyStart: null, applyEnd: "2026-10-01T12:00", resultOn: null, paymentDueOn: null }, "Asia/Shanghai", NOW),
    "open",
    "同一句 12:00，北京时间还差一小时（此刻 JST 12:00 = 北京 11:00）",
  );
});

test("轮次接管同一天的票务日期：雷达与日历只出现一次，来源是轮次", async () => {
  const { factId, articleId } = await liveFact({
    category: "ticket",
    deadlines: [
      { kind: "event", at: "2026-11-03" },
      { kind: "sale_start", at: "2026-10-12", note: "公告自己写的开售日" },
    ],
    subjects: ["girls-band-cry"],
    tags: ["entity:girls-band-cry"],
    title: `赤色の響祭 一般販売 ${T}`,
    live: { title: `赤色の響祭 ${T}`, rounds: [round({ kind: "general", platform: "チケットぴあ", applyStart: "2026-10-12", applyEnd: "2026-10-20", quote: "一般販売は10月12日10:00〜10月20日" })] },
  });
  const id = await linkLiveEvent(factId, articleId);

  const rows = await deadlineRange(NOW, { from: "2026-10-01", to: "2026-11-30", itemIds: [articleId] });
  const notes = rows.map((r) => `${r.day} ${r.kind} ${r.note}`);
  assert.deepEqual(notes, [
    "2026-10-12 sale_start 一般贩售 · チケットぴあ",
    "2026-10-20 sale_end 一般贩售 · チケットぴあ",
    "2026-11-03 event null",
  ], "同一天只留轮次那一行（公告自己的开售日不再单独出现）");
  assert.ok(!rows.some((r) => r.note === "公告自己写的开售日"), "公告写出的重复日期被轮次接管");

  assert.ok((await deadlineMonths(NOW, { from: "2026-10-01", to: "2026-12-31", subject: "girls-band-cry" })).includes("2026-10"));
  const radar = (await upcomingDeadlines(NOW, { horizonDays: 60, subject: "girls-band-cry" })).days.flatMap((d) => d.items);
  assert.ok(radar.some((v) => v.note === "一般贩售 · チケットぴあ"), "截止雷达走的是同一份日期");
  assert.equal(radar.filter((v) => v.note === "一般贩售 · チケットぴあ" && v.kind === "sale_start").length, 1);

  // 轮次的日期也带来源：指向第一次说出它的那篇公告。
  assert.equal(rows.find((r) => r.kind === "sale_start")?.itemId, articleId);
  assert.notEqual(id, null);
});

test("演出页列出轮次，被轮次接管的日期不再重复列；公告下架后日期还在，只是点不进去", async () => {
  const { factId, articleId } = await liveFact({
    category: "ticket",
    deadlines: [{ kind: "event", at: "2026-11-03" }, { kind: "lottery_end", at: "2026-10-05" }],
    subjects: ["roselia"],
    title: `Roselia 先行 ${T}`,
    live: { title: `Roselia 单独公演 ${T}`, rounds: [round({ kind: "fc", platform: "イープラス", applyStart: "2026-09-30", applyEnd: "2026-10-05", quote: "9月30日〜10月5日" })] },
  });
  const id = await linkLiveEvent(factId, articleId);
  const [live] = await sql<{ public_id: string }[]>`SELECT public_id FROM live_events WHERE id = ${id}`;
  const view = await loadLive(live!.public_id, NOW);
  assert.deepEqual(view?.rounds.map((r) => `${r.kind} ${r.status} ${r.platform} ${r.applyStart?.at}→${r.applyEnd?.at}`), ["fc open イープラス 2026-09-30→2026-10-05"]);
  assert.equal(view?.rounds[0]?.itemId, articleId);
  assert.equal(view?.rounds[0]?.title, `Roselia 先行 ${T}`);
  assert.deepEqual(view?.dates.map((d) => `${d.day} ${d.kind}`), ["2026-11-03 event"], "票务日期由轮次那一栏负责，不再在下面重复");

  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${articleId}`;
  assert.equal(await loadLive(live!.public_id, NOW), null, "报告全下架，演出页跟着 404");
  const orphan = await roundsOf(id!, NOW);
  assert.equal(orphan.length, 1, "日期仍然算数");
  assert.equal(orphan[0]!.itemId, null, "只是没有能点进去的原文");
  assert.equal(orphan[0]!.status, "open");
});

test("公开接口把轮次一起答出来", async () => {
  const app = await buildApp();
  try {
    const { factId, articleId } = await liveFact({
      category: "live",
      deadlines: [{ kind: "event", at: "2026-12-20" }],
      subjects: ["mygo"],
      title: `MyGO 12月 ${T}`,
      live: { title: `MyGO 12月公演 ${T}`, rounds: [round({ kind: "official", platform: "チケットぴあ", applyStart: "2026-11-01", resultOn: "2026-11-20" })] },
    });
    const id = await linkLiveEvent(factId, articleId);
    const [live] = await sql<{ public_id: string }[]>`SELECT public_id FROM live_events WHERE id = ${id}`;

    const res = await app.inject({ method: "GET", url: `/api/site/lives/${live!.public_id}` });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.rounds.length, 1);
    assert.equal(body.rounds[0].kind, "official");
    assert.deepEqual(body.rounds[0].applyStart, { at: "2026-11-01", day: "2026-11-01", localTime: null });
    assert.equal(body.rounds[0].status, "announced");
  } finally {
    await app.close();
  }
});

test("轮次的日期落进雷达时算哪一种节点，行首写的是哪一种受理", () => {
  assert.equal(roundSlotKind("fc", "applyStart"), "lottery_start");
  assert.equal(roundSlotKind("fc", "applyEnd"), "lottery_end");
  assert.equal(roundSlotKind("general", "applyStart"), "sale_start");
  assert.equal(roundSlotKind("day_of", "applyEnd"), "sale_end");
  assert.equal(roundSlotKind("official", "resultOn"), "result");
  assert.equal(roundSlotKind("official", "paymentDueOn"), "payment_deadline");
  assert.equal(roundNote("fc", "イープラス"), "FC 先行 · イープラス");
  assert.equal(roundNote("general", null), "一般贩售");
});

test("受理的时区跟着信源配置走：国内信源写下来的日期按北京时间算", async () => {
  const { factId, articleId } = await liveFact({
    category: "ticket",
    deadlines: [{ kind: "event", at: "2026-11-15" }],
    subjects: ["girls-band-cry"],
    title: `国内巡演 ${T}`,
    sourceConfig: { timezone: "Asia/Shanghai" },
    live: { title: `国内巡演 ${T}`, rounds: [round({ kind: "general", platform: "秀动", applyStart: "2026-10-20", applyEnd: "2026-10-25" })] },
  });
  const id = await linkLiveEvent(factId, articleId);
  const rounds = await roundsOf(id!, NOW);
  assert.equal(rounds[0]!.timezone, "Asia/Shanghai", "落库时记住这一地");
  assert.equal(rounds[0]!.status, "announced");
  const rows = await deadlineRange(NOW, { from: "2026-10-01", to: "2026-11-30", itemIds: [articleId] });
  assert.equal(rows.find((r) => r.kind === "sale_start")?.timezone, "Asia/Shanghai", "雷达上显示的是这一地的钟");
});
