// X posts come from a Nitter mirror: the tweet's HTML is the body however short it is (x.com serves
// no page to fetch afterwards), a retweet's "RT by @handle: " is the mirror's markup, and a link in
// the body that points at the mirror is its x.com page. A news feed still bodies entries by length.
// On top of the body, each entry carries the post itself (x_post): author, quoted post and media,
// so the site renders a tweet like a tweet instead of a plain article.
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@girlsbands/backend/config";
import { fetchRss } from "@girlsbands/backend/sources/rss";
import { fxTweetToXPost } from "@girlsbands/backend/sources/x-profiles";
import { proxiedImage } from "@girlsbands/backend/media/imgproxy";

const OWNER_NAME = "バンドリ！ BanG Dream! 公式";
const OWNER_AVATAR = "https://pbs.twimg.com/profile_images/FakeOwner/FakeAvatar_x_400x400.jpg";

// The server stands in for the mirror: item links, body links and the feed itself all live on it.
const mirrorFeed = (root: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${OWNER_NAME} / @bang_dream_info</title><link>${root}/bang_dream_info</link><description>bang_dream_info's tweets, retweeted</description>
<image><url>${OWNER_AVATAR}</url><title>${OWNER_NAME} / @bang_dream_info</title><link>${root}/bang_dream_info</link></image>
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
<title>RT by @bang_dream_info: 新年あけましておめでとうございます🎍</title>
<dc:creator>@AveMujica_PR</dc:creator>
<description><![CDATA[RT by @bang_dream_info: 新年あけましておめでとうございます🎍<br><br>今年も応援よろしくお願いします！]]></description>
<pubDate>Wed, 01 Jan 2025 09:00:00 GMT</pubDate>
<guid isPermaLink="false">1875000000</guid>
<link>${root}/bang_dream_info/status/1875000000#m</link>
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
<item>
<title>ジャケットを公開しました</title>
<dc:creator>@bang_dream_info</dc:creator>
<description><![CDATA[<p>新曲のジャケットを公開🎵<br><br><img src="https://pbs.twimg.com/media/FakeCover.jpg" style="max-width:250px;"></p><hr><blockquote><b>湊友希那 (@MinaYukina)</b><p><p>ジャケットが公開されました！</p><img src="https://pbs.twimg.com/media/FakeQuote.jpg" style="max-width:250px;"></p><footer>— <cite><a href="${root}/MinaYukina/status/1876000000#m">${root}/MinaYukina/status/1876000000</a></cite></footer></blockquote>]]></description>
<pubDate>Fri, 10 Jan 2025 15:00:00 GMT</pubDate>
<guid isPermaLink="false">1876888888</guid>
<link>${root}/bang_dream_info/status/1876888888#m</link>
</item>
<item>
<title>MVを公開しました</title>
<dc:creator>@bang_dream_info</dc:creator>
<description><![CDATA[<p>MVを公開しました🎬<br><br><a href="https://piped.video/AbCdEfGhI?si=xyz">piped.video/AbCdEfGhI?si=xyz</a></p>
<a href="${root}/bang_dream_info/status/1877000000#m"><br>Video<br><img src="https://pbs.twimg.com/amplify_video_thumb/FakeVid/FakeThumb.jpg" style="max-width:250px;"></a>]]></description>
<pubDate>Fri, 10 Jan 2025 16:00:00 GMT</pubDate>
<guid isPermaLink="false">1877000000</guid>
<link>${root}/bang_dream_info/status/1877000000#m</link>
</item>
<item>
<title>R to @AveMujica: 最新話の感想</title>
<dc:creator>@bang_dream_info</dc:creator>
<description><![CDATA[R to @AveMujica: 最新話の感想<br>ありがとうございます]]></description>
<pubDate>Fri, 10 Jan 2025 17:00:00 GMT</pubDate>
<guid isPermaLink="false">1877111111</guid>
<link>${root}/bang_dream_info/status/1877111111#m</link>
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

test("an own post carries the feed owner's name, avatar, text and media", async () => {
  const [tweet] = await read("/bang_dream_info/rss", true);
  const x = tweet!.xPost!;
  assert.equal(x.tweetId, "1876543210");
  assert.equal(x.handle, "bang_dream_info");
  assert.equal(x.authorName, OWNER_NAME); // the feed owner names itself in the channel's title
  assert.equal(x.avatarUrl, OWNER_AVATAR);
  assert.equal(x.retweetedBy, null);
  assert.equal(x.replyTo, null);
  assert.deepEqual(x.media, [{ kind: "image", url: "https://pbs.twimg.com/media/Fake1234.jpg" }]);
  assert.match(x.text, /^TVアニメ「BanG Dream! Ave Mujica」\n再放送が決定💫/); // the tweet's own line breaks
  assert.match(x.text, /日本テレビにて放送スタート🌙/);
  assert.ok(!x.text.includes("style=")); // an img tag's tail is not tweet text
  assert.ok(!x.text.includes("RT by"));
});

test("a retweet's author is the handle dc:creator names and the owner is who retweeted it", async () => {
  const [, retweet] = await read("/bang_dream_info/rss", true);
  assert.equal(retweet!.xPost!.handle, "AveMujica_PR"); // the original author, not the feed owner
  assert.equal(retweet!.xPost!.authorName, "AveMujica_PR"); // a handle alone until x_profiles names it
  assert.equal(retweet!.xPost!.avatarUrl, null);
  assert.deepEqual(retweet!.xPost!.retweetedBy, { handle: "bang_dream_info", authorName: OWNER_NAME });
  assert.equal(retweet!.xPost!.text, "新年あけましておめでとうございます🎍\n\n今年も応援よろしくお願いします！");
  assert.equal(retweet!.xPost!.tweetId, "1875000000");
});

test("a quoted post is parsed out of the blockquote into its own card", async () => {
  const [, , quoted, quotedByName] = await read("/bang_dream_info/rss", true);
  // The mirror's old format: one blockquote with <hr> between the quote and its attribution.
  assert.deepEqual(quoted!.xPost!.quoted, {
    authorName: "AveMujica", // no <b> names the account: the handle stands in until enrichment
    handle: "AveMujica",
    text: "本編の感想を教えてください",
    url: "https://x.com/AveMujica/status/1870000000",
    avatarUrl: null,
    media: [],
  });
  assert.equal(quoted!.xPost!.quoted!.text, "本編の感想を教えてください");
  assert.ok(!quoted!.xPost!.text.includes("本編の感想を教えてください")); // the quote is not the post's text

  // The current format: <b> names the author, the quote keeps its own media, the footer links the status.
  assert.deepEqual(quotedByName!.xPost!.quoted, {
    authorName: "湊友希那",
    handle: "MinaYukina",
    text: "ジャケットが公開されました！",
    url: "https://x.com/MinaYukina/status/1876000000",
    avatarUrl: null,
    media: [{ kind: "image", url: "https://pbs.twimg.com/media/FakeQuote.jpg" }],
  });
  assert.deepEqual(quotedByName!.xPost!.media, [{ kind: "image", url: "https://pbs.twimg.com/media/FakeCover.jpg" }]);
  assert.ok(!quotedByName!.xPost!.text.includes("ジャケットが公開されました"));
});

test("a video is its thumb, linked to the status it belongs to", async () => {
  const [, , , , video] = await read("/bang_dream_info/rss", true);
  assert.deepEqual(video!.xPost!.media, [
    { kind: "video", url: "https://x.com/bang_dream_info/status/1877000000", poster: "https://pbs.twimg.com/amplify_video_thumb/FakeVid/FakeThumb.jpg" },
  ]);
});

test("a piped.video link is the YouTube page it plays, in body and post alike", async () => {
  const [, , , , video] = await read("/bang_dream_info/rss", true);
  assert.ok(hrefs(video!.bodyHtml!).includes("https://www.youtube.com/watch?v=AbCdEfGhI"));
  assert.ok(!video!.bodyHtml!.includes("piped.video")); // the address written out as link text too
  assert.match(video!.xPost!.text, /https:\/\/www\.youtube\.com\/watch\?v=AbCdEfGhI/);
  assert.ok(!video!.xPost!.text.includes("piped.video"));
});

test("a reply's prefix names the account replied to and leaves the post's text", async () => {
  const [,,,,, reply] = await read("/bang_dream_info/rss", true);
  assert.equal(reply!.title, "最新話の感想");
  assert.deepEqual(reply!.xPost, {
    tweetId: "1877111111",
    authorName: OWNER_NAME,
    handle: "bang_dream_info",
    avatarUrl: OWNER_AVATAR,
    text: "最新話の感想\nありがとうございます",
    retweetedBy: null,
    quoted: null,
    media: [],
    replyTo: "AveMujica",
  });
});

test("fxtwitter's tweet becomes the same X post a mirror's entry does", () => {
  const xPost = fxTweetToXPost({
    id: "1870000001",
    text: "一行目\n二行目",
    url: "https://x.com/AveMujica_PR/status/1870000001",
    lang: "ja",
    author: { screen_name: "AveMujica_PR", name: "Ave Mujica", avatar_url: "https://pbs.twimg.com/profile_images/FakeAvatar_x_normal.jpg" },
    media: {
      photos: [{ url: "https://pbs.twimg.com/media/Fake1.jpg?name=orig", width: 1200, height: 900 }],
      videos: [{ url: "https://video.twimg.com/FakeVid.mp4", thumbnail_url: "https://pbs.twimg.com/amplify_video_thumb/FakeThumb.jpg", width: 720, height: 1280 }],
    },
    quote: {
      id: "1860000000",
      text: "引用されたポスト",
      author: { screen_name: "bang_dream_info", name: "バンドリ！ BanG Dream! 公式", avatar_url: "https://pbs.twimg.com/profile_images/FakeOwner_x_bigger.jpg" },
    },
  });
  assert.deepEqual(xPost, {
    tweetId: "1870000001",
    authorName: "Ave Mujica",
    handle: "AveMujica_PR",
    avatarUrl: "https://pbs.twimg.com/profile_images/FakeAvatar_x_bigger.jpg",
    text: "一行目\n二行目",
    retweetedBy: null,
    quoted: {
      authorName: "バンドリ！ BanG Dream! 公式",
      handle: "bang_dream_info",
      text: "引用されたポスト",
      url: "https://x.com/bang_dream_info/status/1860000000",
      avatarUrl: "https://pbs.twimg.com/profile_images/FakeOwner_x_bigger.jpg",
      media: [],
    },
    media: [
      { kind: "image", url: "https://pbs.twimg.com/media/Fake1.jpg?name=orig", width: 1200, height: 900 },
      { kind: "video", url: "https://x.com/AveMujica_PR/status/1870000001", poster: "https://pbs.twimg.com/amplify_video_thumb/FakeThumb.jpg" },
    ],
    lang: "ja",
    replyTo: null,
  });
});

test("fxtwitter's tweet without an author is no post at all", () => {
  assert.equal(fxTweetToXPost({ id: "1", text: "x" }), null);
  assert.equal(fxTweetToXPost({ text: "x", author: { screen_name: "bang_dream_info", name: "N" } }), null);
});

test("a handle alone is displayed as the account's name once the cache knows it", async () => {
  const { xView } = await import("@girlsbands/backend/publication/items");
  // 采集写下的占位（名字栏只有 handle）在读路径被 x_profiles 的真名/头像顶掉；缓存没有就还是 handle。
  const row = {
    zh_text: null,
    x_post: {
      tweetId: "1875000000", handle: "AveMujica_PR", authorName: "AveMujica_PR", text: "hi",
      retweetedBy: { handle: "bang_dream_info", authorName: "バンドリ！ BanG Dream! 公式" },
      quoted: { handle: "MinaYukina", authorName: "MinaYukina", text: "q", url: "https://x.com/MinaYukina/status/1876000000" },
    },
    x_profile_name: "Ave Mujica", x_profile_avatar: "https://pbs.twimg.com/profile_images/A_x_bigger.jpg",
    x_quoted_name: "湊友希那", x_quoted_avatar: "https://pbs.twimg.com/profile_images/M_x_bigger.jpg",
  };
  const view = xView(row as never)!;
  assert.equal(view.authorName, "Ave Mujica");
  assert.equal(view.avatarUrl, proxiedImage("https://pbs.twimg.com/profile_images/A_x_bigger.jpg", "avatar"));
  assert.equal(view.quoted?.authorName, "湊友希那");
  assert.equal(view.quoted?.avatarUrl, proxiedImage("https://pbs.twimg.com/profile_images/M_x_bigger.jpg", "avatar"));
  assert.deepEqual(view.retweetedBy, { handle: "bang_dream_info", authorName: "バンドリ！ BanG Dream! 公式" });
  // A real name the mirror or the API gave is never replaced by the cache's.
  const named = xView({ zh_text: null, x_post: { tweetId: "1", handle: "AveMujica_PR", authorName: "Ave Mujica", text: "hi" }, x_profile_name: "别的名字" } as never)!;
  assert.equal(named.authorName, "Ave Mujica");
});
