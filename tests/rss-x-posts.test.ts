// X posts come from a Nitter mirror: the tweet's HTML is the body however short it is (x.com serves
// no page to fetch afterwards), a retweet's "RT by @handle: " is the mirror's markup, and a link in
// the body that points at the mirror is its x.com page. A news feed still bodies entries by length.
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@girlsbands/backend/config";
import { fetchRss } from "@girlsbands/backend/sources/rss";

// The server stands in for the mirror: item links, body links and the feed itself all live on it.
const mirrorFeed = (root: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>bang_dream_info / Twitter</title><link>${root}/bang_dream_info</link><description>bang_dream_info's tweets, retweeted</description>
<item>
<title>再放送のお知らせ</title>
<dc:creator>@bang_dream_info</dc:creator>
<description><![CDATA[<p>TVアニメ「BanG Dream! Ave Mujica」<br>再放送が決定💫<br><br>＃1「Sub rosa.」<br><br>日本テレビにて放送スタート🌙<br><br><a href="${root}/search?f=tweets&q=%23バンドリ">#バンドリ</a> <a href="${root}/search?f=tweets&q=%23AveMujica">#AveMujica</a> <a href="${root}/bang_dream_info" title="bang_dream_info">@bang_dream_info</a><br><br><a href="https://bang-dream.com/">バンダイナムコアーツ</a></p>
<img src="https://pbs.twimg.com/media/Fake1234.jpg" style="max-width:250px;">]]></description>
<pubDate>Fri, 10 Jan 2025 12:00:00 GMT</pubDate>
<guid isPermaLink="false">1876543210</guid>
<link>${root}/bang_dream_info/status/1876543210#m</link>
</item>
<item>
<title>RT by @AveMujica_PR: 新年あけましておめでとうございます🎍</title>
<dc:creator>@AveMujica_PR</dc:creator>
<description><![CDATA[RT by @AveMujica_PR: 新年あけましておめでとうございます🎍<br><br>今年も応援よろしくお願いします！]]></description>
<pubDate>Wed, 01 Jan 2025 09:00:00 GMT</pubDate>
<guid isPermaLink="false">1875000000</guid>
<link>${root}/AveMujica_PR/status/1875000000#m</link>
</item>
<item>
<title>感想を教えてください</title>
<dc:creator>@bang_dream_info</dc:creator>
<description><![CDATA[<p>続きが気になる方はぜひ<br>リアルタイムでご覧ください<br><br><a href="${root}/AveMujica">@AveMujica</a></p>
<blockquote><a href="${root}/AveMujica/status/1870000000#m">https://x.com/AveMujica/status/1870000000</a><br>本編の感想を教えてください<br><a href="${root}/search?q=AveMujica">#AveMujica感想</a> <a href="${root}/t.co/b6C8jTdCTV">${root}/t.co/b6C8jTdCTV</a><hr>— ${root}/AnichU_ntv/status/2107244693511663930#m</blockquote>]]></description>
<pubDate>Thu, 09 Jan 2025 20:00:00 GMT</pubDate>
<guid isPermaLink="false">1879999999</guid>
<link>${root}/bang_dream_info/status/1879999999#m</link>
</item>
</channel></rss>`;

const longNews = "本日、バンドリ！の新情報が発表された。詳細は公式サイトをご覧ください。".repeat(10);
const newsFeed = () => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>音楽ナタリー</title><link>https://natalie.mu/music/news</link><description>音楽ニュース</description>
<item><title>短いお知らせ</title><description><![CDATA[<p>詳細は後日発表。</p>]]></description><pubDate>Fri, 10 Jan 2025 12:00:00 GMT</pubDate><guid isPermaLink="false">501</guid><link>https://example.com/news/501</link></item>
<item><title>長い記事</title><description><![CDATA[<p>${longNews}</p>]]></description><pubDate>Fri, 10 Jan 2025 12:00:00 GMT</pubDate><guid isPermaLink="false">502</guid><link>https://example.com/news/502</link></item>
</channel></rss>`;

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/rss+xml");
  res.end(req.url === "/bang_dream_info/rss" ? mirrorFeed(root) : newsFeed());
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const host = new URL(root).host;
const previousPrivateFetch = config.allowPrivateNetworkFetch;
config.allowPrivateNetworkFetch = true;
after(async () => {
  config.allowPrivateNetworkFetch = previousPrivateFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const source = (feedUrl: string, xMirror: boolean) =>
  xMirror
    ? { config: { feedUrl, summaryIsBody: true, itemUrlPrefixRewrite: { from: "https://nitter.meowing.monster/", to: "https://x.com/" } }, participation_mode: "editorial" }
    : { config: { feedUrl, summaryIsBody: true }, participation_mode: "editorial" };

async function read(path: string, xMirror = false) {
  return (await fetchRss(source(root + path, xMirror) as never)).candidates;
}

test("a tweet is the body however short it is, line breaks and all", async () => {
  const [tweet] = await read("/bang_dream_info/rss", true);
  assert.ok(tweet!.bodyText!.length < 280); // the length a news summary would fail on
  assert.equal(tweet!.bodyStatus, "ok");
  assert.match(tweet!.bodyHtml!, /<br>/);
  assert.equal(tweet!.excerpt, "TVアニメ「BanG Dream! Ave Mujica」 再放送が決定💫 ＃1「Sub rosa.」 日本テレビにて放送スタート🌙 #バンドリ #AveMujica @bang_dream_info バンダイナムコアーツ");
  assert.deepEqual(tweet!.media, [{ kind: "image", url: "https://pbs.twimg.com/media/Fake1234.jpg" }]);
  assert.equal(tweet!.url, `${root}/bang_dream_info/status/1876543210#m`); // the item link keeps the mirror's anchor
});

test("a retweet's text and title lose the RT by @handle prefix", async () => {
  const [, retweet] = await read("/bang_dream_info/rss", true);
  assert.equal(retweet!.title, "新年あけましておめでとうございます🎍");
  assert.equal(retweet!.excerpt, "新年あけましておめでとうございます🎍 今年も応援よろしくお願いします！");
  assert.equal(retweet!.bodyStatus, "ok");
  assert.ok(!retweet!.bodyText!.includes("RT by"));
});

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decodeURIComponent(m[1]!));

test("links inside a tweet point at x.com, not the mirror", async () => {
  const [tweet, , quoted] = await read("/bang_dream_info/rss", true);
  assert.ok(hrefs(tweet!.bodyHtml!).includes("https://x.com/hashtag/バンドリ"));
  assert.ok(hrefs(tweet!.bodyHtml!).includes("https://x.com/hashtag/AveMujica"));
  assert.ok(hrefs(tweet!.bodyHtml!).includes("https://x.com/bang_dream_info"));
  assert.ok(hrefs(tweet!.bodyHtml!).includes("https://bang-dream.com/")); // a site the tweet itself links: unchanged
  assert.ok(hrefs(quoted!.bodyHtml!).includes("https://x.com/AveMujica")); // a profile
  assert.ok(hrefs(quoted!.bodyHtml!).includes("https://x.com/AveMujica/status/1870000000")); // a quoted status, without #m
  assert.ok(hrefs(quoted!.bodyHtml!).includes("https://x.com/search?q=AveMujica")); // a search that is not a hashtag
  assert.ok(hrefs(quoted!.bodyHtml!).includes("https://t.co/b6C8jTdCTV")); // X's short link, not the mirror's proxy of it
  assert.ok(quoted!.bodyHtml!.includes("— https://x.com/AnichU_ntv/status/2107244693511663930")); // a mirror address written out as text
  assert.ok(!tweet!.bodyHtml!.includes(host));
  assert.ok(!quoted!.bodyHtml!.includes(host));
});

test("a normal news feed still bodies an entry by length alone", async () => {
  const [short, long] = await read("/music/rss");
  assert.equal(short!.bodyStatus, "pending");
  assert.equal(short!.bodyHtml, null);
  assert.equal(short!.bodyText, null);
  assert.equal(short!.excerpt, "詳細は後日発表。");
  assert.equal(short!.title, "短いお知らせ");
  assert.equal(long!.bodyStatus, "ok");
  assert.match(long!.bodyHtml!, /^<p>本日、バンドリ！/);
});
