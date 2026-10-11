// Advertising ID-sync endpoints were captured as images in older Jina bodies. They are not article
// illustrations, even when a tracking endpoint happens to return a one-pixel GIF.
const TRACKING_HOSTS = new Set([
  "ids4.ad.gt", "ids.ad.gt", "secure.adnxs.com", "sync.1rx.io", "ssum-sec.casalemedia.com",
  "sync.smartadserver.com", "token.rubiconproject.com", "image2.pubmatic.com", "sync.go.sonobi.com", "onetag-sys.com",
]);

// Hatena's feed puts a favicon (and an "append" pixel) ahead of the article's own picture in the same
// media list, so a naive "first image" of those feeds is a 64px icon, never an illustration.
const ICON_HOSTS = new Set([
  "b.st-hatena.com", "b.hatena.ne.jp", "favicon.st-hatena.com", "cdn-ak.favicon.st-hatena.com",
  "cdn-ak2.favicon.st-hatena.com", "cdn-ak-scissors.b.st-hatena.com",
]);

export function isTrackingImage(src: string, width?: string, height?: string): boolean {
  if (width !== undefined && height !== undefined && Number(width) <= 1 && Number(height) <= 1) return true;
  try {
    const host = new URL(src).hostname.toLowerCase();
    return TRACKING_HOSTS.has(host) || ICON_HOSTS.has(host) || host.endsWith(".favicon.st-hatena.com") || /\/append\.gif$/i.test(src);
  } catch { return false; }
}

/** A picture an announcement carries, before it becomes a proxy URL. */
export interface Picture {
  url: string;
  width: number | null;
  height: number | null;
}

/** Below this a media entry is an icon or a thumbnail, not an illustration (the hot ranking's cover rule). */
const MIN_COVER_WIDTH = 480;

/**
 * Some feeds keep the HTML entity in the attribute they stored (`?width=640&amp;crop=smart`). Left as
 * is, it would travel into the proxy's own query string and reach the origin as a broken parameter.
 */
function decodedUrl(url: string): string {
  return url.replace(/&amp;/gi, "&").replace(/&#0*38;/g, "&");
}

/**
 * The first real illustration in an announcement's media list: images only, tracking pixels and
 * off-site favicons skipped, entries that declare a width too narrow for a card left out. Entries
 * without a width pass — most feeds never say, and the hot ranking's covers read them the same way.
 */
export function pickPicture(media: unknown): Picture | null {
  if (!Array.isArray(media)) return null;
  for (const entry of media) {
    if (!entry || typeof entry !== "object") continue;
    const m = entry as Record<string, unknown>;
    if (m.kind !== "image") continue;
    const raw = typeof m.url === "string" && m.url !== "" ? m.url : null;
    if (raw === null) continue;
    const url = decodedUrl(raw);
    if (isTrackingImage(url)) continue;
    const width = typeof m.width === "number" ? m.width : null;
    const height = typeof m.height === "number" ? m.height : null;
    if (width !== null && width < MIN_COVER_WIDTH) continue;
    return { url, width, height };
  }
  return null;
}

/** The first usable picture across several announcements, in the order SQL ranked them. */
export function firstPicture(mediaList: unknown[]): Picture | null {
  for (const media of mediaList) {
    const picture = pickPicture(media);
    if (picture) return picture;
  }
  return null;
}

/**
 * The X picture behind a Nitter mirror's /pic/ address. Nitter RSS hands out its own proxy for every
 * avatar and photo (`/pic/https%3A%2F%2Fpbs.twimg.com%2F…`, `/pic/media%2FXXXX.jpg`,
 * `/pic/pbs.twimg.com%2Fmedia…`, `/pic/orig/…`, `/pic/enc/<base64>`); when the volunteer mirror goes
 * down every one of those breaks, while the same picture is still on pbs.twimg.com. Null when the
 * address is not such a proxy, or does not lead to an X image host.
 */
export function unwrapNitterPicture(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)nitter\.|^xcancel\.com$/i.test(u.hostname)) return null;
  const m = /^\/pic\/(?:orig\/)?(enc\/)?(.+)$/.exec(u.pathname);
  if (!m) return null;
  let rest: string;
  try {
    rest = m[1] ? Buffer.from(decodeURIComponent(m[2]!), "base64url").toString("utf8") : decodeURIComponent(m[2]! + u.search);
  } catch { return null; }
  const target = /^https?:\/\//i.test(rest) ? rest : /^(pbs|video)\.twimg\.com\//i.test(rest) ? `https://${rest}` : `https://pbs.twimg.com/${rest.replace(/^\/+/, "")}`;
  try {
    const host = new URL(target).hostname.toLowerCase();
    return host === "pbs.twimg.com" || host === "video.twimg.com" ? target : null;
  } catch { return null; }
}
