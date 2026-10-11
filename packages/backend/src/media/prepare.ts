// Images of a published item, prepared as it is published: each source picture is kept (so the item's
// images survive the source going away — an X mirror, a site), and every rendition its card and its
// page ask the image proxy for is made once (a first reader otherwise waits seconds for the source
// site); animations are re-encoded. For a newly selected item the share image is also rendered
// before the content push makes chat apps fetch it.
import { convertAnimated, hasRendition, keepOriginal, produceImage } from "./images.ts";
import { loadItemDetail } from "../publication/detail.ts";
import { toFeedItemSummary } from "../publication/items.ts";

/** The renditions an X avatar is shown in (a card's single avatar and its responsive srcset). */
export const AVATAR_MODES = ["avatar", "avatar-48", "avatar-96"] as const;

export interface PreparedMedia { originals: number; renditions: number; made: number; failed: number; animatedSaved: number }

/**
 * Keeps each picture's source and makes the renditions not in the cache yet. Already prepared
 * pictures cost a cache check each, so preparing an item again is cheap.
 */
export async function prepareRenditions(renditions: ReadonlyArray<{ url: string; mode: string }>): Promise<PreparedMedia> {
  const result: PreparedMedia = { originals: 0, renditions: renditions.length, made: 0, failed: 0, animatedSaved: 0 };
  const unavailable = new Set<string>();
  for (const url of new Set(renditions.map((r) => r.url))) {
    try {
      if ((await keepOriginal(url)) === "stored") result.originals += 1;
    } catch {
      // The source is unavailable now: renditions already made stay; the rest are tried by readers.
      unavailable.add(url);
    }
  }
  for (const { url, mode } of renditions) {
    try {
      if (await hasRendition(url, mode)) continue;
      if (unavailable.has(url)) { result.failed += 1; continue; }
      const image = await produceImage(url, mode);
      result.made += 1;
      if (image.type === "image/gif") result.animatedSaved += await convertAnimated(url, mode);
    } catch {
      // The request path tries again (and answers 502) if the source is still unavailable.
      result.failed += 1;
    }
  }
  return result;
}

/** X avatars (the profile cache's, e.g. a retweeter's shown on the seiyuu timeline) in every size. */
export function prepareAvatars(urls: readonly string[]): Promise<PreparedMedia> {
  return prepareRenditions([...new Set(urls)].flatMap((url) => AVATAR_MODES.map((mode) => ({ url, mode }))));
}

/** The (source, mode) pairs the proxy URLs in these public answers point at. */
export function proxiedRenditions(answers: unknown[]): Array<{ url: string; mode: string }> {
  const text = JSON.stringify(answers).replaceAll("&amp;", "&").replaceAll("\\u0026", "&");
  const seen = new Map<string, { url: string; mode: string }>();
  for (const m of text.matchAll(/\/api\/img-proxy\?u=([^&"\s\\]+)&mode=([a-z0-9-]+)/g)) {
    const url = decodeURIComponent(m[1]!);
    seen.set(`${m[2]}|${url}`, { url, mode: m[2]! });
  }
  return [...seen.values()];
}

export async function prepareArticleMedia(articleId: string): Promise<PreparedMedia> {
  const [zh, original] = await Promise.all([loadItemDetail(articleId), loadItemDetail(articleId, "original")]);
  if (zh.kind !== "found" || original.kind !== "found") return { originals: 0, renditions: 0, made: 0, failed: 0, animatedSaved: 0 };
  // The feed card (also the seiyuu timeline's: the same compact X view) and both detail pages.
  return prepareRenditions(proxiedRenditions([toFeedItemSummary(zh.row), zh.item, original.item]));
}

/**
 * Renders the article's share image through the local router, so it sits in the api's disk cache
 * before chat apps unfurl the pushed link. Best effort.
 */
export async function warmShareImage(articleId: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:3000/og/items/${encodeURIComponent(articleId)}.png`, { signal: AbortSignal.timeout(15_000) });
    await res.arrayBuffer();
    return res.ok;
  } catch {
    return false;
  }
}
