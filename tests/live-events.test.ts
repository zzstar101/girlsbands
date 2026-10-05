// 一场演出的身份、阶段和页面。写的是它们会出错的方式：同一个演出的两份报告变成两个页面（或者反过来，
// 一场演出把生放送、展览、快闪店一起吞进来）、标题每来一份报告就改一次、公告说了取消而阶段照旧往前
// 走、最后一条报告被下架了页面还在。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { linkLiveEvent } from "@girlsbands/backend/events/live";
import { deriveLiveKey } from "@girlsbands/backend/lives/link";
import { livesForSubject, liveRefForStory, loadLive } from "@girlsbands/backend/publication/lives";
import { addDays, beijingDate } from "@girlsbands/contracts/time";
import { buildApp } from "../apps/api/src/app.ts";

const T = `live-${tag()}`;
// JST 2026-10-01 12:00: today in Tokyo is 2026-10-01.
const NOW = new Date("2026-10-01T03:00:00Z");
after(closeDb);

let n = 0;

interface ReportOpts {
  category: string | null;
  deadlines?: unknown[];
  subjects?: string[];
  title?: string;
  live?: Record<string, unknown>;
  visibility?: string;
  participation?: string;
  publishedAt?: Date;
  /** 原文正文：会场的写法要在它里面找得到。 */
  text?: string;
}

/** 一条已发布的报告：source / article / analysis / publication 四行，跟真实链路里的一篇情报一样。 */
async function report(opts: ReportOpts): Promise<string> {
  n += 1;
  const id = `${T}-a${n}`;
  const sourceId = `${T}-s${n}`;
  const at = opts.publishedAt ?? new Date("2026-09-30T00:00:00Z");
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, config, created_at, next_fetch_at)
            VALUES (${sourceId}, ${`媒体 ${n}`}, 'rss', 'T1', ${opts.participation ?? "editorial"}, '{}'::jsonb, ${at}, '2100-01-01')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, excerpt)
            VALUES (${id}, ${sourceId}, ${id}, ${`https://example.org/${id}`}, ${opts.title ?? `报道 ${n}`}, ${at}, ${at}, ${opts.text ?? "原文正文"})`;
  const [analysis] = await sql`INSERT INTO analyses (article_id, input_revision, origin, output, subjects)
    VALUES (${id}, 1, 'model', ${sql.json({ scope: "single", fact: { deadlines: opts.deadlines ?? [] }, ...(opts.live ? { live: opts.live } : {}) } as never)}, ${opts.subjects ?? []}) RETURNING id`;
  await sql`INSERT INTO publications (article_id, analysis_id, revision, visibility, eligible, selected, title, source_id, channel, first_party, url, published_at, visible_after, discovered_at, timeline_at, body_mode, sort_at, tags, category)
    VALUES (${id}, ${analysis!.id}, 1, ${opts.visibility ?? "public"}, true, false, ${opts.title ?? `报道 ${n}`}, ${sourceId}, 'news', false, ${`https://example.org/${id}`}, ${at}, ${at}, ${at}, ${at}, 'summary', ${at}, '{}'::text[], ${opts.category})`;
  return id;
}

/** 一条事实：story + fact + 它的报告。 */
async function factOf(articleIds: string[], title: string): Promise<number> {
  const [story] = await sql`INSERT INTO stories (public_id, title) VALUES (${randomUUID()}, ${title}) RETURNING id`;
  const [fact] = await sql`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${++n}`}, ${story!.id}, ${title}) RETURNING id`;
  for (const articleId of articleIds) {
    await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${articleId}, 'report')`;
  }
  return Number(fact!.id);
}

/** 一条事实连同它唯一一条报告，返回两者的 id。 */
async function liveFact(opts: ReportOpts & { factTitle?: string }): Promise<{ factId: number; articleId: string }> {
  const articleId = await report(opts);
  const factId = await factOf([articleId], opts.factTitle ?? opts.title ?? `演出 ${n}`);
  return { factId, articleId };
}

test("一场演出要有主体、一个读得懂的当天、以及不含糊的会场", () => {
  const base = { subjects: ["girls-band-cry"], deadlines: [{ kind: "event", at: "2026-11-03" }], live: null, title: "赤色の響祭", text: "11月3日 ぴあアリーナMM" };
  const key = deriveLiveKey(base, "Asia/Tokyo");
  assert.equal(key?.subjectEntity, "girls-band-cry");
  assert.equal(key?.startsOn, "2026-11-03");
  assert.equal(key?.startsTime, null);
  assert.equal(key?.venue, "ぴあアリーナMM", "正文里恰好一个会场才写进键");
  assert.equal(key?.status, "scheduled");

  assert.equal(deriveLiveKey({ ...base, subjects: [] }, "Asia/Tokyo"), null, "没有主体就没有身份");
  assert.equal(deriveLiveKey({ ...base, subjects: ["不是主体"] }, "Asia/Tokyo"), null, "主体必须在 ENTITIES 里");
  assert.equal(deriveLiveKey({ ...base, deadlines: [{ kind: "sale_start", at: "2026-10-01" }] }, "Asia/Tokyo"), null, "开售日不是开演日");
  assert.equal(deriveLiveKey({ ...base, deadlines: [{ kind: "event", at: "11月3日" }] }, "Asia/Tokyo"), null, "读不出日期就不建实体");
  assert.equal(deriveLiveKey({ ...base, text: "ぴあアリーナMM と 日本武道館" }, "Asia/Tokyo")?.venue, null, "两个会场时键里留空，宁可拆开也不并错");

  // 阶段 B 的读取优先：会场先过词表归一，时刻与状态也听它的。
  const model = deriveLiveKey(
    { ...base, text: "", live: { venue: "ぴあアリーナMM(神奈川)", startsTime: "18:30", endsOn: "2026-11-04", status: "postponed" } },
    "Asia/Shanghai",
  );
  assert.equal(model?.venue, "ぴあアリーナMM");
  assert.equal(model?.startsTime, "18:30");
  assert.equal(model?.endsOn, "2026-11-04");
  assert.equal(model?.status, "postponed");
  assert.equal(model?.timezone, "Asia/Shanghai");

  const timed = deriveLiveKey({ ...base, deadlines: [{ kind: "event", at: "2026-11-03T19:00" }], text: "" }, "Asia/Tokyo");
  assert.equal(timed?.startsTime, "19:00", "没给时刻就从日期里读");
});

test("只有 live 与 ticket 的报告算演出：生放送、展览、快闪店都不算", async () => {
  const stream = await liveFact({ category: "stream", deadlines: [{ kind: "event", at: "2026-10-03" }], subjects: ["girls-band-cry"] });
  assert.equal(await linkLiveEvent(stream.factId, stream.articleId), null, "生放送不是演出");
  const collab = await liveFact({ category: "collab", deadlines: [{ kind: "event", at: "2026-10-04" }], subjects: ["bang-dream"] });
  assert.equal(await linkLiveEvent(collab.factId, collab.articleId), null, "展览与快闪店不是演出");
  const ticket = await liveFact({ category: "ticket", deadlines: [{ kind: "event", at: "2026-10-18" }], subjects: ["kuzumimizuku"] });
  assert.notEqual(await linkLiveEvent(ticket.factId, ticket.articleId), null, "票务报告说的就是这场演出");

  const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM live_events le JOIN facts f ON f.live_event_id = le.id WHERE f.id IN (${stream.factId}, ${collab.factId}, ${ticket.factId})`;
  assert.equal(count!.n, 1, "只该留下票务那一条");
});

test("同一场演出只有一行：同一条事实挂两次、再来一份报告，都不会多出页面", async () => {
  const first = await liveFact({ category: "live", deadlines: [{ kind: "event", at: "2026-11-03" }], subjects: ["girls-band-cry"], title: `赤色の響祭 ${T}` });
  const id = await linkLiveEvent(first.factId, first.articleId);
  assert.notEqual(id, null);
  assert.equal(await linkLiveEvent(first.factId, first.articleId), id, "重复挂同一条事实还是同一行");

  // 第二份报告写的是同一场（同一天、同一个会场），键相同 → 同一行；这次它带上了会场与时刻。
  const second = await report({
    category: "ticket",
    deadlines: [{ kind: "event", at: "2026-11-03T18:30" }],
    subjects: ["girls-band-cry"],
    title: `赤色の響祭 先行 ${T}`,
    text: "会場：ぴあアリーナMM 18:30 開演",
  });
  await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${first.factId}, ${second}, 'report')`;
  assert.equal(await linkLiveEvent(first.factId, second), id, "同一场演出的第二份报告不新建实体");
  const [row] = await sql<{ venue: string | null; starts_time: string | null }[]>`SELECT venue, starts_time FROM live_events WHERE id = ${id}`;
  assert.deepEqual({ ...row }, { venue: "ぴあアリーナMM", starts_time: "18:30" }, "补空不覆盖：第二份报告补上了会场与时刻");

  // 另一天就是另一场。
  const other = await liveFact({ category: "live", deadlines: [{ kind: "event", at: "2026-11-04" }], subjects: ["girls-band-cry"] });
  assert.notEqual(await linkLiveEvent(other.factId, other.articleId), id, "另一天是另一场演出");

  const [rows] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM live_events WHERE id = ${id}`;
  assert.equal(rows!.n, 1);
});

test("同一场演出被两家分别报道（主体标成企划、会场写法不同）也只留一页", async () => {
  // 香港 2026-10-02 实测的裂法：一篇把主体标成企划 `girls-band-cry`（企划的公告先出现），另一篇标成
  // 乐队 `togenashi-togeari`；会场一处写 `AsiaWorld-Summit（アジアワールド・エキスポ Hall 2）`，另一处
  // 写 `AsiaWorld-Summit (アジア・ワールド・エキスポ 2号館)`。词表里没有这座场馆，键于是错开成两行。
  const show = `アジアツアー 香港公演 ${T}`;
  const one = await liveFact({
    category: "live",
    subjects: ["girls-band-cry", "togenashi-togeari"],
    title: show,
    deadlines: [{ kind: "event", at: "2026-10-02T19:00" }],
    live: { venue: "AsiaWorld-Summit（アジアワールド・エキスポ Hall 2）", startsTime: "19:00", status: "scheduled" },
    text: "会場：AsiaWorld-Summit（アジアワールド・エキスポ Hall 2） 19:00 開演",
  });
  const two = await liveFact({
    category: "ticket",
    subjects: ["togenashi-togeari"],
    title: show,
    deadlines: [{ kind: "event", at: "2026-10-02T19:00" }],
    live: { venue: "AsiaWorld-Summit (アジア・ワールド・エキスポ 2号館)", startsTime: "19:00", status: "scheduled" },
    text: "会場：AsiaWorld-Summit (アジア・ワールド・エキスポ 2号館) 19:00 開演",
  });
  const id = await linkLiveEvent(one.factId, one.articleId);
  assert.notEqual(id, null);
  assert.equal(await linkLiveEvent(two.factId, two.articleId), id, "同一天同一开演时刻、演出名一致、会场写法对得上 ⇒ 同一页");
  const [kept] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM live_events WHERE starts_on = '2026-10-02' AND starts_time = '19:00' AND title = ${show}`;
  assert.equal(kept!.n, 1, "只留一行");
  const facts = await sql<{ live_event_id: string }[]>`SELECT live_event_id FROM facts WHERE id IN (${one.factId}, ${two.factId})`;
  assert.deepEqual(facts.map((f) => Number(f.live_event_id)), [id, id], "两条事实挂的是同一行");

  // 反过来：同一天同一时刻、同一个会场，但演出名不同 —— 对盘时各乐队各一页，这条规则没有被合并掉。
  const other = await liveFact({
    category: "live",
    subjects: ["mygo"],
    title: `別の対バン ${T}`,
    deadlines: [{ kind: "event", at: "2026-10-02T19:00" }],
    live: { venue: "AsiaWorld-Summit（アジアワールド・エキスポ Hall 2）", startsTime: "19:00", status: "scheduled" },
    text: "会場：AsiaWorld-Summit（アジアワールド・エキスポ Hall 2） 19:00 開演",
  });
  assert.notEqual(await linkLiveEvent(other.factId, other.articleId), id, "名字不同就是另一场");
});

test("日期取自条目自己的那一次分析，标题取演出类报告的中文标题", async () => {
  // 一篇 live（写着演出名，没有日期）与一篇 ticket（写着日期）同属一条事实。
  const named = await report({ category: "live", deadlines: [], subjects: ["girls-band-cry"], title: `ガールズバンドクライ Special LIVE “赤色の響祭” ${T}` });
  const dated = await report({ category: "ticket", deadlines: [{ kind: "event", at: "2026-12-03" }], subjects: ["girls-band-cry"], title: `赤色の響祭 先行抽選 ${T}` });
  const factId = await factOf([named, dated], `ガルリフ先行抽選販売受付開始 ${T}`);

  const id = await linkLiveEvent(factId, dated);
  assert.notEqual(id, null);
  const [row] = await sql<{ title: string; starts_on: string; venue: string | null }[]>`SELECT title, starts_on::text AS starts_on, venue FROM live_events WHERE id = ${id}`;
  assert.equal(row!.starts_on, "2026-12-03", "日期来自写着日期的报告");
  assert.equal(row!.title, `ガールズバンドクライ Special LIVE “赤色の響祭” ${T}`, "标题取演出类报告的站内中文标题，而不是票务报告的");
  assert.equal(row!.venue, null);
});

test("阶段跟着公告、日历与票务日期走", async () => {
  const stage = async (opts: Omit<ReportOpts, "category"> & { factTitle: string }): Promise<string> => {
    const { factId, articleId } = await liveFact({ subjects: ["mygo"], category: "live", ...opts });
    const id = await linkLiveEvent(factId, articleId);
    const live = await loadLive(String((await sql<{ public_id: string }[]>`SELECT public_id FROM live_events WHERE id = ${id}`)[0]!.public_id), NOW);
    return live!.stage;
  };
  assert.equal(await stage({ factTitle: "还没消息", deadlines: [{ kind: "event", at: "2026-12-01" }] }), "announced");
  assert.equal(await stage({ factTitle: "抽选中", deadlines: [{ kind: "event", at: "2026-12-02" }, { kind: "lottery_start", at: "2026-10-05" }] }), "ticketing");
  assert.equal(await stage({ factTitle: "已开售", deadlines: [{ kind: "event", at: "2026-12-03" }, { kind: "sale_start", at: "2026-09-20" }] }), "on_sale");
  assert.equal(await stage({ factTitle: "今天", deadlines: [{ kind: "event", at: "2026-10-01" }] }), "live_day");
  assert.equal(await stage({ factTitle: "昨天", deadlines: [{ kind: "event", at: "2026-09-30" }] }), "finished");
  assert.equal(await stage({ factTitle: "取消了", deadlines: [{ kind: "event", at: "2026-12-05" }], live: { status: "cancelled" } }), "cancelled", "公告说取消，日历不再往前推");
  assert.equal(await stage({ factTitle: "延期了", deadlines: [{ kind: "event", at: "2026-12-06" }], live: { status: "postponed" } }), "postponed");
});

test("阶段 B 读出的演出名换掉阶段 A 的临时标题，会场与时刻仍然只补空", async () => {
  const show = await liveFact({ category: "ticket", deadlines: [{ kind: "event", at: "2026-12-20" }], subjects: ["roselia"], title: `ガルリフ先行抽選 ${T}` });
  const id = await linkLiveEvent(show.factId, show.articleId);
  const read = async () => (await sql<{ title: string; venue: string | null; starts_time: string | null }[]>`
    SELECT title, venue, starts_time FROM live_events WHERE id = ${id}`)[0]!;
  assert.equal((await read()).title, `ガルリフ先行抽選 ${T}`, "还没有演出名时先拿报告的中文标题");

  // 同一条报告重新分析（阶段 B），这次读出了这场演出本身：名字、会场、开演时刻。
  await sql`UPDATE analyses SET output = ${sql.json({
    scope: "single",
    fact: { deadlines: [{ kind: "event", at: "2026-12-20" }] },
    live: { title: `Roselia 单独公演 ${T}`, venue: "ぴあアリーナMM", startsTime: "18:30", endsOn: null, status: "scheduled" },
  } as never)} WHERE article_id = ${show.articleId}`;
  assert.equal(await linkLiveEvent(show.factId, show.articleId), id, "重跑不新建实体");
  assert.deepEqual({ ...(await read()) }, { title: `Roselia 单独公演 ${T}`, venue: "ぴあアリーナMM", starts_time: "18:30" });
});

test("演出页跟着报告一起下架，主体页只列还有公开报告的演出", async () => {
  const { factId, articleId } = await liveFact({ category: "live", deadlines: [{ kind: "event", at: "2026-11-14" }], subjects: ["mygo"], title: `MyGO 9th ${T}` });
  const id = await linkLiveEvent(factId, articleId);
  const [live] = await sql<{ public_id: string }[]>`SELECT public_id FROM live_events WHERE id = ${id}`;
  const publicId = live!.public_id;

  const loaded = await loadLive(publicId, NOW);
  assert.equal(loaded?.subject, "mygo");
  assert.equal(loaded?.reportCount, 1);
  assert.equal(loaded?.reports.length, 1, "报告按同一套可见性取");
  assert.equal(loaded?.story?.publicId.length, 36, "演出的报告挂在哪条事件上也要给出来");
  assert.deepEqual((await liveRefForStory(Number((await sql<{ story_id: number }[]>`SELECT story_id FROM facts WHERE id = ${factId}`)[0]!.story_id), NOW))?.publicId, publicId);
  assert.ok((await livesForSubject("mygo", NOW)).some((l) => l.publicId === publicId));

  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${articleId}`;
  assert.equal(await loadLive(publicId, NOW), null, "报告全下架了，演出页跟着 404");
  assert.equal(await liveRefForStory(Number((await sql<{ story_id: number }[]>`SELECT story_id FROM facts WHERE id = ${factId}`)[0]!.story_id), NOW), null);
  assert.ok(!(await livesForSubject("mygo", NOW)).some((l) => l.publicId === publicId), "主体页也不再列它");
});

test("公开接口答一场演出，未知的 id 是 404", async () => {
  const app = await buildApp();
  try {
    const today = beijingDate(new Date());
    const { factId, articleId } = await liveFact({ category: "live", deadlines: [{ kind: "event", at: addDays(today, 30) }], subjects: ["roselia"], title: `Roselia Live ${T}` });
    const id = await linkLiveEvent(factId, articleId);
    const [live] = await sql<{ public_id: string }[]>`SELECT public_id FROM live_events WHERE id = ${id}`;

    const res = await app.inject({ method: "GET", url: `/api/site/lives/${live!.public_id}` });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().subject, "roselia");
    assert.equal(res.json().stage, "announced");
    assert.match(String(res.headers["cache-control"]), /^public/);

    const missing = await app.inject({ method: "GET", url: `/api/site/lives/${T}-nothing` });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().detail, "live not public");
  } finally {
    await app.close();
  }
});
