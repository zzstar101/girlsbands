// Topic pages: which articles a topic takes, its chronicle and counts.
// Written before the code, from the ways it can go wrong:
// - a band topic takes an article about another band that only mentions it (several subjects,
//   its name nowhere in the title), or drops one about it whose title names it in English, in another
//   case, next to Chinese text, or where it is the article's only subject;
// - a Latin name matches inside another word ("Roselian" is not Roselia); a headline naming a band
//   that is not a subject of the article gets in;
// - an info-field topic stops taking its tags;
// - the chronicle keeps a month's latest events instead of its most important ones, lists one event
//   twice across months, files 00:30 Beijing time on the 1st under the previous month, links an event
//   with a public story page to the article, or counts a withdrawn report's source;
// - a band's chronicle (its milestones) shows an interview column, somebody else's commentary or another
//   organisation's appraisal (even from an official source), drops the band's own Live and tickets,
//   or keeps more of a kind than the pack allows in a month;
// - withdrawn or not yet released articles appear in a list, a count or the chronicle;
// - an article or story page names a topic its reports do not belong to;
// - a topic without content has no page, or an unknown slug or a page past the end has one;
// - the picked view and the wider view disagree about which pool they are, or the wider one is not the
//   pool its count names.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { beijingDate } from "@girlsbands/contracts/time";
import { closeDb, sql } from "@girlsbands/backend/db";
import { upsertMaterial } from "@girlsbands/backend/content/materials";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { publishArticle } from "@girlsbands/backend/publication/publish";
import { loadTopicPage, listTopicSummaries, topicsOfStory } from "@girlsbands/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const OFFICIAL = `test-topics-official-${T}`;
const MEDIA = `test-topics-media-${T}`;
const OTHER = `test-topics-other-${T}`;
const BAND_BLOG = `test-topics-band-blog-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${OFFICIAL}, 'Official', 'rss', 'T1', 'editorial', true, '2100-01-01'),
    (${MEDIA}, 'Media', 'rss', 'T2', 'editorial', false, '2100-01-01'),
    (${OTHER}, 'Other media', 'rss', 'T2', 'editorial', false, '2100-01-01')`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, owner_entity_id, next_fetch_at) VALUES
    (${BAND_BLOG}, 'Ave Mujica blog', 'rss', 'T1', 'editorial', true, 'ave-mujica', '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
interface Report {
  source?: string;
  at: Date;
  title: string;
  originalTitle?: string;
  subjects?: string[];
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** The tag a category contributes: it puts the report in that category's field topic, and a form's. */
const CATEGORY_TAG: Record<string, string> = {
  notice: "中止/延期", ticket: "开售/抽选", live: "新 Live", release: "数字发行", merch: "周边商品",
  stream: "直播/生配信", collab: "联动企划", member: "成员动态", media: "媒体访谈", other: "其他",
};

/** A published report; `fact` links it to a fact before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const category = r.category ?? "release";
  const { articleId } = await upsertMaterial({
    sourceId: r.source ?? MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.originalTitle ?? r.title, bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${category}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${r.subjects ?? []}, ${[CATEGORY_TAG[category] ?? "其他", ...(r.tags ?? [])]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

test("a band topic takes the articles about it, not the ones that only mention it", async () => {
  const about = await report({ at: hoursAgo(30), title: `トゲナシトゲアリ 首张 Single 发售 ${T}`, subjects: ["togenashi-togeari"] });
  const release = await report({ at: hoursAgo(31), title: `トゲナシトゲアリ 新 Single リリース ${T}`, subjects: ["togenashi-togeari"] });
  const english = await report({ at: hoursAgo(32), title: `新作发售情报 ${T}`, originalTitle: `Togenashi Togeari announces a new single ${T}`, subjects: ["togenashi-togeari", "mygo"] });
  const subpoena = await report({ at: hoursAgo(33), title: `加州检察长向 MyGO!!!!! 发出传票 ${T}`, subjects: ["mygo", "togenashi-togeari", "roselia"] });
  const lowerCase = await report({ at: hoursAgo(34), title: `mygo 公布新的演出计划 ${T}`, subjects: ["mygo", "togenashi-togeari"] });
  const pact = await report({ at: hoursAgo(35), title: `二十余家经纪公司签署联合声明 ${T}`, subjects: ["mygo", "togenashi-togeari", "roselia"] });
  const metadata = await report({ at: hoursAgo(36), title: `Roselian 音乐节公布 MyGO!!!!! 出演 ${T}`, subjects: ["roselia", "mygo"] });
  const adjacent = await report({ at: hoursAgo(37), title: `公布Roselia的新 Live ${T}`, subjects: ["roselia", "mygo"] });
  const headline = await report({ at: hoursAgo(38), title: `トゲナシトゲアリ 被一篇盘点提到 ${T}`, subjects: ["roselia"] });
  const ticket = await report({ at: hoursAgo(39), title: `抽选受付开始 ${T}`, category: "ticket", tags: ["开售/抽选"] });

  const togenashi = await members("togenashi-togeari");
  for (const id of [about, release, english]) assert.ok(togenashi.includes(id), "about the band");
  for (const id of [subpoena, lowerCase, pact, headline]) assert.ok(!togenashi.includes(id), "only mentions the band");
  const mygo = await members("mygo");
  for (const id of [subpoena, lowerCase, metadata]) assert.ok(mygo.includes(id), "about MyGO!!!!!");
  for (const id of [english, pact]) assert.ok(!mygo.includes(id), "only mentions MyGO!!!!!");
  const roselia = await members("roselia");
  assert.ok(roselia.includes(adjacent), "Roselia next to Chinese text");
  assert.ok(!roselia.includes(metadata), "Roselian is not Roselia");
  assert.ok((await members("ticket")).includes(ticket), "an info field takes its tag");

  // The article page names the topics it belongs to — including the project whose page carries it.
  const topicsOf = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
    return (JSON.parse(res.body) as { topics: Array<{ slug: string }> }).topics.map((t) => t.slug);
  };
  assert.deepEqual(await topicsOf(about), ["girls-band-cry", "togenashi-togeari", "release"]);
  assert.deepEqual(await topicsOf(subpoena), ["bang-dream", "mygo", "release"]);
  assert.deepEqual(await topicsOf(pact), ["release"]);
  // A content form is a tag: it never shows up as a link.
  assert.deepEqual(await topicsOf(ticket), ["ticket"]);
});

test("the chronicle keeps each month's most important events, once each, in Beijing months", async () => {
  // The 1st of last month, 00:30 in Beijing (16:30 UTC the day before).
  const today = beijingDate(Date.now());
  const [y, m] = today.split("-").map(Number) as [number, number];
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const firstOfLastMonth = new Date(`${lastMonth}-01T00:30:00+08:00`);
  const at = (minutes: number) => new Date(firstOfLastMonth.getTime() + minutes * 60_000);

  const launch = await story(`首张 Single 发售 ${T}`);
  const launchFact = await fact(launch.id, "发售决定");
  const official = await report({ source: OFFICIAL, at: at(0), title: `トゲナシトゲアリ 首张 Single 发售 ${T}`, tags: ["新作发售"], score: 95, fact: launchFact });
  await report({ source: OTHER, at: at(5), title: `媒体：首张 Single 发售 ${T}`, tags: ["新作发售"], score: 70, fact: launchFact });
  const gone = await report({ source: MEDIA, at: at(6), title: `撤回的报道：首张 Single ${T}`, tags: ["新作发售"], score: 70, fact: launchFact });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${gone}`;
  // A second development of the same story the same month.
  const followFact = await fact(launch.id, "配信リリース");
  await report({ at: at(600), title: `首张 Single 配信リリース ${T}`, tags: ["新作发售"], score: 60, fact: followFact });
  const minor: string[] = [];
  // Five more eligible releases of lower importance; the
  // latest one is the least important.
  for (let i = 0; i < 5; i++) minor.push(await report({ at: at(1000 + i * 60), title: `Album 后续发售 ${i} ${T}`, tags: ["新作发售"], score: 85 - i, category: "release" }));

  const data = await page("release");
  const month = data.chronicle.find((c) => c.month === lastMonth);
  assert.ok(month, "the 1st at 00:30 Beijing time belongs to its own month");
  const listed = month.events.map((e) => e.id);
  assert.equal(month.events.length, 5, "five events a month");
  assert.equal(listed.filter((id) => id === official).length, 1, "the story once, by its most important report");
  assert.ok(!listed.includes(minor[4]!), "the least important event drops out, though it is the latest");
  const lead = month.events.find((e) => e.id === official)!;
  assert.equal(lead.href, `/story/${launch.publicId}`, "an event with a public story links to it");
  assert.ok(month.events.find((e) => e.id === minor[0])!.href.startsWith("/items/"), "an event without a story links to the article");
  assert.deepEqual(listed, [...month.events].sort((a, b) => b.at.localeCompare(a.at)).map((e) => e.id), "newest first within a month");
  assert.equal(month.events.find((e) => e.id === minor[0])?.kind, "release", "an info field keeps substantial releases");
  // 内容形态主题不出页面（只是标签），所以这里只剩方向主题。
  assert.deepEqual(await topicsOfStory(launch.id), [{ slug: "release", name: "新作与发售" }], "the story page names the topic of its reports");
});

test("a band's band prioritizes its Live and ticket news over interviews and a low-scored notice", async () => {
  const today = beijingDate(Date.now());
  const [y, m] = today.split("-").map(Number) as [number, number];
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const at = (day: number) => new Date(`${lastMonth}-${String(day).padStart(2, "0")}T12:00:00+08:00`);
  const band = { subjects: ["ave-mujica"] };
  const live = await report({ ...band, at: at(3), title: `Ave Mujica 新 Live 公布 ${T}`, category: "live", score: 90 });
  const ticket = await report({ ...band, at: at(5), title: `Ave Mujica 抽选受付开始 ${T}`, category: "ticket", score: 85 });
  const notice = await report({ ...band, at: at(7), title: `Ave Mujica 公演中止のお知らせ ${T}`, category: "notice", score: 60 });
  const interview = await report({ ...band, source: BAND_BLOG, at: at(9), title: `Ave Mujica 成员访谈 ${T}`, category: "media", score: 99 });
  const commentary = await report({ ...band, at: at(11), title: `评论：Ave Mujica 的路线之争 ${T}`, category: "media", score: 98 });
  const othersAppraisal = await report({ ...band, source: OFFICIAL, at: at(13), title: `他社测评：Ave Mujica 的现场 ${T}`, category: "media", score: 97 });

  const data = await page("ave-mujica");
  assert.deepEqual(data.chronicle, [], "a band has its band instead of the monthly rail");
  const month = data.milestones.filter((ms) => ms.date.startsWith(lastMonth));
  const listed = month.map((ms) => ms.href);
  for (const id of [interview, commentary, othersAppraisal, notice]) assert.ok(!listed.includes(`/items/${id}`), "no interviews, nor others' commentary or appraisal, and a below-threshold notice does not fill a slot");
  assert.deepEqual([...listed].sort(), [live, ticket].map((id) => `/items/${id}`).sort(), "Live and tickets; ordinary news does not fill an empty slot");
  assert.deepEqual(month.map((ms) => ms.kind), ["live", "ticket"], "oldest first, each with its kind");
  assert.deepEqual(month.map((ms) => ms.major), [false, false], "nothing picked up automatically is set in bold");
  assert.equal((await page("release")).milestones.length, 0, "an info field has its rail, not a band");
});

test("a cross-month event keeps its first date while all selected progress stays readable", async () => {
  const current = beijingDate(Date.now()).slice(0, 7);
  const after = new Date(new Date(`${current}-01T00:00:00+08:00`).getTime() - 3600_000);
  const representativeMonth = beijingDate(after).slice(0, 7);
  const before = new Date(new Date(`${representativeMonth}-01T00:00:00+08:00`).getTime() - 3600_000);
  const launch = await story(`BanG Dream! 新 Live 公布 ${T}`);
  const originalFact = await fact(launch.id, "正式公布");
  const followFact = await fact(launch.id, "后续报道");
  const independent = await story(`BanG Dream! 独立进展 ${T}`);
  const independentFact = await fact(independent.id, "另一件事");
  const common = { subjects: ["bang-dream"], tags: ["新 Live"] };
  const earlier = await report({ ...common, at: before, title: `BanG Dream! 新 Live 公布 ${T}`, score: 80, fact: originalFact });
  const representative = await report({ ...common, at: after, title: `BanG Dream! 新 Live 公布详细报道 ${T}`, score: 95, fact: followFact });
  const other = await report({ ...common, at: after, title: `BanG Dream! 另一项独立 Live 进展 ${T}`, score: 80, fact: independentFact });

  for (const slug of ["bang-dream", "live"]) {
    const data = await page(slug);
    const entries = ["company", "band"].includes(data.topic.group)
      ? data.milestones.map((m) => ({ href: m.href, title: m.headline, month: m.date.slice(0, 7) }))
      : data.chronicle.flatMap((m) => m.events.map((e) => ({ href: e.href, title: e.title, month: m.month })));
    const kept = entries.filter((e) => e.href === `/story/${launch.publicId}`);
    assert.deepEqual(kept, [{ href: `/story/${launch.publicId}`, title: `BanG Dream! 新 Live 公布详细报道 ${T}`, month: beijingDate(before).slice(0, 7) }], `${slug}: one event, the earliest qualifying publication`);
    assert.ok(entries.some((e) => e.href === `/story/${independent.publicId}`), "a different event remains independent");
    const selected = await members(slug);
    for (const id of [earlier, representative, other]) assert.ok(selected.includes(id), "selected progress is not removed by chronicle deduplication");
  }
});

test("withdrawn articles stay out of lists, counts and the chronicle band", async () => {
  const kept = await report({ at: hoursAgo(5), title: `結束バンド 新 Live 公布 ${T}`, subjects: ["kessoku-band"] });
  const withdrawn = await report({ at: hoursAgo(4), title: `結束バンド 撤回的消息 ${T}`, subjects: ["kessoku-band"] });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("kessoku-band");
  assert.deepEqual(ids(data.items), [kept]);
  assert.equal(data.topic.total, 1);
  assert.deepEqual(data.milestones.map((m) => m.href), [`/items/${kept}`], "the chronicle band");
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "kessoku-band")!;
  assert.equal(summary.latest?.title, `結束バンド 新 Live 公布 ${T}`, "the index shows the newest public article");
});

test("every topic that has a page is listed; unknown topics and pages past the end have none", async () => {
  const empty = await page("pastel-palettes");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("pastel-palettes", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["band", "field", "genre"]);
  // The list comes from the pack, not a hand-kept number: adding a band or a direction must not need
  // a test edit. Content forms are missing on purpose — they tag articles and have no page of their own.
  const configured = JSON.parse(readFileSync(new URL("../industry/topics.json", import.meta.url), "utf8")) as {
    topics: Array<{ slug: string; group: string }>;
  };
  assert.deepEqual(
    body.topics.map((t) => t.slug).sort(),
    configured.topics.filter((t) => t.group !== "genre").map((t) => t.slug).sort(),
  );
});

test("a topic's picked view is the default; scope=all is exactly the pool its count names", async () => {
  const band = "hello-happy-world";
  const chosen = await report({ at: hoursAgo(2), title: `ハロー、ハッピーワールド！ 精选消息 ${T}`, subjects: [band], score: 90 });
  const listed = await report({ at: hoursAgo(3), title: `ハロー、ハッピーワールド！ 未入选消息 ${T}`, subjects: [band], score: 60, selected: false });

  const picked = (await loadTopicPage(band, 1, new Date(), "picked"))!;
  const all = (await loadTopicPage(band, 1, new Date(), "all"))!;
  assert.equal(picked.scope, "picked");
  assert.equal(all.scope, "all");
  assert.deepEqual(ids(picked.items), [chosen], "the picked view keeps its editorial seats");
  assert.deepEqual(ids(all.items), [chosen, listed], "the wider view is the pool, newest first");
  assert.equal(all.topic.poolTotal, 2, "the wider view is exactly the pool the count names");
  assert.deepEqual(all.milestones, picked.milestones, "the view changes the list, not the topic's history");

  // The endpoint reads one documented value and reads anything else as the default view. (The route
  // passes no `now`, so the picked view comes from the index cache — compare the two views to each
  // other rather than to a freshly read index.)
  const view = async (query: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/topics/${band}${query}` });
    return JSON.parse(res.body) as { scope: string; items: Array<{ id: string }> };
  };
  const served = await view("");
  assert.equal(served.scope, "picked");
  assert.equal((await view("?scope=nonsense")).scope, "picked", "an unknown value is the default view");
  assert.deepEqual((await view("?scope=nonsense")).items, served.items);
  const wider = await view("?scope=all");
  assert.equal(wider.scope, "all");
  assert.deepEqual(wider.items.map((i) => i.id), [chosen, listed], "the documented value is the wider pool");
});
