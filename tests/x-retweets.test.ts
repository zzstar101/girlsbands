// X accounts read through SocialData keep what they retweet, as the Nitter feeds did: the search asks
// for native retweets, a retweet is stored as the original post marked retweetedBy, and every account
// the search showed (retweeted, quoted) gets its name and avatar recorded for the timeline cards.
import assert from "node:assert/strict";
import { test } from "node:test";
import { shardQuery, tweetToCandidate, xProfilesOf } from "@girlsbands/backend/sources/x";
import type { SdTweet } from "@girlsbands/backend/providers/socialdata";

const user = (screen_name: string, name: string) => ({ screen_name, name, profile_image_url_https: `https://pbs.twimg.com/profile_images/1/${screen_name}_normal.jpg` });
const original = {
  id_str: "1900000000000000001",
  tweet_created_at: "2026-10-11T09:00:00.000Z",
  full_text: "ライブ情報解禁！",
  lang: "ja",
  user: user("bang_dream_info", "バンドリ！ ガールズバンドパーティ！"),
  quoted_status: { id_str: "1899999999999999999", tweet_created_at: "2026-10-10T09:00:00.000Z", full_text: "告知", lang: "ja", user: user("Ancheri_info", "アンシェリ") },
} as unknown as SdTweet;
const retweet = {
  id_str: "1900000000000000002",
  tweet_created_at: "2026-10-11T10:00:00.000Z",
  full_text: "RT @bang_dream_info: ライブ情報解禁！",
  lang: "ja",
  user: user("Kanon_Takao", "高尾奏音"),
  retweeted_status: original,
} as unknown as SdTweet;

test("searches ask for native retweets, within the shard length budget", () => {
  assert.ok(shardQuery(["a", "b"]).endsWith(" include:nativeretweets"));
  assert.ok(shardQuery(["a"], ["a"]).endsWith("filter:self_threads) include:nativeretweets"));
});

test("a retweet is stored as the original post, marked with who retweeted it", () => {
  const c = tweetToCandidate(retweet);
  assert.equal(c.url, "https://x.com/bang_dream_info/status/1900000000000000001");
  assert.equal(c.identityKey, "x:1900000000000000001", "same identity as the original, so a second account retweeting it does not duplicate it");
  assert.equal(c.author, "bang_dream_info");
  assert.equal(c.publishedAt?.toISOString(), "2026-10-11T09:00:00.000Z");
  assert.equal(c.xPost?.handle, "bang_dream_info");
  assert.equal(c.xPost?.text, "ライブ情報解禁！");
  assert.deepEqual(c.xPost?.retweetedBy, { handle: "Kanon_Takao", authorName: "高尾奏音" });
  assert.equal(c.xPost?.quoted?.handle, "Ancheri_info");

  const own = tweetToCandidate(original);
  assert.equal(own.xPost?.retweetedBy, undefined, "an account's own post carries no retweet mark");
});

test("every account a search showed is recorded once, with a larger avatar", () => {
  const seeds = xProfilesOf([retweet, original]);
  assert.deepEqual(seeds.map((s) => s.handle).sort(), ["Ancheri_info", "Kanon_Takao", "bang_dream_info"]);
  const kanon = seeds.find((s) => s.handle === "Kanon_Takao")!;
  assert.equal(kanon.authorName, "高尾奏音");
  assert.equal(kanon.avatarUrl, "https://pbs.twimg.com/profile_images/1/Kanon_Takao_bigger.jpg");
});
