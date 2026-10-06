/**
 * 谁发了这条 X 帖子：Nitter 的 RSS 镜像只管转手。
 *
 * 转推条目（`RT by @someone:`）的 dc:creator 是原推作者，引用块里也只有 `<b>名字
 * (@handle)</b>`，都没带名字和头像。fxtwitter 的公开 API 是唯一不要 key 的补齐途径，所以
 * 这里把它查到的「handle → (名字, 头像)」缓存进 x_profiles：采集时顺手把每条 feed 自己的
 * 账号写进去（免费），其余 handle 限流地查一次（30 天内不重复）。读取路径不能联网，所以
 * 展示时的补齐发生在查询的 JOIN 里（publication/items.ts）。
 */
import { sql } from "../db.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import type { MediaItem, XPostData } from "../content/materials.ts";
import type { Candidate } from "./types.ts";
import type { XFeedOwner } from "./rss.ts";

/** fxtwitter: 不要 key，按 handle 给名字和头像。 */
const FX_BASE = "https://api.fxtwitter.com";

/** 一次采集最多补几个陌生 handle：每个都是一次网络请求，不能让采集卡在这上面。 */
const ENRICH_LIMIT = 10;

/** 同一 handle 两次查询之间的间隔：fxtwitter 是免费公共服务，别当缓存用。 */
const PROFILE_TTL_DAYS = 30;

/** fxtwitter 账号查询的超时：查不到就下次，反正镜像 feed 会再来。 */
const LOOKUP_TIMEOUT_MS = 5_000;

/** 抓单条推文时的超时：回填脚本一次一条，给得比补齐宽一点。 */
const STATUS_TIMEOUT_MS = 15_000;

/** 一个账号在缓存里需要的东西。 */
export interface XProfileSeed {
  handle: string;
  authorName: string | null;
  avatarUrl: string | null;
}

/** fxtwitter 的账号字段：`screen_name` 是 handle，`name` 才是显示名。 */
interface FxUser {
  screen_name?: string;
  name?: string;
  avatar_url?: string;
}

/** fxtwitter 单条推文的字段（只列用得上的）。 */
export interface FxTweet {
  id?: string;
  text?: string;
  url?: string;
  lang?: string;
  author?: FxUser;
  replying_to?: unknown;
  media?: {
    photos?: Array<{ url?: string; width?: number; height?: number }>;
    videos?: Array<{ url?: string; thumbnail_url?: string; width?: number; height?: number }>;
  };
  quote?: FxTweet;
}

/** fxtwitter 的头像默认给 48px 的 `_normal`，站上要放大看，换成 `_bigger`。 */
function biggerAvatar(url: string | undefined): string | null {
  const trimmed = url?.trim();
  return trimmed ? trimmed.replace(/_normal\./, "_bigger.") : null;
}

/** fxtwitter 的形状里，回复对象可能是 handle 字符串，也可能是用户对象。 */
function replyHandleOf(replyingTo: unknown): string | null {
  if (typeof replyingTo === "string") return replyingTo.replace(/^@/, "").trim() || null;
  const screenName = (replyingTo as FxUser | null)?.screen_name;
  return screenName?.replace(/^@/, "").trim() || null;
}

/** 推文带的媒体：照片就是图；视频只存封面，url 指向原推（web 端视频块点进去看原推）。 */
function fxMediaOf(media: FxTweet["media"], postUrl: string): MediaItem[] {
  const items: MediaItem[] = [];
  for (const photo of media?.photos ?? []) {
    const url = photo.url?.trim();
    if (url) {
      items.push({
        kind: "image",
        url,
        ...(photo.width && photo.height ? { width: photo.width, height: photo.height } : {}),
      });
    }
  }
  for (const video of media?.videos ?? []) {
    const poster = video.thumbnail_url?.trim();
    if (poster) items.push({ kind: "video", url: postUrl, poster });
  }
  return items.slice(0, 4);
}

function fxQuotedOf(quote: FxTweet | undefined): XPostData["quoted"] {
  const handle = quote?.author?.screen_name?.trim();
  if (!handle) return null;
  const id = String(quote?.id ?? "").trim();
  const url = id ? `https://x.com/${handle}/status/${id}` : String(quote?.url ?? "").trim();
  return {
    authorName: quote?.author?.name?.trim() || handle,
    handle,
    text: typeof quote?.text === "string" ? quote.text : "",
    url,
    avatarUrl: biggerAvatar(quote?.author?.avatar_url),
    media: fxMediaOf(quote?.media, url),
  };
}

/**
 * fxtwitter 的一条推文 → 站上的 X 帖子。镜像那条路径（rss.ts 的 xPostOf）产出同一种形状，
 * 两条路写进 x_post 的数据才能被同一个前端渲染。纯函数，测试不需要网络。
 */
export function fxTweetToXPost(tweet: FxTweet): XPostData | null {
  const handle = tweet.author?.screen_name?.trim();
  const tweetId = String(tweet.id ?? "").trim();
  if (!handle || !tweetId) return null;
  const postUrl = `https://x.com/${handle}/status/${tweetId}`;
  return {
    tweetId,
    authorName: tweet.author?.name?.trim() || handle,
    handle,
    avatarUrl: biggerAvatar(tweet.author?.avatar_url),
    text: typeof tweet.text === "string" ? tweet.text : "",
    retweetedBy: null,
    quoted: fxQuotedOf(tweet.quote),
    media: fxMediaOf(tweet.media, postUrl),
    lang: tweet.lang ?? null,
    replyTo: replyHandleOf(tweet.replying_to),
  };
}

/** 一次采集的条目里提到的账号：feed 自己的排最前（它的名字和头像是免费拿到的）。 */
export function xProfileSeeds(owner: XFeedOwner | null, candidates: readonly Candidate[]): XProfileSeed[] {
  const seeds = new Map<string, XProfileSeed>();
  const add = (handle: string | null | undefined, authorName?: string | null, avatarUrl?: string | null): void => {
    if (!handle) return;
    const known = seeds.get(handle);
    seeds.set(handle, {
      handle,
      authorName: known?.authorName ?? authorName ?? null,
      avatarUrl: known?.avatarUrl ?? avatarUrl ?? null,
    });
  };
  if (owner) add(owner.handle, owner.authorName, owner.avatarUrl);
  for (const candidate of candidates) {
    const xPost = candidate.xPost;
    if (!xPost) continue;
    // 转推作者的 authorName 存的是 handle 占位（详见 rss.ts 的 xPostOf），不能当名字写进缓存。
    add(xPost.handle);
    add(xPost.retweetedBy?.handle, xPost.retweetedBy?.authorName, null);
    add(xPost.quoted?.handle);
  }
  return [...seeds.values()];
}

/**
 * 写缓存：后来查到的可以补上先前缺的头像，已知道的字段不被覆盖。
 * handle 一律小写入库 —— X 的大小写只是展示用，而镜像、fxtwitter、引用链接各写各的，
 * 读取时按小写 JOIN（items.ts 的 lower(x_post->>'handle')）才不会漏。
 */
export async function recordXProfiles(profiles: readonly XProfileSeed[]): Promise<void> {
  const byHandle = new Map<string, [string, string | null, string | null]>();
  for (const p of profiles) {
    if (!p.handle || !(p.authorName || p.avatarUrl)) continue;
    const key = p.handle.toLowerCase();
    const known = byHandle.get(key);
    byHandle.set(key, [key, known?.[1] ?? p.authorName ?? null, known?.[2] ?? p.avatarUrl ?? null]);
  }
  if (!byHandle.size) return;
  const rows = [...byHandle.values()];
  await sql`
    INSERT INTO x_profiles (handle, author_name, avatar_url)
    VALUES ${sql(rows.map((row) => (row as string[]), { simple: true }))}
    ON CONFLICT (handle) DO UPDATE SET
      author_name = COALESCE(EXCLUDED.author_name, x_profiles.author_name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, x_profiles.avatar_url),
      fetched_at = now()`;
}

/** 该查一次的 handle：缓存里没有，或名字是 30 天前查的。 */
async function staleProfiles(handles: readonly string[], limit: number): Promise<string[]> {
  if (!handles.length) return [];
  const rows = await sql<{ handle: string }[]>`
    SELECT h AS handle FROM unnest(${[...new Set(handles.map((h) => h.toLowerCase()))]}::text[]) AS h
    WHERE NOT EXISTS (
      SELECT 1 FROM x_profiles p
      WHERE p.handle = h AND p.author_name IS NOT NULL
        AND p.fetched_at > now() - make_interval(days => ${PROFILE_TTL_DAYS}))
    LIMIT ${limit}`;
  return rows.map((r) => r.handle);
}

/** 查一个账号的名字和头像。查不到（或挂了）返回 null，绝不抛出去。 */
export async function fetchXProfile(handle: string): Promise<Omit<XProfileSeed, "handle"> | null> {
  const res = await guardedFetch(`${FX_BASE}/${encodeURIComponent(handle)}`, {
    timeoutMs: LOOKUP_TIMEOUT_MS,
    headers: { accept: "application/json" },
  });
  if (res.status !== 200) return null;
  const user = readJson(res)?.user;
  const screenName = user?.screen_name?.trim();
  if (!screenName) return null;
  return { authorName: user?.name?.trim() || screenName, avatarUrl: biggerAvatar(user?.avatar_url) };
}

/** 查一条推文。删推/隐藏返回 null（fxtwitter 给 404），调用方跳过即可。 */
export async function fetchXStatus(handle: string, id: string): Promise<FxTweet | null> {
  const res = await guardedFetch(`${FX_BASE}/${encodeURIComponent(handle)}/status/${encodeURIComponent(id)}`, {
    timeoutMs: STATUS_TIMEOUT_MS,
    headers: { accept: "application/json" },
  });
  if (res.status !== 200) return null;
  const tweet = readJson(res)?.tweet;
  return tweet?.id ? tweet : null;
}

function readJson(res: { text(): string }): { code?: number; user?: FxUser; tweet?: FxTweet } {
  try {
    return JSON.parse(res.text());
  } catch {
    return {};
  }
}

/**
 * 采集后顺手补名字：feed 自己账号直接写，其余 handle  ≤ N 个去 fxtwitter 查一次。
 * 只是展示数据，任何一步失败都不能让一次采集失败。
 */
export async function enrichXProfiles(seeds: readonly XProfileSeed[]): Promise<void> {
  if (!seeds.length) return;
  const named = seeds.filter((s) => s.authorName || s.avatarUrl);
  if (named.length) await recordXProfiles(named);
  for (const handle of await staleProfiles(
    seeds.map((s) => s.handle),
    ENRICH_LIMIT,
  )) {
    try {
      const profile = await fetchXProfile(handle);
      if (profile?.authorName) await recordXProfiles([{ handle, ...profile }]);
    } catch {
      // 一个 handle 查失败不影响别的，下次采集再来。
    }
  }
}
