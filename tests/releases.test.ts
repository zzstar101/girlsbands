// 发售链：一张碟的身份、版本、店铺特典，以及序列号指向的那场演出。
// 写的是它们会出错的方式：分类与标签说不出「发布」却建出一行碟、模型的形态盖掉标签已经说清的形态、
// 后一条公告把前一条的价格与「先到先得」冲掉、序列号指错演出、第一条公告下架了发售页还留着。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { upsertMaterial } from "@girlsbands/backend/content/materials";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { publishArticle } from "@girlsbands/backend/publication/publish";
import { loadRelease, releaseOfStory, releasesForSubject } from "@girlsbands/backend/publication/releases";
import { releaseDayFromEve, releaseKindOf, releaseNameKey, releaseSubjectOf } from "@girlsbands/backend/releases/derive";
import { buildApp } from "../apps/api/src/app.ts";

const T = `rel-${tag()}`;
// JST 2026-10-01 12:00：东京的今天是 2026-10-01。
const NOW = new Date("2026-10-01T03:00:00Z");
const PUBLISHED = new Date("2026-09-30T00:00:00Z");
const SOURCE = `test-releases-${T}`;
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, config, next_fetch_at)
            VALUES (${SOURCE}, 'Official', 'rss', 'T1', 'editorial', ${sql.json({ timezone: "Asia/Tokyo" } as never)}, '2100-01-01')`;
});
after(async () => {
  await stopBoss();
  await closeDb();
});

let n = 0;

interface MaterialOpts {
  title: string;
  category?: string | null;
  tags?: string[];
  subjects?: string[];
  deadlines?: unknown[];
  release?: Record<string, unknown> | null;
  timezone?: string;
}

/** 一篇已分析的公告：source / article / analysis 三行，跟真实链路里的一篇情报一样。 */
async function material(o: MaterialOpts): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE,
    url: `https://example.org/${T}-${n}`,
    title: o.title,
    publishedAt: PUBLISHED,
    bodyText: `原文正文 ${o.title}`,
    bodyHtml: `<p>原文正文 ${o.title}</p>`,
    bodyStatus: "ok",
    via: "fetch",
  });
  await sql`UPDATE articles SET discovered_at = ${PUBLISHED}, timeline_at = ${PUBLISHED}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags, output)
    VALUES (${articleId}, 1, 'model', 'pass', ${o.category ?? "release"}, ${o.title}, '新的消息', 90, false, ${o.subjects ?? []}, ${o.tags ?? []},
            ${sql.json({ scope: "single", fact: { deadlines: o.deadlines ?? [] }, release: o.release ?? null } as never)})`;
  return articleId;
}

/** 一条事实（连同 story）挂在报告下面，然后走一遍真实的发布路径 —— 发售链就是在发布里写下的。 */
async function publish(articleIds: string[], title: string): Promise<{ factId: number; storyId: number }> {
  const [story] = await sql`INSERT INTO stories (public_id, title) VALUES (${randomUUID()}, ${title}) RETURNING id`;
  const [fact] = await sql`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${++n}`}, ${story!.id}, ${title}) RETURNING id`;
  for (const id of articleIds) {
    await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${id}, 'report')`;
  }
  for (const id of articleIds) await publishArticle(id, { now: NOW, releasedAt: PUBLISHED });
  return { factId: Number(fact!.id), storyId: Number(story!.id) };
}

const rowsOf = (title: string) => sql<{ id: string; public_id: string; kind: string; release_on: string | null; announced_on: string | null; quote: string | null }[]>`
  SELECT id, public_id, kind, release_on::text AS release_on, announced_on::text AS announced_on, quote FROM releases WHERE title = ${title}`;

test("分类与标签说不出「发布」就不建行，说得出的那一种说了算", () => {
  assert.equal(releaseKindOf({ category: "other", tags: ["访谈"], title: "インタビュー" }), null, "访谈不是发布");
  assert.equal(releaseKindOf({ category: "live", tags: [], title: "ワンマンライブ" }), null, "演出本身不是发布");
  assert.equal(releaseKindOf({ category: "release", tags: [], title: "新譜" }), "other", "分类说是发布就建，形态留给模型");
  assert.equal(releaseKindOf({ category: "merch", tags: [], title: "グッズ" }), "merch");
  assert.equal(releaseKindOf({ category: null, tags: ["新作发售"], title: "新譜" }), "other");
  assert.equal(releaseKindOf({ category: "release", tags: ["新作发售", "数字发行"], title: "配信リリース" }), "digital");
  assert.equal(releaseKindOf({ category: "release", tags: ["新作发售", "Single"], title: "シングル" }), "single");
  assert.equal(releaseKindOf({ category: "release", tags: ["新作发售", "Album"], title: "アルバム" }), "album");
  assert.equal(releaseKindOf({ category: "release", tags: ["新作发售", "Live 专辑"], title: "ライブ盤" }), "album");
  assert.equal(releaseKindOf({ category: "release", tags: ["新作发售", "EP"], title: "EP" }), "ep");
  assert.equal(releaseKindOf({ category: "release", tags: ["新作发售", "Blu-ray/DVD"], title: "Blu-ray BOX" }), "bluray", "同一包装里两张时以 Blu-ray 为准");
  assert.equal(releaseKindOf({ category: "release", tags: ["新作发售", "Blu-ray/DVD"], title: "DVD BOX" }), "dvd", "只写 DVD 的才是 DVD");

  assert.equal(releaseSubjectOf(["bang-dream", "mygo"]), "mygo", "碟是乐队发的，乐队优先于企划");
  assert.equal(releaseSubjectOf(["bang-dream"]), "bang-dream", "只有企划时落到企划");
  assert.equal(releaseSubjectOf(["不是主体"]), null, "不在词表里就不建：没有归属的碟无处安放");
});

test("模型的形态只在标签说不出时细化它", async () => {
  // 标签已经说清是周边，模型说是 album：标签赢（标签免费且确定）。
  const merchTitle = `联名亚克力 ${T}`;
  const merch = await material({ title: merchTitle, category: "release", tags: ["周边商品"], subjects: ["mygo"], release: { title: merchTitle, kind: "album" } });
  await publish([merch], merchTitle);
  assert.equal((await rowsOf(merchTitle))[0]!.kind, "merch");

  // 标签只说得出「其他」，模型读到的 album 才有用。
  const albumTitle = `初回限定盤 ${T}`;
  const album = await material({ title: albumTitle, category: "release", tags: ["初回限定盘"], subjects: ["mygo"], release: { title: albumTitle, kind: "album" } });
  await publish([album], albumTitle);
  assert.equal((await rowsOf(albumTitle))[0]!.kind, "album");
});

test("发售日：模型 grounded 的那天优先，否则用 structure 抽出的发售日", async () => {
  const byStructure = `结构给的日子 ${T}`;
  const a = await material({
    title: byStructure, tags: ["新作发售"], subjects: ["mygo"],
    deadlines: [{ kind: "release_start", at: "2026-11-03", note: "11月3日(火)発売" }],
  });
  await publish([a], byStructure);
  const row = (await rowsOf(byStructure))[0]!;
  assert.equal(row.release_on, "2026-11-03");
  assert.equal(row.quote, "11月3日(火)発売", "发售日的出处就是原文那句话");

  const byModel = `模型给的日子 ${T}`;
  const b = await material({
    title: byModel, tags: ["新作发售"], subjects: ["mygo"],
    deadlines: [{ kind: "release_start", at: "2026-11-03" }],
    release: { title: byModel, releaseOn: "2026-12-01" },
  });
  await publish([b], byModel);
  assert.equal((await rowsOf(byModel))[0]!.release_on, "2026-12-01", "模型读到的发售日优先于结构抽出的");

  const merch = `场贩周边 ${T}`;
  const c = await material({
    title: merch, tags: ["周边商品"], subjects: ["mygo"],
    deadlines: [{ kind: "release_start", at: "2026-11-03" }, { kind: "merch_start", at: "2026-10-10" }],
  });
  await publish([c], merch);
  assert.equal((await rowsOf(merch))[0]!.release_on, "2026-10-10", "周边用 merch_start 那天");

  const winter = `今冬発売 ${T}`;
  const d = await material({ title: winter, tags: ["新作发售"], subjects: ["mygo"] });
  await publish([d], winter);
  assert.equal((await rowsOf(winter))[0]!.release_on, null, "原文只写今冬就不推算");

  // Pre-save 公告只写「リリース前日 9月29日まで」：原文自己说了发售日是第二天。
  const eve = `Pre-save キャンペーン ${T}`;
  const e = await material({
    title: eve, tags: ["新作发售"], subjects: ["millsage"],
    deadlines: [{ kind: "other", at: "2026-09-29T20:00", note: "Pre-save活动截止", quote: "対象期間 リリース前日2026年9月29日(火) 20:00まで" }],
  });
  await publish([e], eve);
  assert.equal((await rowsOf(eve))[0]!.release_on, "2026-09-30", "「リリース前日」那天的后一天就是发售日");
  assert.equal(releaseDayFromEve("発売前日 2026年12月31日まで"), "2027-01-01", "跨年也对");
  assert.equal(releaseDayFromEve("2026年9月29日まで"), null, "没说「前日」就不推");
});

test("同一张碟换个说法再公告一次：并进原来那一行，补上发售日", async () => {
  const name = `鳴らす${T}`;
  const first = `millsage 1st Single「${name}」`;
  const a = await material({ title: first, tags: ["新作发售", "Single"], subjects: ["millsage"], release: { title: first, kind: "single" } });
  await publish([a], first);
  const before = (await rowsOf(first))[0]!;
  assert.equal(before.release_on, null);

  const second = `millsage「${name}」配信スタート`;
  const b = await material({
    title: second, tags: ["新作发售", "数字发行"], subjects: ["millsage"],
    deadlines: [{ kind: "release_start", at: "2026-09-30" }], release: { title: second, kind: "digital" },
  });
  await publish([b], second);
  assert.equal((await rowsOf(second)).length, 0, "不另起一行");
  const after = (await rowsOf(first))[0]!;
  assert.equal(after.id, before.id);
  assert.equal(after.release_on, "2026-09-30", "第二条公告补上了发售日");

  assert.equal(releaseNameKey("millsage 1st Single「鳴らす」"), releaseNameKey("millsage「鳴 らす」配信"));
  assert.notEqual(releaseNameKey("「鳴らす」"), releaseNameKey("「ピースフル・ピーシーズ！」"));
  assert.notEqual(
    releaseNameKey("劇場版総集編「ガールズバンドクライ」【前編】青春狂走曲（初回限定版）"),
    releaseNameKey("『ガールズバンドクライ』 2nd Anniversary LIVE"),
    "括号里是企划名的不算作品名",
  );
  assert.equal(releaseNameKey("『ガールズバンドクライ』 2nd Anniversary LIVE"), releaseNameKey("『ガールズバンドクライ』2nd Anniversary LIVE"));
  assert.equal(releaseNameKey("『ガールズバンドクライ』 2nd Anniversary LIVE Blu-ray & DVD"), releaseNameKey("『ガールズバンドクライ』2nd Anniversary LIVE"), "结尾的载体字样不算名字");
  assert.equal(
    releaseNameKey("トゲナシトゲアリ「LIVE in 日本武道館 “奏檄の叫”」"),
    releaseNameKey('トゲナシトゲアリ LIVE in 日本武道館 "奏檄の叫" Blu-ray & DVD'),
    "演出名外面再套一层引号也认得出",
  );
});

test("版本、店铺特典与序列号跟着公告落下来，序列号指到同名的那场演出", async () => {
  const liveTitle = `MyGO!!!!! 9th LIVE ${T}`;
  const [live] = await sql<{ id: string; public_id: string }[]>`
    INSERT INTO live_events (public_id, title, subject_entity, timezone, starts_on)
    VALUES (${`l${T}`}, ${liveTitle}, 'mygo', 'Asia/Tokyo', '2026-12-20') RETURNING id, public_id`;
  const title = `MyGO!!!!! 9th LIVE Blu-ray ${T}`;
  const article = await material({
    title, tags: ["新作发售", "Blu-ray/DVD"], subjects: ["mygo"],
    deadlines: [{ kind: "release_start", at: "2026-12-01", note: "12月1日発売" }],
    release: {
      title, kind: "bluray", releaseOn: "2026-12-01", announcedOn: "2026-09-20", quote: "12月1日発売",
      editions: [{ name: "初回限定盤", kind: "limited", includesBluray: true, includesSerial: true, priceYen: 8800, sku: "BRMM-1", quote: "初回限定盤 8,800円" }],
      bonuses: [{ retailer: "ゲーマーズ", bonus: "アクリルスタンド", firstPress: true, editionName: "初回限定盤", url: "https://example.org/bonus", quote: "ゲーマーズ特典" }],
      serials: [{ kind: "lottery", liveTitle, url: "https://example.org/apply", quote: "シリアルで最速先行" }],
    },
  });
  const { factId, storyId } = await publish([article], title);
  await sql`UPDATE facts SET live_event_id = ${live!.id} WHERE id = ${factId}`;

  const row = (await rowsOf(title))[0]!;
  const loaded = await loadRelease(row.public_id, NOW);
  assert.ok(loaded, "发售页读得出来");
  assert.equal(loaded.kind, "bluray");
  assert.equal(loaded.subject, "mygo");
  assert.equal(loaded.announcedOn, "2026-09-20", "公告公布日听模型的");
  assert.equal(loaded.daysLeft, 61, "离发售还有几天按这张碟自己的日历算");
  assert.deepEqual(loaded.editions.map((e) => [e.name, e.kind, e.includesSerial, e.priceYen, e.sku]),
    [["初回限定盤", "limited", true, 8800, "BRMM-1"]]);
  assert.deepEqual(loaded.bonuses.map((b) => [b.retailer, b.bonus, b.firstPress, b.editionName]), [["ゲーマーズ", "アクリルスタンド", true, "初回限定盤"]]);
  assert.equal(loaded.serials[0]!.kind, "lottery");
  assert.equal(loaded.serials[0]!.live?.publicId, live!.public_id, "序列号指到同名的那场演出");
  assert.equal(loaded.story?.publicId.length, 36);

  // 主体页与 story 页读的是同一行。
  assert.ok((await releasesForSubject("mygo", NOW)).some((r) => r.publicId === row.public_id));
  assert.equal((await releaseOfStory(storyId, NOW))?.publicId, row.public_id);
  const summary = (await releasesForSubject("mygo", NOW)).find((r) => r.publicId === row.public_id)!;
  assert.deepEqual([summary.editionCount, summary.hasSerial], [1, true], "列表页只带版本数与有没有序列号");
});

test("同一张碟的第二条公告只补空：价格不丢、形态不降级、先到先得会累积", async () => {
  const title = `同一张碟 ${T}`;
  const first = await material({
    title, tags: ["新作发售", "Album"], subjects: ["roselia"],
    deadlines: [{ kind: "release_start", at: "2026-11-03" }],
    release: {
      title, kind: "album", releaseOn: "2026-11-03", announcedOn: "2026-09-25",
      editions: [{ name: "通常盤", kind: "regular", includesSerial: true, priceYen: 3300, sku: "BRMM-2", quote: "通常盤 3,300円" }],
      bonuses: [{ retailer: "タワーレコード", bonus: "ポストカード", firstPress: true, quote: "先着特典" }],
    },
  });
  await publish([first], title);
  const row = (await rowsOf(title))[0]!;

  // 第二条公告说同一张碟、同一天，但没写价格、形态只说得出「其他」、特典这次没说先到先得。
  const second = await material({
    title, tags: ["新作发售"], subjects: ["roselia"],
    deadlines: [{ kind: "release_start", at: "2026-11-03" }],
    release: {
      title, kind: "other", releaseOn: "2026-11-03", announcedOn: "2026-10-02",
      editions: [{ name: "通常盤", kind: "other" }],
      bonuses: [{ retailer: "タワーレコード", bonus: "ポストカード", firstPress: false }],
    },
  });
  await publish([second], title);

  const rows = await rowsOf(title);
  assert.equal(rows.length, 1, "同一天、同一个碟名还是同一行");
  assert.equal(rows[0]!.id, row.id);
  assert.equal(rows[0]!.announced_on, "2026-09-25", "公布日留最早的那次");
  const [edition] = await sql<{ kind: string; includes_serial: boolean; price_yen: number | null; sku: string | null }[]>`
    SELECT kind, includes_serial, price_yen, sku FROM release_editions WHERE release_id = ${row.id}`;
  assert.deepEqual({ ...edition }, { kind: "regular", includes_serial: true, price_yen: 3300, sku: "BRMM-2" }, "补空不覆盖：价格、形态与序列号都留着");
  const [bonus] = await sql<{ first_press: boolean }[]>`SELECT first_press FROM release_bonuses WHERE release_id = ${row.id}`;
  assert.equal(bonus!.first_press, true, "先到先得是「有过就算」，不会被后一条公告收回");
});

test("第一条公告下架，发售页跟着 404，主体页与 story 页也不再列", async () => {
  const title = `下架的碟 ${T}`;
  const article = await material({
    title, tags: ["新作发售", "Single"], subjects: ["ave-mujica"],
    deadlines: [{ kind: "release_start", at: "2026-10-20" }],
  });
  const { storyId } = await publish([article], title);
  const row = (await rowsOf(title))[0]!;
  assert.ok(await loadRelease(row.public_id, NOW));

  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${article}`;
  assert.equal(await loadRelease(row.public_id, NOW), null, "公告都下架了，发售页跟着 404");
  assert.equal(await releaseOfStory(storyId, NOW), null);
  assert.ok(!(await releasesForSubject("ave-mujica", NOW)).some((r) => r.publicId === row.public_id), "主体页也不再列它");
});

test("公开接口答一张碟，未知的 id 是 404", async () => {
  const app = await buildApp();
  try {
    const title = `接口的碟 ${T}`;
    const article = await material({
      title, tags: ["新作发售", "EP"], subjects: ["kuzumimizuku"],
      deadlines: [{ kind: "release_start", at: "2026-10-25" }],
    });
    await publish([article], title);
    const row = (await rowsOf(title))[0]!;

    const res = await app.inject({ method: "GET", url: `/api/site/releases/${row.public_id}` });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().subject, "kuzumimizuku");
    assert.equal(res.json().kind, "ep");
    assert.equal(res.json().releaseOn, "2026-10-25");
    assert.match(String(res.headers["cache-control"]), /^public/);

    const missing = await app.inject({ method: "GET", url: `/api/site/releases/${T}-nothing` });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().detail, "release not public");
  } finally {
    await app.close();
  }
});
