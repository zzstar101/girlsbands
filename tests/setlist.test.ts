// 曲目单（W16）：一场演出散场之后，从现场报道的正文里把曲目找出来；读者补的那份由后台采纳进库。
// 写的是它会出错的方式：模型报了个正文里根本没写的歌名、还没结束的演出被提前问过一遍、同一篇报道重扫
// 留下两份、被下架的报道还拿它的曲目单挂在页面上、读者补的那一行没经过核对就进页面。
import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { adoptReaderSetlist, parseReaderLines, sweepSetlists } from "@girlsbands/backend/lives/setlists";
import { loadLive } from "@girlsbands/backend/publication/lives";

const key = `setlist-${tag()}`;
const now = new Date();
const at = (hours: number) => new Date(+now - hours * 3600_000);

/** 模型这一轮报哪几首：测试自己摆。 */
let songs: unknown[] = [];
const provider = await stub(() => ({
  id: "local",
  choices: [{ message: { content: JSON.stringify({ songs }) } }],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
}));
// 结构抽取这一步跑在 STRUCTURE_MODEL（tests/setup.ts 预设的是 DashScope 的 qwen），三家都指到这个桩上。
for (const name of ["DASHSCOPE_BASE_URL", "ZHIPU_BASE_URL", "DEEPSEEK_BASE_URL"]) process.env[name] = `${provider.url}/v1`;
for (const name of ["DASHSCOPE_API_KEY", "ZHIPU_API_KEY", "DEEPSEEK_API_KEY"]) process.env[name] = "test-key";
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

let n = 0;

async function source(): Promise<string> {
  const id = `${key}-s${++n}`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,config,first_party,next_fetch_at)
    VALUES (${id},${`媒体 ${n}`},'rss','T1','editorial',${sql.json({} as never)},true,'2100-01-01')`;
  return id;
}

/** 一场演出。散场之后的扫描只认「已经结束」的，所以日期由测试挑。 */
async function liveEvent(startsOn: string, endsOn: string | null = null): Promise<{ id: number; publicId: string }> {
  const publicId = `L${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const [row] = await sql`INSERT INTO live_events (public_id,title,subject_entity,venue,timezone,starts_on,ends_on,starts_time,status)
    VALUES (${publicId},${`演出 ${key}`},'togenashi-togeari','ぴあアリーナMM','Asia/Tokyo',${startsOn},${endsOn},'18:00','scheduled') RETURNING id`;
  return { id: Number(row!.id), publicId };
}

/** 一场演出下面的一条 fact，报道都挂在它上面。 */
async function factFor(liveId: number): Promise<number> {
  const [row] = await sql`INSERT INTO facts (public_id,title,subject,action,object,conditions,live_event_id)
    VALUES (${`f-${randomUUID()}`},${`演出 ${key}`},'トゲナシトゲアリ','举办','演唱会','无',${liveId}) RETURNING id`;
  return Number(row!.id);
}

/** 一篇报道：正文就是曲目单要接地的那份原文。 */
async function report(sourceId: string, factId: number, body: string, hours: number, listed = true): Promise<string> {
  const id = `${key}-${randomUUID()}`;
  const date = at(hours);
  await sql`INSERT INTO articles (id,source_id,identity_key,url,title,timeline_at,discovered_at,published_at,body_text,body_status)
    VALUES (${id},${sourceId},${id},${`https://example.org/${id}`},${`报道 ${++n}`},${date},${date},${date},${body},'ok')`;
  const [a] = await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,title_zh,summary_zh,score,selected,output)
    VALUES (${id},1,'rule','pass',${`报道 ${n}`},${`报道 ${n}`},70,true,${sql.json({ scope: "single" } as never)}) RETURNING id`;
  await sql`INSERT INTO publications (article_id,analysis_id,source_id,title,summary,url,channel,first_party,timeline_at,discovered_at,published_at,sort_at,
    story_id,fact_id,selected,eligible,visible_after,tags,body_mode,score)
    VALUES (${id},${a!.id},${sourceId},${`报道 ${n}`},${`报道 ${n}`},${`https://example.org/${id}`},'news',true,${date},${date},${date},${date},
    null,${factId},true,${listed},${date},${[key]},'full',70)`;
  await sql`INSERT INTO fact_articles (fact_id,article_id,role,evidence) VALUES (${factId},${id},'report','无')`;
  return id;
}

async function storedLines(liveEventId: number): Promise<Array<{ source: string; position: number; title: string; is_encore: boolean; is_cover: boolean; article_id: string | null }>> {
  return await sql`SELECT source, position, title, is_encore, is_cover, article_id FROM setlist_entries
    WHERE live_event_id = ${liveEventId} ORDER BY source, position`;
}

const BODY = [
  "本日のセットリスト",
  "1. 名もなき恋の歌",
  "2. 空白とカタルシス",
  "アンコール",
  "3. 運命の華",
].join("\n");

test("已经结束的演出：正文里的曲目落库，页面按顺序读出来", async () => {
  const live = await liveEvent("2026-09-20");
  const fact = await factFor(live.id);
  const article = await report(await source(), fact, BODY, 3);
  songs = [
    { title: "名もなき恋の歌", encore: false, cover: false, quote: "1. 名もなき恋の歌" },
    { title: "空白とカタルシス", encore: false, cover: false, quote: "2. 空白とカタルシス" },
    { title: "運命の華", encore: true, cover: false, quote: "3. 運命の華" },
  ];
  assert.deepEqual(await sweepSetlists(now), { scanned: 1, entries: 3, failed: 0 });

  const rows = await storedLines(live.id);
  assert.deepEqual(rows.map((r) => r.title), ["名もなき恋の歌", "空白とカタルシス", "運命の華"]);
  assert.deepEqual(rows.map((r) => r.is_encore), [false, false, true]);
  assert.ok(rows.every((r) => r.source === "article" && r.article_id === article));

  const view = (await loadLive(live.publicId, now))!;
  assert.equal(view.setlistScanned, true);
  assert.deepEqual(view.setlist.map((s) => s.title), ["名もなき恋の歌", "空白とカタルシス", "運命の華"]);
  assert.deepEqual(view.setlist.map((s) => s.isEncore), [false, false, true]);
  assert.ok(view.setlist.every((s) => s.itemId === article), "每一行都要指得回是哪一篇报道");
  assert.deepEqual(await sweepSetlists(now), { scanned: 0, entries: 0, failed: 0 }, "问过的演出不再问第二遍");
});

test("模型报了个正文里没有的歌名：不落库，但记下「找过了」", async () => {
  const live = await liveEvent("2026-09-21");
  const fact = await factFor(live.id);
  await report(await source(), fact, BODY, 3);
  songs = [
    { title: "正文里没有的歌", encore: false, cover: false, quote: "1. 名もなき恋の歌" },
    { title: "空白とカタルシス", encore: false, cover: false, quote: "2. 空白とカタルシス" },
  ];
  assert.deepEqual(await sweepSetlists(now), { scanned: 1, entries: 1, failed: 0 });

  const rows = await storedLines(live.id);
  assert.deepEqual(rows.map((r) => r.title), ["空白とカタルシス"], "核不到原文的那一行丢掉，其余照收");
  const view = (await loadLive(live.publicId, now))!;
  assert.equal(view.setlistScanned, true);
});

test("正文里一首都没有：不落库，但页面说得出「找过，原文里没有」", async () => {
  const live = await liveEvent("2026-09-22");
  const fact = await factFor(live.id);
  await report(await source(), fact, "本日はありがとうございました。", 3);
  songs = [];
  assert.deepEqual(await sweepSetlists(now), { scanned: 1, entries: 0, failed: 0 });
  assert.equal((await storedLines(live.id)).length, 0);
  const view = (await loadLive(live.publicId, now))!;
  assert.equal(view.setlistScanned, true);
  assert.deepEqual(view.setlist, []);
});

test("还没结束的演出不问：日期没到就不该有曲目单", async () => {
  const live = await liveEvent("2099-01-01");
  const fact = await factFor(live.id);
  await report(await source(), fact, BODY, 3);
  songs = [{ title: "名もなき恋の歌", encore: false, cover: false, quote: "1. 名もなき恋の歌" }];
  assert.deepEqual(await sweepSetlists(now), { scanned: 0, entries: 0, failed: 0 });
  assert.equal((await storedLines(live.id)).length, 0);
  const [row] = await sql<{ scanned: Date | null }[]>`SELECT setlist_scanned_at AS scanned FROM live_events WHERE id = ${live.id}`;
  assert.equal(row!.scanned, null, "没问过就不算「找过了」");
});

test("报道被下架：它带来的曲目行跟着消失，页面还在（下架不漏）", async () => {
  const live = await liveEvent("2026-09-23");
  const fact = await factFor(live.id);
  const s = await source();
  const withSetlist = await report(s, fact, BODY, 2);
  await report(s, fact, "会場の様子をお伝えします。", 4);
  songs = [{ title: "名もなき恋の歌", encore: false, cover: false, quote: "1. 名もなき恋の歌" }];
  assert.deepEqual(await sweepSetlists(now), { scanned: 1, entries: 1, failed: 0 });
  assert.deepEqual((await loadLive(live.publicId, now))!.setlist.map((s) => s.title), ["名もなき恋の歌"]);

  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withSetlist}`;
  const view = (await loadLive(live.publicId, now))!;
  assert.deepEqual(view.setlist, [], "下架的报道不能继续把曲目挂在页面上");
  assert.equal(view.reportCount, 1, "另一篇还在，页面没有跟着下架");
});

test("读者补的那份：一行一首、アンコール之后算安可、正文照抄，采纳两次不会写两份", async () => {
  const live = await liveEvent("2099-02-02");
  await report(await source(), await factFor(live.id), "会場の様子をお伝えします。", 3);
  const content = [
    "曲目单",
    "M1 名もなき恋の歌",
    "M2 空白とカタルシス（カバー）",
    "アンコール",
    "3. 運命の華",
  ].join("\n");
  const [fb] = await sql`INSERT INTO feedback (content,page_url,source_hash,forward_error)
    VALUES (${content},${`https://aniband.example/live/${live.publicId}`},${`h-${randomUUID()}`},'pending') RETURNING id`;
  const first = await adoptReaderSetlist(Number(fb!.id), "tester");
  assert.deepEqual(first, { ok: true, liveEventId: live.id, added: 3 });

  const rows = await storedLines(live.id);
  assert.deepEqual(rows.map((r) => r.title), ["名もなき恋の歌", "空白とカタルシス", "運命の華"]);
  assert.ok(rows.every((r) => r.source === "reader" && r.article_id === null));
  assert.deepEqual(rows.map((r) => r.is_cover), [false, true, false]);
  assert.deepEqual(rows.map((r) => r.is_encore), [false, false, true]);
  assert.deepEqual(rows.map((r) => r.position), [1, 2, 3], "编号与「M1」这类前缀不进数据库");

  assert.deepEqual(await adoptReaderSetlist(Number(fb!.id), "tester"), first, "再点一次还是同一份");
  assert.equal((await storedLines(live.id)).length, 3);

  const view = (await loadLive(live.publicId, now))!;
  assert.deepEqual(view.setlist.map((s) => s.source), ["reader", "reader", "reader"]);
  assert.ok(view.setlist.every((s) => s.itemId === null), "读者补的行没有出处可点");

  const [audited] = await sql<{ action: string }[]>`SELECT action FROM audit_log WHERE subject = ${`feedback:${fb!.id}`} ORDER BY id DESC LIMIT 1`;
  assert.equal(audited?.action, "feedback.setlist");

  const [orphan] = await sql`INSERT INTO feedback (content,page_url,source_hash,forward_error)
    VALUES ('名もなき恋の歌','https://aniband.example/subscribe',${`h-${randomUUID()}`},'pending') RETURNING id`;
  assert.deepEqual(await adoptReaderSetlist(Number(orphan!.id), "tester"), { ok: false, reason: "no-target" });
});

test("散场当晚的报道没写曲目单：第二天补发的那篇还会被看一眼", async () => {
  const live = await liveEvent("2026-09-24");
  const fact = await factFor(live.id);
  await report(await source(), fact, "本日はありがとうございました。", 3);
  songs = [];
  assert.deepEqual(await sweepSetlists(now), { scanned: 1, entries: 0, failed: 0 });

  // 第二天补发的报道：发现时间晚于上一次「找过了」，所以那一场会再被问一次。
  await report(await source(), fact, BODY, -0.5);
  songs = [{ title: "名もなき恋の歌", encore: false, cover: false, quote: "1. 名もなき恋の歌" }];
  assert.deepEqual(await sweepSetlists(new Date(+now + 3600_000)), { scanned: 1, entries: 1, failed: 0 });
  assert.deepEqual((await storedLines(live.id)).map((r) => r.title), ["名もなき恋の歌"]);
  assert.deepEqual(await sweepSetlists(new Date(+now + 7200_000)), { scanned: 0, entries: 0, failed: 0 }, "之后没有新报道就不再问");
});

test("一行一首的认法：标题行与空行丢掉，翻唱标出来，曲名照写", () => {
  const lines = parseReaderLines("セットリスト\n\n1. 「名もなき恋の歌」\n- 空白とカタルシス（cover）\nアンコール\n運命の華");
  assert.deepEqual(lines, [
    { title: "名もなき恋の歌", isEncore: false, isCover: false, quote: "1. 「名もなき恋の歌」" },
    { title: "空白とカタルシス", isEncore: false, isCover: true, quote: "- 空白とカタルシス（cover）" },
    { title: "運命の華", isEncore: true, isCover: false, quote: "運命の華" },
  ]);
  assert.deepEqual(parseReaderLines("   \nセットリスト\n"), []);
});
