// RSS 2.0 / Atom / RDF feeds.
import { XMLParser } from "fast-xml-parser";
import { guardedFetch } from "../lib/http-fetch.ts";
import { collapseWhitespace, stripTags } from "../lib/text.ts";
import { sanitizeBody } from "../content/sanitize.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import type { MediaItem, XPostData } from "../content/materials.ts";
import { FetchError, type Candidate, type SourceRow } from "./types.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  // XHTML is mixed content: keep its markup and text order for stripTags/sanitizeBody below.
  // Only XHTML stops parsing; escaped HTML and CDATA retain their existing entity handling.
  stopNodes: ["feed.entry.title[type=xhtml]", "feed.entry.summary[type=xhtml]", "feed.entry.content[type=xhtml]"],
});

/** An X post carries at most four photos or videos. */
const MAX_TWEET_MEDIA = 4;

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#cdata" in o) return text(o["#cdata"]);
    if ("#text" in o) return text(o["#text"]);
  }
  return "";
}

function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseDate(v: string): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (Number.isFinite(t)) return new Date(t);
  // RFC 822 variants with Chinese weekday or odd zones
  const cleaned = v.replace(/星期[一二三四五六日天]/, "").replace(/\s+/g, " ").trim();
  const t2 = Date.parse(cleaned);
  return Number.isFinite(t2) ? new Date(t2) : null;
}

function atomLink(links: unknown, base: string): string {
  const list = arr(links as Record<string, string> | Array<Record<string, string>>);
  const alt = list.find((l) => typeof l === "object" && (!l["@rel"] || l["@rel"] === "alternate"));
  const link = alt ?? list[0];
  const href = typeof link === "string" ? link : link?.["@href"];
  if (!href) return "";
  const linkBase = typeof link === "object" ? new URL(link["@xml:base"] ?? "", base).toString() : base;
  return new URL(href, linkBase).toString();
}

function imagesFrom(html: string, base: string): Array<{ kind: "image"; url: string }> {
  const out: Array<{ kind: "image"; url: string }> = [];
  for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
    try {
      out.push({ kind: "image", url: new URL(m[1]!, base).toString() });
    } catch {
      // ignore bad urls
    }
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Feed text of an editorial source that only teases the article: short and ending in a "read more"
 * mark (The Verge's "Read the full story at The Verge."). Treated as a summary, so extraction fetches
 * the page before the article is judged.
 */
const TEASER_BELOW = 1200;
const TEASER_MARKS = [
  /\bappeared first on\b/i,
  /\bread (?:the )?full (?:story|article)\b/i,
  /\bcontinue reading\b/i,
  /\bread more\b/i,
  /…\s*$/,
  /\[\s*(?:…|\.\.\.)\s*\]\s*$/,
];

export function isTeaser(text: string): boolean {
  const t = text.trim();
  return t.length < TEASER_BELOW && TEASER_MARKS.some((m) => m.test(t));
}

/**
 * X posts are read through a Nitter mirror: the item links a source rewrites to x.com are mirror
 * links, so a mirror's own page (a hashtag search, a profile, a quoted status) is the post's address
 * on a host nobody should end up on.
 */
const isXMirror = (source: SourceRow) => /^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i.test(String(source.config.itemUrlPrefixRewrite?.to ?? ""));

/** The host a feed's item links live on, which a body's links point at as well. */
export function mirrorHost(link: string): string | null {
  try {
    const url = new URL(link);
    return /^https?:$/.test(url.protocol) ? url.host : null;
  } catch {
    return null;
  }
}

const A_HREF = /(<a\b[^>]*\shref=)(["'])(.*?)\2/gi;

/** A link inside a tweet's body: its x.com address when it is a mirror page. */
function xLink(href: string, mirror: string): string {
  let url: URL;
  try {
    url = new URL(href, `http://${mirror}/`);
  } catch {
    return href;
  }
  if (url.host !== mirror) return href; // the post's own links: other sites the tweet points at
  const q = url.searchParams.get("q") ?? "";
  if (url.pathname === "/search" && q) {
    return q.startsWith("#")
      ? `https://x.com/hashtag/${encodeURIComponent(q.slice(1))}`
      : `https://x.com/search?q=${encodeURIComponent(q)}`;
  }
  const status = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(url.pathname);
  if (status) return `https://x.com/${status[1]}/status/${status[2]}`; // the mirror's #m anchor is its own
  // The mirror proxies X's short links under its own host; the reader wants t.co itself.
  const short = /^\/t\.co\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
  if (short) return `https://t.co/${short[1]}`;
  const profile = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(url.pathname);
  return profile ? `https://x.com/${profile[1]}` : href;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every link of a tweet's body that points at the mirror, as its x.com address — the hrefs, and the
 * mirror addresses written out as text (a quoted tweet ends with "— http://<mirror>/user/status/…#m").
 */
export function mirrorBody(html: string, mirror: string): string {
  const hrefs = html.replace(A_HREF, (_m, head: string, quote: string, href: string) => `${head}${quote}${xLink(href, mirror)}${quote}`);
  const bare = new RegExp(`https?://${escapeRe(mirror)}/[^\\s"'<>]*`, "gi");
  return hrefs.replace(bare, (url) => xLink(url, mirror));
}

/** A retweet in a Nitter feed: "RT by @handle: " before the quoted post's text. */
const RETWEET_PREFIX = /^RT by @([^\s:]+):\s+/;
/** A reply in a Nitter feed: "R to @handle: " before the post's own text. */
const REPLY_PREFIX = /^R to @([^\s:]+):\s+/;

/**
 * The owner a mirror feed states about itself: its channel title is "<name> / @handle" and its
 * channel image is that account's avatar. A mirror's items never name a retweet's author, but the
 * owner's own posts (the common case) get name and avatar free with every fetch.
 */
export interface XFeedOwner {
  handle: string;
  authorName: string | null;
  avatarUrl: string | null;
}

export function xOwnerOf(channelTitle: string, channelImage: string): XFeedOwner | null {
  const handle = /\/\s*@([A-Za-z0-9_]{1,15})\s*$/.exec(channelTitle.trim());
  if (!handle) return null;
  const authorName = channelTitle.trim().slice(0, handle.index).trim();
  return { handle: handle[1]!, authorName: authorName || null, avatarUrl: channelImage.trim() || null };
}

/** The status id a mirror item link points at: "…/<user>/status/<id>#m". */
const tweetIdOf = (link: string) => /\/status\/(\d+)/.exec(link)?.[1] ?? null;

/** An author as Nitter's dc:creator states it: "@handle". */
const handleOf = (author: string) => /@?([A-Za-z0-9_]{1,15})$/.exec(author.trim())?.[1] ?? null;

/**
 * A piped.video link in a tweet, as the YouTube page it plays. Its own parameters survive — a ?t=
 * starts the video where the tweet meant it — except si, which is piped's share id and means nothing
 * on YouTube. Written with and without the scheme, because Nitter also writes the address out as the
 * link's text.
 */
const PIPED_LINK = /(?:https?:\/\/)?(?:www\.)?piped\.video\/([A-Za-z0-9_-]{8,14})(\?[^"'\s<>]*)?/gi;

const pipedToYouTube = (id: string, query?: string) => {
  if (!query) return `https://www.youtube.com/watch?v=${id}`;
  const kept = new URLSearchParams(query.slice(1));
  kept.delete("si");
  const tail = kept.toString();
  return `https://www.youtube.com/watch?v=${id}${tail ? `&${tail}` : ""}`;
};

const rewritePipedLinks = (html: string) => html.replace(PIPED_LINK, (_m, id: string, query?: string) => pipedToYouTube(id, query));

const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/g, " "], [/&amp;/g, "&"], [/&lt;/g, "<"], [/&gt;/g, ">"], [/&quot;/g, '"'], [/&#39;|&apos;/g, "'"],
];

/**
 * A tweet's plain text: its HTML's text with the line break a tweet wrote kept — stripTags collapses
 * every newline to a space, which would run a tweet's lines together.
 */
function tweetPlainText(html: string): string {
  let s = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(NITTER_VIDEO, " ")
    .replace(IMG_TAG, " ") // the whole tag: what follows src="…" is more attributes, not text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|blockquote|pre|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  for (const [re, to] of ENTITIES) s = s.replace(re, to);
  return s
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Nitter marks a video as an anchor to the very status, a "Video" caption over its thumb. */
const NITTER_VIDEO = /<a\b[^>]*>\s*(?:<br\s*\/?>\s*)*Video\b[^<]*(?:<br\s*\/?>\s*)*<img\b[^>]*\bsrc="([^"]+)"[^>]*\/?>\s*<\/a>/gi;
const IMG = /<img\b[^>]*\bsrc="([^"]+)"/gi;
/** A whole img element: IMG alone stops at src="…" and leaves the rest of its attributes as text. */
const IMG_TAG = /<img\b[^>]*>/gi;

const urlOf = (raw: string, base: string) => {
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
};

/**
 * A post's media as the site shows it: pictures as images; a video as the still its thumb is, linked
 * to the status — the site itself plays nothing, the still opens the post (MediaGallery does the
 * same for x.com search posts).
 */
function mediaOf(html: string, base: string, postUrl: string): MediaItem[] {
  const out: MediaItem[] = [];
  for (const m of html.matchAll(NITTER_VIDEO)) {
    const thumb = urlOf(m[1]!, base);
    if (thumb) out.push({ kind: "video", url: postUrl, poster: thumb });
  }
  for (const m of html.replace(NITTER_VIDEO, " ").matchAll(IMG)) {
    const src = urlOf(m[1]!, base);
    if (src) out.push({ kind: "image", url: src });
  }
  return out.slice(0, MAX_TWEET_MEDIA);
}

/**
 * The status a mirror link points at, with the account that owns it: "…/<handle>/status/<id>#m".
 * The one slash between handle and status belongs to both, so both are read in one match.
 */
function statusLinkOf(html: string): { handle: string; id: string } | null {
  const m = /\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/.exec(html);
  return m ? { handle: m[1]!, id: m[2]! } : null;
}

/**
 * The quoted post a mirror appends to an entry: a blockquote under an <hr> whose <b> names its
 * author, whose images are its media, and whose footer carries the status it quotes. Mirrors that
 * predate the blockquote wrote the whole quote inside one: the <hr> there separates the quote from
 * its attribution, so the text stops there while the status link is searched in the whole part.
 */
function quotedOf(html: string, base: string): XPostData["quoted"] {
  const quote = /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/i.exec(html);
  const at = html.search(/<hr\s*\/?>/i);
  const part = quote?.[1] ?? (at >= 0 ? html.slice(at) : "");
  if (!part.trim()) return null;
  const status = statusLinkOf(part) ?? statusLinkOf(html);
  if (!status) return null;
  const url = `https://x.com/${status.handle}/status/${status.id}`;
  const named = /<b\b[^>]*>([\s\S]*?)<\/b>/i.exec(part);
  const namedText = named ? collapseWhitespace(stripTags(named[1]!)).replace(/\s*\(@[A-Za-z0-9_]+\)\s*$/, "").trim() : "";
  const cut = Math.min(...[part.search(/<hr\s*\/?>/i), part.search(/<footer\b/i)].filter((i) => i >= 0));
  const body = (cut >= 0 ? part.slice(0, cut) : part)
    .replace(/<b\b[^>]*>[\s\S]*?<\/b>/gi, " ")
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ");
  return {
    authorName: namedText || status.handle,
    handle: status.handle,
    text: tweetPlainText(body),
    url,
    avatarUrl: null,
    media: mediaOf(body, base, url),
  };
}

/** The main post's HTML: a mirror appends a quote after an <hr> or in a <blockquote>. */
function tweetBodyOf(bodyRaw: string): string {
  const cut = Math.min(...[bodyRaw.search(/<hr\s*\/?>/i), bodyRaw.search(/<blockquote\b/i)].filter((i) => i >= 0));
  return cut > 0 ? bodyRaw.slice(0, cut) : bodyRaw;
}

/**
 * The X post behind a mirror entry: its author (the feed owner's, free with the feed, when it is the
 * owner's own post; a handle alone when it is someone else's retweet), the tweet's text with its
 * line breaks, the quoted post, and the media. A name or avatar that is not in the feed stays null
 * here and is filled from x_profiles at read time (the read path may not call out).
 */
function xPostOf(owner: XFeedOwner | null, creator: string, rawTitle: string, bodyRaw: string, link: string, tweetId: string): XPostData {
  const retweetedBy = RETWEET_PREFIX.exec(rawTitle);
  const replyTo = REPLY_PREFIX.exec(rawTitle);
  const handle = handleOf(creator) ?? owner?.handle ?? "";
  const own = !!owner && handle === owner.handle;
  const url = `https://x.com/${handle}/status/${tweetId}`;
  const body = tweetBodyOf(bodyRaw);
  return {
    tweetId,
    authorName: own ? owner!.authorName ?? handle : handle,
    handle,
    avatarUrl: own ? owner!.avatarUrl : null,
    text: tweetPlainText(body),
    retweetedBy: retweetedBy
      ? { handle: retweetedBy[1]!, authorName: owner && retweetedBy[1] === owner.handle ? owner.authorName : null }
      : null,
    quoted: quotedOf(bodyRaw, link),
    media: mediaOf(body, link, url),
    replyTo: replyTo?.[1] ?? null,
  };
}

/**
 * The body and excerpt of a feed entry: its text when it is the article, else no body (a summary, or
 * a teaser that stands in as the excerpt when the entry has none). A tweet is the whole text however
 * short, and no later fetch can bring more of it (x.com serves no page to a reader), so the length
 * rule that keeps a news summary a summary does not apply.
 */
function feedText(bodyHtml: string | null, summaryHtml: string, source: SourceRow, tweet = false): Pick<Candidate, "excerpt" | "bodyHtml" | "bodyText" | "bodyStatus"> {
  const bodyText = bodyHtml ? stripTags(bodyHtml) : null;
  const teaser = !tweet && !!bodyText && source.participation_mode === "editorial" && isTeaser(bodyText);
  const excerpt = summaryHtml ? collapseWhitespace(stripTags(summaryHtml)).slice(0, 2000) : teaser ? collapseWhitespace(bodyText!) : null;
  return bodyText && (tweet || (bodyText.length > 280 && !teaser))
    ? { excerpt, bodyHtml, bodyText, bodyStatus: "ok" }
    : { excerpt, bodyHtml: null, bodyText: null, bodyStatus: "pending" };
}

interface RssValidator {
  configHash: string;
  responseUrl: string;
  etag: string | null;
  lastModified: string | null;
}

export interface RssRead {
  candidates: Candidate[];
  validator: RssValidator;
  notModified: boolean;
  /** The feed owner for an X mirror: name and avatar come free with every fetch (null otherwise). */
  owner?: XFeedOwner | null;
}

export async function fetchRss(source: SourceRow, opts: { force?: boolean } = {}): Promise<RssRead> {
  const url = String(source.config.feedUrl ?? "");
  if (!url) throw new FetchError("feedUrl missing");
  // Config changes can alter parsing/filtering even when the upstream bytes did not change.
  const configHash = sha256(stableJson(source.config));
  const previous = !opts.force && source.cursor?.rss?.configHash === configHash ? source.cursor.rss as RssValidator : null;
  const headers: Record<string, string> = { accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8" };
  if (previous?.etag) headers["if-none-match"] = previous.etag;
  if (previous?.lastModified) headers["if-modified-since"] = previous.lastModified;
  let res = await guardedFetch(url, { headers, timeoutMs: 25_000 });
  // A redirect may have changed destinations, whose ETag namespace is unrelated to the old one.
  if (res.status === 304 && previous && res.url !== previous.responseUrl) {
    res = await guardedFetch(url, { headers: { accept: headers.accept! }, timeoutMs: 25_000 });
  }
  const validator: RssValidator = {
    configHash, responseUrl: res.url,
    etag: res.headers.get("etag") ?? (res.status === 304 ? previous?.etag ?? null : null),
    lastModified: res.headers.get("last-modified") ?? (res.status === 304 ? previous?.lastModified ?? null : null),
  };
  if (res.status === 304 && previous && (previous.etag || previous.lastModified) && res.url === previous.responseUrl) {
    return { candidates: [], validator, notModified: true, owner: null };
  }
  if (res.status !== 200) throw new FetchError(`HTTP ${res.status}`, res.status);
  let doc: Record<string, any>;
  try {
    doc = parser.parse(res.text());
  } catch (e) {
    throw new FetchError(`feed parse error: ${String(e).slice(0, 200)}`);
  }
  const summaryIsBody = source.config.summaryIsBody === true;
  const xMirror = isXMirror(source);
  const out: Candidate[] = [];

  const channel = doc.rss?.channel ?? doc["rdf:RDF"];
  if (channel) {
    const items = arr(doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item);
    // A mirror's channel states the feed's owner: "name / @handle" in its title, the avatar in its
    // image. The owner's own posts then carry name and avatar without any lookup.
    const owner = xMirror ? xOwnerOf(text(channel.title), text(channel.image?.url)) : null;
    for (const it of items) {
      const link = text(it.link) || text(it.guid);
      const rawTitle = text(it.title);
      const title = collapseWhitespace(stripTags(rawTitle.replace(RETWEET_PREFIX, "").replace(REPLY_PREFIX, "")));
      if (!link || !title) continue;
      const contentEncoded = xMirror ? rewritePipedLinks(text(it["content:encoded"])) : text(it["content:encoded"]);
      const description = text(it.description).replace(RETWEET_PREFIX, "").replace(REPLY_PREFIX, "");
      const descriptionHtml = xMirror ? rewritePipedLinks(description) : description;
      const bodyHtmlRaw = contentEncoded || (summaryIsBody ? descriptionHtml : "");
      // The body's links are relative to the mirror or absolute on it: before the cleaner turns
      // relative ones into item links, mirror pages become the x.com pages they are mirrors of.
      const mirror = xMirror ? mirrorHost(link) : null;
      const bodyHtml = bodyHtmlRaw ? sanitizeBody(mirror ? mirrorBody(bodyHtmlRaw, mirror) : bodyHtmlRaw, link) : null;
      const enclosure = arr(it.enclosure as Record<string, string> | Array<Record<string, string>>).find((e) => /^image\//.test(e?.["@type"] ?? ""));
      const media = [
        ...(enclosure ? [{ kind: "image" as const, url: enclosure["@url"]! }] : []),
        ...(bodyHtmlRaw ? imagesFrom(bodyHtmlRaw, link) : []),
      ];
      const tweetId = xMirror ? tweetIdOf(link) : null;
      out.push({
        url: link,
        title,
        author: text(it["dc:creator"]) || text(it.author) || null,
        publishedAt: parseDate(text(it.pubDate) || text(it["dc:date"]) || text(it.published)),
        ...feedText(bodyHtml, descriptionHtml, source, xMirror),
        media: media.slice(0, 6),
        categories: arr(it.category).map((c) => text(c)).filter(Boolean),
        raw: { guid: text(it.guid) || null },
        ...(tweetId ? { xPost: xPostOf(owner, text(it["dc:creator"]) || text(it.author), rawTitle, bodyHtmlRaw, link, tweetId) } : {}),
      });
    }
    return { candidates: out, validator, notModified: false, owner };
  }

  const feed = doc.feed;
  if (feed) {
    // XML Base is inherited; redirects determine the document's base, not the configured URL.
    const feedBase = new URL(feed["@xml:base"] ?? "", res.url).toString();
    for (const e of arr(feed.entry)) {
      const entryBase = new URL(e["@xml:base"] ?? "", feedBase).toString();
      const entryUrl = atomLink(e.link, entryBase);
      const title = collapseWhitespace(stripTags(text(e.title)));
      if (!entryUrl || !title) continue;
      const content = text(e.content);
      const summary = text(e.summary);
      const bodyHtml = content ? sanitizeBody(content, entryUrl) : null;
      out.push({
        url: entryUrl,
        title,
        author: text(arr(e.author)[0]?.name) || null,
        publishedAt: parseDate(text(e.published) || text(e.updated)),
        sourceUpdatedAt: parseDate(text(e.updated)),
        ...feedText(bodyHtml, summary, source),
        media: content ? imagesFrom(content, entryUrl) : [],
        categories: arr(e.category).map((c: any) => c?.["@term"] ?? text(c)).filter(Boolean),
        raw: { id: text(e.id) || null },
      });
    }
    return { candidates: out, validator, notModified: false, owner: null };
  }
  throw new FetchError("not an RSS/Atom document");
}
