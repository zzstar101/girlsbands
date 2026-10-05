// Listing parsers on the page shapes Jina returns for real sites: card links that wrap an image, a title
// attribute, http links under https prefixes, and navigation that is no post. Also what made articles
// flip between versions: in-page anchors of an HTML listing and
// promotions a feed rotates inside its posts. And a band label's homepage, whose posts have no links in
// its HTML: read without its adapter, it gave the menu (チケット, 日本語) as articles.
import "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@girlsbands/backend/config";
import { sanitizeBody, trimTrailingChrome } from "@girlsbands/backend/content/sanitize";
import { fetchDetail, fetchWebList, fromHtml, fromMarkdown } from "@girlsbands/backend/sources/web-list";
import { fetchRss } from "@girlsbands/backend/sources/rss";
import { fetchJsonList, renderFields } from "@girlsbands/backend/sources/json-list";
import { noiseFiltered, rewriteUrl } from "@girlsbands/backend/sources/collect";

const source = (config: Record<string, unknown>) => ({ id: "test-list", config }) as never;

// A band label's homepage as served, cut down: rows that navigate by script, the runtime's chunk
// map, the route table naming the homepage's chunks, and the chunk with the Blog list among the menu,
// the release cards, the other sections and a Goods list built at run time.
const pages: Record<string, (cdn: string) => string> = {
  "/": (cdn) =>
    `<html><head><script defer src="${cdn}static/js/lib-react.a6be410a.js"></script><script defer src="${cdn}static/js/4752.2908c99e.js"></script>` +
    `<script defer src="${cdn}static/js/index.c5195ace.js"></script></head><body><a href="/ja/index">日本語</a><a href="/goods">グッズ</a>` +
    `<a href="/go/ticket">チケット</a><a href="/#goods">Goods</a><a href="/#news">News</a><a href="/#joinUs">Join Us</a><div id="blog-list">` +
    `<div class="blogRow-kPt4Cj" data-font-interactive="true"><h3 data-font-text="true">8th ONE-MAN LIVE『凛音の理』開催決定</h3></div></div></body></html>`,
  // A redesign that moved the list elsewhere.
  "/redesigned/": (cdn) => `<html><head><script defer src="${cdn}static/js/lib-react.a6be410a.js"></script></head><body><a href="/go/ticket">チケット</a></body></html>`,
  // A band news feed: a teaser that ends in "Read the full story", next to a post whose feed carries it whole.
  "/verge.xml": () =>
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">` +
    `<entry><title>8th ONE-MAN LIVE『凛音の理』開催決定</title><link rel="alternate" href="https://example.org/8th-one-man-live"/><published>2026-09-28T17:31:35-04:00</published>` +
    `<summary type="html">トゲナシトゲアリ が 8th ONE-MAN LIVE『凛音の理』の開催を発表した。</summary>` +
    `<content type="html"><![CDATA[<p>${"トゲナシトゲアリ が 8th ONE-MAN LIVE『凛音の理』の開催を発表した。".repeat(8)}</p><p>Read the full story at 音楽ナタリー.</p>]]></content></entry>` +
    `<entry><title>A whole post</title><link rel="alternate" href="https://example.org/whole"/><published>2026-09-28T10:00:00Z</published>` +
    `<content type="html"><![CDATA[<p>${"The feed carries this post whole, paragraph after paragraph. ".repeat(30)}</p>]]></content></entry></feed>`,
  // A list API that gives calendar days as yyyymmdd.
  "/days.json": () => JSON.stringify({ data: { list: [{ seq: 695, ttl: "8th ONE-MAN LIVE", day: "20260922" }, { seq: 1, ttl: "Bad day", day: "20260230" }] } }),
  // A Chinese doujin-event listing: one tag per request, dates as epoch milliseconds.
  "/cpp.json?tag=a": () => JSON.stringify({ result: { list: [{ id: 1, name: "上海BanG Dream ONLY7", tag: "bangdream", enterTime: 1794672000000, cityName: "上海" }] } }),
  "/cpp.json?tag=b": () => JSON.stringify({ result: { list: [{ id: 2, name: "北京音乐番Only 2.0", tag: "BanGDream", enterTime: 1792773000000, cityName: "北京" }] } }),
  "/cpp.json?tag=quiet": () => JSON.stringify({ result: { list: [] } }),
  "/cpp.json?tag=quiet2": () => JSON.stringify({ result: { list: [] } }),
  // A label blog: no date in the feed or in meta tags, only in JSON-LD.
  "/ld-post": () =>
    `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Blog"},` +
    `{"@type":"BlogPosting","headline":"新シングル「名前のない歌」リリース決定","datePublished":"2026-09-24"}]}</script></head><body><p>Post</p></body></html>`,
  "/cdn/static/js/lib-react.a6be410a.js": () => '"use strict";(self.webpackChunk=self.webpackChunk||[]).push([["lib-react"],{}]);',
  "/cdn/static/js/index.c5195ace.js": (cdn) =>
    '(()=>{var e={},a={};function t(d){return a[d]}t.u=e=>"static/js/async/"+e+"."+({6159:"4efb0769",7298:"a1b2c3d4",8557:"2d420be2"})[e]+".js",' +
    `t.miniCssF=e=>""+e+".css",t.p="${cdn}",t.rv=()=>"1.3.12"})();`,
  "/cdn/static/js/4752.2908c99e.js": () =>
    '(self.webpackChunk=self.webpackChunk||[]).push([["4752"],{1:function(e,a,t){let r=[{path:"/",element:o.createElement(S),filePath:"en/index.mdx",' +
    'preload:async()=>(await S.preload(),Promise.all([t.e("7298"),t.e("6159"),t.e("8557")]).then(t.bind(t,57573))),lang:"en",version:""},' +
    '{path:"/blog/8th-one-man-live",element:o.createElement(k),filePath:"en/blog/8th-one-man-live.mdx",' +
    'preload:async()=>(await k.preload(),Promise.all([t.e("7298"),t.e("3583"),t.e("8421")]).then(t.bind(t,1105))),lang:"en",version:""}]}}]);',
  "/cdn/static/js/async/7298.a1b2c3d4.js": () => '(self.webpackChunk=self.webpackChunk||[]).push([["7298"],{2:function(){}}]);',
  "/cdn/static/js/async/6159.4efb0769.js": () => '(self.webpackChunk=self.webpackChunk||[]).push([["6159"],{3:function(e,i,t){t.d(i,{H:()=>n})}}]);',
  "/cdn/static/js/async/8557.2d420be2.js": () =>
    '(self.webpackChunk=self.webpackChunk||[]).push([["8557"],{57573:function(e,i,t){function h(e){return(0,n.jsxs)(a.Me,{children:[' +
    '(0,n.jsx)(m.H,{models:[{name:"トゲナシトゲアリ 8th ONE-MAN LIVE『凛音の理』",desc:"2026年3月、ぴあアリーナMM で開催。",imageKey:"8th-one-man-live",link:"/live/8th-one-man-live"}]}),' +
    '(0,n.jsx)(d.z,{sectionTitle:"Official",experiences:[{title:"グッズ",link:"/goods/",desc:"公演グッズの通販"}]}),' +
    '(0,n.jsx)(r.K,{sectionId:"goods",sectionTitle:"Goods",blogs:l.G.slice().reverse().map(e=>({title:e.title,link:`/goods/${e.slug}`,desc:(0,l.V)(e.date,!1)}))}),' +
    '(0,n.jsx)(r.K,{sectionTitle:"Blog",initialVisibleCount:8,blogs:[' +
    '{title:"8th ONE-MAN LIVE『凛音の理』開催決定",link:"/blog/8th-one-man-live",desc:"2026年3月、ぴあアリーナMM で開催。"},' +
    '{title:"新シングル「名前のない歌」リリース決定",link:"/release/nameless-song",desc:"初回限定盤には LIVE 映像を収録。"},' +
    '{title:"全国ツアー 2026 開催決定",link:"/blog/2026-tour",desc:"全国 8 都市を巡るツアー。"},' +
    '{title:"Blu-ray『Live at 日本武道館』発売",link:"/video/budokan-bluray/index.html",desc:"2025 年の武道館公演を収録。"},' +
    '{title:"FC 先行受付開始のお知らせ",link:"/blog/fc-presale",desc:"FC 先行受付開始のお知らせ"}]}),' +
    '(0,n.jsx)(c.Q,{sectionTitle:"Join Us",positions:[{title:"Staff - Live Production",link:"joinUs/live-production"}],contactEmail:"info@example.org"})]})}}}]);',
};
const server = http.createServer((req, res) => {
  const path = req.url ?? "";
  const found = Object.hasOwn(pages, path);
  res.writeHead(found ? 200 : 404, { "content-type": path.endsWith(".js") ? "application/javascript" : "text/html; charset=utf-8" });
  res.end(found ? pages[path]!(`${site}/cdn/`) : "");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const site = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("Jina card links become posts with their own titles", () => {
  const md = [
    "[Skip to main content](http://example.org/blog/#main)",
    "[![Image 1: hero](https://cdn.example.org/a.jpg) ##### 8th ONE-MAN LIVE『凛音の理』開催決定 新闻资讯 | 2026-09-20](https://example.org/blog/220.html \"8th ONE-MAN LIVE『凛音の理』開催決定\")",
    "[![Image 2](https://cdn.example.org/b.png) ##### 結束バンド 9th Single 发售 测评 尾巴视频](http://example.org/blog/784.html)",
    "[![Image 3](https://cdn.example.org/c.png)](https://example.org/blog/carousel.html)",
    "# [Introducing v6](http://example.org/blog/introducing-v6)",
    "[2026](http://example.org/blog/2026) [Live & Release](http://example.org/blog/label/live) [Next page](http://example.org/blog/page/2)",
  ].join("\n\n");
  const out = fromMarkdown(md, "https://example.org", source({ url: "https://r.jina.ai/http://example.org/blog/", allowUrlPrefixes: ["https://example.org/blog/"] }));
  assert.deepEqual(out, [
    { url: "https://example.org/blog/220.html", title: "8th ONE-MAN LIVE『凛音の理』開催決定" },
    { url: "https://example.org/blog/784.html", title: "結束バンド 9th Single 发售 测评 尾巴视频" },
    { url: "https://example.org/blog/introducing-v6", title: "Introducing v6" },
  ]);
});

test("anchors into the listing page itself are navigation, not posts", () => {
  // A label site links its own sections (#goods, #news, #join): all one address once the fragment goes.
  const html = [
    '<a href="/#goods">Goods</a>', '<a href="/#news">News</a>', '<a href="https://example.org/#join">Join Us</a>',
    '<a href="/">Home</a>', '<a href="/blog/8th-one-man-live">8th ONE-MAN LIVE 開催決定</a>',
  ].join("");
  const out = fromHtml(html, "https://example.org/", source({ url: "https://example.org/" }));
  assert.deepEqual(out.map((c) => c.url), ["https://example.org/blog/8th-one-man-live"]);
});

test("posts addressed by a query on the listing's path are posts, its pages and filters are not", () => {
  // WordPress plain permalinks: every post is /?p=N on the listing's own path.
  const links: [string, string][] = [
    ["/?p=123", "First live announcement"], ["/?p=456&lang=en", "Second live announcement"],
    ["/?utm_source=nav", "Home with tracking"], ["/?paged=2", "Older posts page"], ["/?cat=3", "Live category"], ["/#about", "About this site"],
  ];
  const html = links.map(([href, text]) => `<a href="${href}">${text}</a>`).join("");
  const md = links.map(([href, text]) => `[${text}](https://example.org${href})`).join("\n\n");
  const posts = ["https://example.org/?p=123", "https://example.org/?p=456&lang=en"];
  assert.deepEqual(fromHtml(html, "https://example.org/", source({ url: "https://example.org/" })).map((c) => c.url), posts);
  assert.deepEqual(fromMarkdown(md, "https://example.org/", source({ url: "https://r.jina.ai/https://example.org/" })).map((c) => c.url), posts);
  // The listing's own query in another order, with tracking and a page number, is still the listing.
  const filtered = source({ url: "https://example.org/news?lang=en&kind=live" });
  const out = fromHtml('<a href="/news?kind=live&lang=en&utm_medium=x&page=2">Next page of news</a><a href="/news?kind=live&lang=en&id=7">A news post</a>', "https://example.org/", filtered);
  assert.deepEqual(out.map((c) => c.url), ["https://example.org/news?kind=live&lang=en&id=7"]);
  // Hosts still compare as written: www is another host.
  assert.equal(fromHtml('<a href="https://www.example.org/">Home on www</a>', "https://example.org/", source({ url: "https://example.org/" })).length, 1);
});

test("promotions a feed rotates inside its posts are left out of the body", () => {
  // A label's feed puts a different podcast or goods promotion into each post on every load.
  const promo = (label: string, name: string) =>
    `<div class="border-bottom border-top mt-5 mb-5 msr-promo text-center alignwide" data-bi-aN="promo">` +
    `<p class="msr-promo__label text-uppercase"><span>${label}</span></p><div class="row"><div class="msr-promo__content">` +
    `<h2 class="h4">${name}</h2><p>Join the band's staff.</p><a href="https://example.org/podcast">Listen now</a></div></div></div>`;
  const post = (p: string) => `<p>『凛音の理』のチケットは本日から FC 先行受付。</p>${p}<p>一般販売は 2 月から。</p>`;
  const a = sanitizeBody(post(promo("PODCAST SERIES", "Ideas")), "https://example.org/post");
  const b = sanitizeBody(post(promo("", "Foundry Labs")), "https://example.org/post");
  assert.equal(a, b, "the same post whichever promotion it carried");
  assert.ok(!/PODCAST SERIES|Ideas|Foundry Labs|Listen now/.test(a));
  assert.ok(a.includes("一般販売"), "the post's own text stays");
});

test("a homepage whose post rows navigate by script lists its posts, not its menu", async () => {
  const out = await fetchWebList(source({ url: `${site}/`, adapter: "mimo_home" }));
  assert.deepEqual(out, [
    { url: `${site}/blog/8th-one-man-live`, title: "8th ONE-MAN LIVE『凛音の理』開催決定", excerpt: "2026年3月、ぴあアリーナMM で開催。" },
    { url: `${site}/release/nameless-song`, title: "新シングル「名前のない歌」リリース決定", excerpt: "初回限定盤には LIVE 映像を収録。" },
    { url: `${site}/blog/2026-tour`, title: "全国ツアー 2026 開催決定", excerpt: "全国 8 都市を巡るツアー。" },
    { url: `${site}/video/budokan-bluray/index.html`, title: "Blu-ray『Live at 日本武道館』発売", excerpt: "2025 年の武道館公演を収録。" },
    { url: `${site}/blog/fc-presale`, title: "FC 先行受付開始のお知らせ", excerpt: null },
  ]);
});

test("a homepage whose list moved fails the fetch instead of listing its menu", async () => {
  await assert.rejects(fetchWebList(source({ url: `${site}/redesigned/`, adapter: "mimo_home" })), /mimo_home/);
});

test("a listing that links other articles in its teasers takes only the links that begin a line", () => {
  // 音楽ナタリー through Jina: each headline stands on its own line; its teaser links older stories inline.
  const md = [
    "### [8th ONE-MAN LIVE『凛音の理』開催決定](https://example.org/2026/09/27/rinne)",
    "[![Image 3: Scoop](https://example.org/a.jpg)](https://example.org/2026/09/27/interview)",
    "[Scoop: トゲナシトゲアリ が ぴあアリーナMM 公演を発表](https://example.org/2026/09/27/interview)",
    "[Ed Sheeran's U.S. tour went off the rails in 3 weeks](https://example.org/2026/09/25/sheeran)[![Image 12: Ed Sheeran](https://example.org/b.jpg)](https://example.org/2026/09/25/sheeran)",
    "Ed Sheeran's two Gillette Stadium shows were canceled Friday, capping a [chaotic three weeks](https://example.org/2026/09/15/sheeran-loop).",
    "**Why it matters:** Live tickets are scarce. [Ticket resale](https://example.org/2026/09/24/resale) can slow it down.",
    "[Go deeper (3 min. read)](https://example.org/2026/09/25/sheeran)",
  ].join("\n\n");
  const config = { url: "https://r.jina.ai/https://example.org/music", allowUrlPrefixes: ["https://example.org/2"], linksStartLine: true };
  assert.deepEqual(fromMarkdown(md, "https://example.org", source(config)).map((c) => c.title), [
    "8th ONE-MAN LIVE『凛音の理』開催決定",
    "Scoop: トゲナシトゲアリ が ぴあアリーナMM 公演を発表",
    "Ed Sheeran's U.S. tour went off the rails in 3 weeks",
  ]);
  assert.equal(fromMarkdown(md, "https://example.org", source({ ...config, linksStartLine: undefined })).length, 5, "without the option prose links count");
});

test("feed text that only teases the article is a summary: the page is fetched before judging", async () => {
  const read = await fetchRss({ id: "test-feed", config: { feedUrl: `${site}/verge.xml` }, participation_mode: "editorial", cursor: null } as never, { force: true });
  const [teaser, whole] = read.candidates;
  assert.equal(teaser!.bodyStatus, "pending");
  assert.equal(teaser!.bodyText, null);
  assert.equal(teaser!.excerpt, "トゲナシトゲアリ が 8th ONE-MAN LIVE『凛音の理』の開催を発表した。");
  assert.equal(whole!.bodyStatus, "ok");
  assert.ok(whole!.bodyText!.length > 1200);
  // Discussion sources only need what the feed says.
  const signal = await fetchRss({ id: "test-feed", config: { feedUrl: `${site}/verge.xml` }, participation_mode: "hot_signal", cursor: null } as never, { force: true });
  assert.equal(signal.candidates[0]!.bodyStatus, "ok");
});

test("hidden page parts are dropped whole, and a news page's closing blocks are trimmed", () => {
  // Label sites carry <template> blocks of base64 that became 330,000 characters of "body".
  const html = sanitizeBody(
    `<p>8th ONE-MAN LIVE『凛音の理』開催決定。</p><template><div><p>${"QUFB".repeat(500)}</p></div></template>` +
      `<svg><text>chart label</text></svg><p>Energy <math><mi>E</mi><annotation encoding="application/x-tex">E=mc^2</annotation></math> matters.</p>`,
    "https://example.org/post",
  );
  assert.ok(!/QUFB|chart label|mc\^2/.test(html), html);
  assert.ok(html.includes("8th ONE-MAN LIVE") && html.includes("Energy E matters"));
  // A linked chart in a paragraph of its own survives, also when a translation is cleaned again.
  const chart = '<p><a href="https://example.org/chart.png"><img src="https://example.org/chart.png" alt="チケット価格"></a></p>';
  assert.ok(sanitizeBody(sanitizeBody(`<p>Prices doubled.</p>${chart}<p> </p>`)).includes('alt="チケット価格"'));
  assert.equal(sanitizeBody("<p>Text.</p><p> <br></p><p><a href=\"https://example.org/\"></a></p>"), "<p>Text.</p>");
  // 音楽ナタリー ends every article the same way.
  const article = "<p>『凛音の理』のチケットは本日から FC 先行受付。</p><h2>Topics</h2><p>More on the deal.</p><p>Subscribe to our plan to get the API.</p>";
  assert.equal(trimTrailingChrome(`${article}<p>Topics</p><p>Subscribe for the industry's biggest music news</p><h2>Latest in Live</h2>`), article);
  assert.equal(trimTrailingChrome(article), article);
});

test("noise words match whatever their case", () => {
  // 转卖 is noise, but the lower-case exemption live keeps a post about a LIVE product.
  const source = { config: { ingestNoiseFilter: { dropMarkers: ["转卖", "iphone"], keepIfMatches: ["live"] } } } as never;
  const c = (title: string, excerpt: string) => ({ url: "https://example.org/a", title, excerpt }) as never;
  assert.equal(noiseFiltered(c("8th ONE-MAN LIVE：正在筹备新曲", "与转卖渠道合作的 LIVE 企划"), source), false);
  assert.equal(noiseFiltered(c("演唱会门票转卖开售", "高价转卖 4999 元"), source), true);
  assert.equal(noiseFiltered(c("iPhone 18 开售", ""), source), true);
});

test("a mirror that serves the other scheme is still rewritten", () => {
  // meowing.monster 的条目是 http://、配置里写的是 https://：严格前缀匹配会静默不改写，读者看到的
  // 原文链接和文章的 identity key 就停在镜像域名上（kareem.one 恰好相反）。
  const meowing = source({ itemUrlPrefixRewrite: { from: "https://nitter.meowing.monster/", to: "https://x.com/" } });
  const at = (url: string) => rewriteUrl({ url } as never, meowing).url;
  assert.equal(at("http://nitter.meowing.monster/BDP_AveMujica/status/123#m"), "https://x.com/BDP_AveMujica/status/123#m");
  assert.equal(at("https://nitter.meowing.monster/BDP_AveMujica/status/123"), "https://x.com/BDP_AveMujica/status/123");
  assert.equal(at("https://nitter.kareem.one/x/status/123"), "https://nitter.kareem.one/x/status/123", "别的实例不改");
  const kareem = source({ itemUrlPrefixRewrite: { from: "http://nitter.kareem.one/", to: "https://x.com/" } });
  assert.equal(rewriteUrl({ url: "https://nitter.kareem.one/x/status/9" } as never, kareem).url, "https://x.com/x/status/9");
  // Jina 的 from 里本来就含一段 http://（它在路径里，不是 scheme），不能被切掉。
  const jina = source({ itemUrlPrefixRewrite: { from: "https://r.jina.ai/http://example.org/", to: "https://example.org/" } });
  assert.equal(rewriteUrl({ url: "https://r.jina.ai/http://example.org/blog/220.html" } as never, jina).url, "https://example.org/blog/220.html");
});

test("dates in yyyymmdd and in JSON-LD are read", async () => {
  const days = await fetchJsonList({ id: "test-json", config: { url: `${site}/days.json`, itemsPath: "data.list", titlePaths: ["ttl"], urlTemplate: "https://example.org/blog/view?seq={seq}", publishedAtPath: "day", publishedAtUnit: "yyyymmdd" } } as never);
  assert.deepEqual(days.map((c) => c.publishedAt?.toISOString() ?? null), ["2026-09-22T00:00:00.000Z", null], "February 30 is no date");
  const got = await fetchDetail(`${site}/ld-post`, { id: "test-feed", config: { detail: { maxFetches: 20 } } } as never, { date: true, title: false, summary: false, body: false });
  assert.equal(got.publishedAt?.toISOString(), "2026-09-24T00:00:00.000Z");
});

test("a listing's own fields become the item text, on the listing's own calendar", () => {
  const item = { id: 7421, name: "珠海音乐企划ONLY", tag: "音乐企划|bangdream", cityName: "珠海", areaName: "香洲", enterAddress: "乐坊Livehouse", enterTime: 1794672000000, wannaGoCount: 0 };
  const template = "活动时间：{date:enterTime}｜城市：{cityName}｜区县：{areaName}｜会场：{enterAddress}｜标签：{tag}｜想去：{wannaGoCount} 人";
  assert.equal(renderFields(template, item),
    "活动时间：2026-11-15｜城市：珠海｜区县：香洲｜会场：乐坊Livehouse｜标签：音乐企划|bangdream｜想去：0 人");
  // A field this listing does not carry takes its own "｜字段：" with it rather than hanging on.
  const { areaName: _omitted, ...withoutArea } = item;
  assert.equal(renderFields(template, withoutArea),
    "活动时间：2026-11-15｜城市：珠海｜会场：乐坊Livehouse｜标签：音乐企划|bangdream｜想去：0 人");
  assert.equal(renderFields(template, {}), null, "nothing resolvable leaves the source to its fallback");
  // 00:30 on the 24th in +08:00 is still the 23rd in UTC: the listing's offset decides the day.
  assert.equal(renderFields("活动时间：{date:enterTime}", { enterTime: 1792773000000 }), "活动时间：2026-10-24");
  // A zone-less wall clock is the listing's own local time, not the host's.
  assert.equal(renderFields("开票：{date:sale_start_time}", { sale_start_time: "2026-09-19 18:00:00" }), "开票：2026-09-19");
  // Ticket APIs quote prices in fen; the reader pays yuan. 0 is a real price (a free event).
  assert.equal(renderFields("票价：{money:price_low} 起", { price_low: 6800 }), "票价：¥68 起");
  assert.equal(renderFields("票价：{money:price_low} 起", { price_low: 6850 }), "票价：¥68.5 起");
  assert.equal(renderFields("票价：{money:price_low} 起", { price_low: "0" }), "票价：¥0 起");
  // A price the listing does not state as a number drops its segment instead of printing a wrong one.
  assert.equal(renderFields("票价：{money:price_low} 起｜城市：{cityName}", { price_low: "待定", cityName: "上海" }), "城市：上海");
  assert.equal(renderFields("票价：{money:price_low} 起", { price_low: "" }), null);
});

test("a JSON listing without a summary writes one from its own fields", async () => {
  const got = await fetchJsonList({ id: "test-cpp", config: {
    url: `${site}/cpp.json?tag=a`,
    itemsPath: "result.list",
    titlePaths: ["name"],
    summaryTemplate: "活动时间：{date:enterTime}｜城市：{cityName}｜标签：{tag}",
    summaryIsBody: true,
    urlTemplate: "https://www.allcpp.cn/allcpp/event/event.do?event={id}",
  } } as never);
  assert.deepEqual(got.map((c) => ({ url: c.url, title: c.title, excerpt: c.excerpt, bodyStatus: c.bodyStatus })), [{
    url: "https://www.allcpp.cn/allcpp/event/event.do?event=1",
    title: "上海BanG Dream ONLY7",
    excerpt: "活动时间：2026-11-15｜城市：上海｜标签：bangdream",
    bodyStatus: "ok",
  }]);
});

test("a card's own text is the material when the page it links to has no date", () => {
  const html = `<div class="list-box"><a class="show-item item" href="/event/311467">`
    + `<div class="title">所谓正解？【哭泣少女乐队Only Live】</div><div class="price">价格：<span>¥68起</span></div>`
    + `<div class="time">时间：2026/10/11 15:30</div><div class="addr">[广州]MAOLivehouse广州（永庆坊店CLUB厅）</div></a></div>`;
  const out = fromHtml(html, "https://www.showstart.com/", source({
    url: "https://www.showstart.com/event/list?keyword=x",
    itemSelector: "div.list-box a.show-item",
    titleSelector: "div.title",
    summarySelector: "div.time, div.addr, div.price",
    summaryIsBody: true,
  }));
  // A selector list reads in document order, which is the order the card writes its fields in.
  const card = "价格：¥68起｜时间：2026/10/11 15:30｜[广州]MAOLivehouse广州（永庆坊店CLUB厅）";
  assert.deepEqual(out, [{
    url: "https://www.showstart.com/event/311467",
    title: "所谓正解？【哭泣少女乐队Only Live】",
    publishedAt: null,
    excerpt: card,
    bodyText: card,
    bodyStatus: "ok",
  }]);
});
