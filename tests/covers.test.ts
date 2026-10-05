// 详情页的主视觉：挑图规则、四个出口各自带的 cover，以及下架之后图跟着消失。
// 写的是它们会出错的方式：Hatena 的 favicon 被当成第一张图、64px 的缩略图被当成插画、
// 正文里已经排过图的条目又在上头重复放一张、公告下架了图上还挂着。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { upsertMaterial, type MediaItem } from "@girlsbands/backend/content/materials";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { publishArticle } from "@girlsbands/backend/publication/publish";
import { firstPicture, pickPicture } from "@girlsbands/backend/lib/image-url";
import { loadItemDetail } from "@girlsbands/backend/publication/detail";
import { loadStoryDetail } from "@girlsbands/backend/publication/stories";
import { loadLive, livesForSubject } from "@girlsbands/backend/publication/lives";
import { loadRelease, releasesForSubject } from "@girlsbands/backend/publication/releases";
import { coversOfItems } from "@girlsbands/backend/publication/covers";
import { loadPool } from "@girlsbands/backend/publication/pool";

const T = `cov-${tag()}`;
// JST 2026-10-01 12:00。
const NOW = new Date("2026-10-01T03:00:00Z");
const PUBLISHED = new Date("2026-09-30T00:00:00Z");
const SOURCE = `test-covers-${T}`;
const KEY = `https://bang-dream.com/${T}-key.png`;
const FAVICON = `https://cdn-ak2.favicon.st-hatena.com/${T}.ico`;
const PIXEL = "https://ids4.ad.gt/api/v1/ip_match?id=abc";
const THUMB = `https://example.org/${T}-thumb.png`;

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, config, next_fetch_at)
            VALUES (${SOURCE}, 'Official', 'rss', 'T1', 'editorial', ${sql.json({ timezone: "Asia/Tokyo" } as never)}, '2100-01-01')`;
});
after(async () => {
  await stopBoss();
  await closeDb();
});

let n = 0;

async function material(o: { title: string; media: MediaItem[]; tags?: string[]; category?: string }): Promise<string> {
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
    media: o.media,
  });
  await sql`UPDATE articles SET discovered_at = ${PUBLISHED}, timeline_at = ${PUBLISHED}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags, output)
    VALUES (${articleId}, 1, 'model', 'pass', ${o.category ?? "release"}, ${o.title}, '新的消息', 90, false, ${["mygo"]}, ${o.tags ?? ["新作发售"]},
            ${sql.json({ scope: "single", fact: { deadlines: [] }, release: null } as never)})`;
  return articleId;
}

async function publish(articleId: string, title: string): Promise<{ factId: number; storyId: number }> {
  const [story] = await sql`INSERT INTO stories (public_id, title) VALUES (${randomUUID()}, ${title}) RETURNING id`;
  const [fact] = await sql`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${++n}`}, ${story!.id}, ${title}) RETURNING id`;
  await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${articleId}, 'report')`;
  await publishArticle(articleId, { now: NOW, releasedAt: PUBLISHED });
  return { factId: Number(fact!.id), storyId: Number(story!.id) };
}

test("挑图：跳过 favicon、追踪像素与窄图，留第一张真插画，并把 HTML 实体还原", () => {
  assert.equal(pickPicture(null), null);
  assert.equal(pickPicture([]), null);
  assert.equal(pickPicture([{ kind: "video", url: KEY }]), null, "视频不是封面");

  // Hatena 的 feed 把 favicon 排在图前面 —— 一张 64px 的图标不是插画。
  assert.equal(pickPicture([{ kind: "image", url: FAVICON }, { kind: "image", url: KEY, width: 1024, height: 576 }])?.url, KEY);
  // 追踪像素与已知太窄的缩略图同样跳过。
  assert.equal(pickPicture([{ kind: "image", url: PIXEL }, { kind: "image", url: KEY }])?.url, KEY);
  assert.equal(pickPicture([{ kind: "image", url: THUMB, width: 140, height: 140 }, { kind: "image", url: KEY }])?.url, KEY);
  assert.equal(pickPicture([{ kind: "image", url: THUMB, width: 140 }]), null, "只有一张窄图时宁可不放");

  // 没写宽度的一律放行：多数 feed 不写，热榜封面也是这么读的。
  assert.deepEqual(pickPicture([{ kind: "image", url: KEY }]), { url: KEY, width: null, height: null });
  // 属性里留下的 HTML 实体不能带进代理的查询串。
  const amp = pickPicture([{ kind: "image", url: "https://preview.redd.it/x.jpeg?width=640&amp;crop=smart&amp;s=ab" }]);
  assert.equal(amp?.url, "https://preview.redd.it/x.jpeg?width=640&crop=smart&s=ab");
  assert.equal(firstPicture([[], [{ kind: "image", url: FAVICON }], [{ kind: "image", url: KEY, width: 800 }]])?.url, KEY);
});

test("四个出口都带上同一条公告的主视觉，下架后跟着消失", async () => {
  const title = `キービジュアル ${T}`;
  const article = await material({
    title,
    tags: ["新作发售"],
    media: [
      { kind: "image", url: FAVICON },
      { kind: "image", url: KEY, width: 1024, height: 576 },
    ],
  });
  const { factId, storyId } = await publish(article, title);
  const [live] = await sql<{ id: string; public_id: string }[]>`
    INSERT INTO live_events (public_id, title, subject_entity, timezone, starts_on)
    VALUES (${`l${T}`}, ${title}, 'mygo', 'Asia/Tokyo', '2026-12-20') RETURNING id, public_id`;
  await sql`UPDATE facts SET live_event_id = ${live!.id} WHERE id = ${factId}`;
  const [release] = await sql<{ public_id: string }[]>`SELECT public_id FROM releases WHERE first_article_id = ${article}`;

  const detail = await loadItemDetail(article, "zh", NOW);
  assert.equal(detail.kind, "found");
  const item = detail.kind === "found" ? detail.item : null;
  assert.ok(item?.cover, "条目页带上公告自己的图");
  assert.match(item.cover.url, /^\/api\/img-proxy\?/, "图走站内代理，不是直连原站");
  assert.match(item.cover.url, /mode=image-1200/);
  assert.equal(item.cover.width, 1024);
  assert.equal(item.cover.srcSet?.split(", ").length, 3, "hero 的三个尺寸都在 srcSet 里");

  const story = await loadStoryDetail(storyId, NOW);
  assert.equal(story?.cover?.url, item.cover.url, "story 页取的是它自己那篇报道的图");
  const liveView = await loadLive(live!.public_id, NOW);
  assert.equal(liveView?.cover?.url, item.cover.url);
  assert.ok(release, "这条公告建出了一行碟");
  const releaseView = await loadRelease(release!.public_id, NOW);
  assert.equal(releaseView?.cover?.url, item.cover.url);

  // 公告下架：四个出口一起收回去（story 与 live 的封面读的是同一套可见性条件）。
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${article}`;
  assert.equal((await loadItemDetail(article, "zh", NOW)).kind, "not_found");
  assert.equal((await loadStoryDetail(storyId, NOW))?.cover ?? null, null);
  assert.equal((await loadLive(live!.public_id, NOW))?.cover ?? null, null);
  assert.equal(await loadRelease(release!.public_id, NOW), null);
});

test("没有图的公告就保持纯文字：cover 是 null，不是空壳", async () => {
  const title = `図のない告知 ${T}`;
  const article = await material({ title, media: [] });
  const { storyId } = await publish(article, title);
  const detail = await loadItemDetail(article, "zh", NOW);
  assert.equal(detail.kind, "found");
  assert.equal(detail.kind === "found" ? detail.item.cover : "missing", null);
  assert.equal((await loadStoryDetail(storyId, NOW))?.cover ?? null, null);
});

// 列表里的小图：跟页面主视觉读同一张画，只是换成 336 那档（card 的两级 srcSet），
// 而且一场演出 / 一张碟各归各的 —— 列表一次查一批，不能把别人的图贴到自己身上。
test("列表出口用 336 档，并按条目各归各的图", async () => {
  const title = `一覧の告知 ${T}`;
  const article = await material({
    title,
    tags: [T],
    media: [
      { kind: "image", url: FAVICON },
      { kind: "image", url: KEY, width: 1024, height: 576 },
    ],
  });
  const { factId } = await publish(article, title);
  const [live] = await sql<{ id: string; public_id: string }[]>`
    INSERT INTO live_events (public_id, title, subject_entity, timezone, starts_on)
    VALUES (${`l2${T}`}, ${title}, 'mygo', 'Asia/Tokyo', '2026-12-21') RETURNING id, public_id`;
  await sql`UPDATE facts SET live_event_id = ${live!.id} WHERE id = ${factId}`;
  const [release] = await sql<{ public_id: string; subject_entity: string }[]>`
    SELECT public_id, subject_entity FROM releases WHERE first_article_id = ${article}`;
  assert.ok(release, "这条公告建出了一行碟");

  const feed = (await loadPool({ tag: T, now: NOW, category: null, channel: "all" })).items.find((i) => i.id === article);
  assert.ok(feed, "条目出现在列表里");
  assert.match(feed.cover?.url ?? "", /mode=image-336/, "列表用 336 那一档");
  assert.equal(feed.cover?.srcSet?.split(", ").length, 2, "card 的两级 srcSet 都在");
  assert.equal(feed.cover?.width, 1024);

  const liveSummary = (await livesForSubject("mygo", NOW)).find((l) => l.publicId === live!.public_id);
  assert.equal(liveSummary?.cover?.url, feed.cover?.url, "主题页的演出行用同一个列表档");
  const releaseSummary = (await releasesForSubject(release!.subject_entity, NOW)).find((r) => r.publicId === release!.public_id);
  assert.equal(releaseSummary?.cover?.url, feed.cover?.url, "主题页的发售行用同一个列表档");

  // 同一张画在两个出口：签名只对自己的查询串有效，所以比的是那串上游地址，外加各自该有的档位。
  const upstream = (u: string) => new URL(u, "https://site.test").searchParams.get("u");
  const detail = await loadItemDetail(article, "zh", NOW);
  const detailCover = detail.kind === "found" ? detail.item.cover : null;
  assert.match(detailCover?.url ?? "", /mode=image-1200/);
  assert.equal(upstream(detailCover!.url), upstream(feed.cover!.url), "页面与列表读的是同一张画");

  // 批量归位：没图的条目不在 Map 里，不会拿邻居的图顶上。
  const plain = await material({ title: `図のない一覧 ${T}`, media: [] });
  await publish(plain, `図のない一覧 ${T}`);
  const covers = await coversOfItems([article, plain], NOW);
  assert.equal(covers.get(article)?.url, feed.cover?.url);
  assert.equal(covers.get(plain) ?? null, null);
});
