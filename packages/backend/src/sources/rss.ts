// RSS 2.0 / Atom / RDF feeds.
import { XMLParser } from "fast-xml-parser";
import { guardedFetch } from "../lib/http-fetch.ts";
import { collapseWhitespace, stripTags } from "../lib/text.ts";
import { sanitizeBody } from "../content/sanitize.ts";
import { sha256, stableJson } from "../lib/ids.ts";
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
function mirrorHost(link: string): string | null {
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
  const profile = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(url.pathname);
  return profile ? `https://x.com/${profile[1]}` : href;
}

/** Every link of a tweet's body that points at the mirror, as its x.com address. */
function mirrorBody(html: string, mirror: string): string {
  return html.replace(A_HREF, (_m, head: string, quote: string, href: string) => `${head}${quote}${xLink(href, mirror)}${quote}`);
}

/** A retweet in a Nitter feed: "RT by @handle: " before the quoted post's text. */
const RETWEET_PREFIX = /^RT by @[^\s:]+:\s+/;

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
    return { candidates: [], validator, notModified: true };
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
    for (const it of items) {
      const link = text(it.link) || text(it.guid);
      const title = collapseWhitespace(stripTags(text(it.title).replace(RETWEET_PREFIX, "")));
      if (!link || !title) continue;
      const contentEncoded = text(it["content:encoded"]);
      const description = text(it.description).replace(RETWEET_PREFIX, "");
      const bodyHtmlRaw = contentEncoded || (summaryIsBody ? description : "");
      // The body's links are relative to the mirror or absolute on it: before the cleaner turns
      // relative ones into item links, mirror pages become the x.com pages they are mirrors of.
      const mirror = xMirror ? mirrorHost(link) : null;
      const bodyHtml = bodyHtmlRaw ? sanitizeBody(mirror ? mirrorBody(bodyHtmlRaw, mirror) : bodyHtmlRaw, link) : null;
      const enclosure = arr(it.enclosure as Record<string, string> | Array<Record<string, string>>).find((e) => /^image\//.test(e?.["@type"] ?? ""));
      const media = [
        ...(enclosure ? [{ kind: "image" as const, url: enclosure["@url"]! }] : []),
        ...(bodyHtmlRaw ? imagesFrom(bodyHtmlRaw, link) : []),
      ];
      out.push({
        url: link,
        title,
        author: text(it["dc:creator"]) || text(it.author) || null,
        publishedAt: parseDate(text(it.pubDate) || text(it["dc:date"]) || text(it.published)),
        ...feedText(bodyHtml, description, source, xMirror),
        media: media.slice(0, 6),
        categories: arr(it.category).map((c) => text(c)).filter(Boolean),
        raw: { guid: text(it.guid) || null },
      });
    }
    return { candidates: out, validator, notModified: false };
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
    return { candidates: out, validator, notModified: false };
  }
  throw new FetchError("not an RSS/Atom document");
}
