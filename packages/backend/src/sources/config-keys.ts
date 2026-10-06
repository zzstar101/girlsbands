// The config keys each kind of source implements. Anything else is refused: a key a collector does not
// know would otherwise fall back silently to the generic parse (menus and sentence fragments as
// articles, dates never found).
import { TIMEZONES } from "@girlsbands/contracts/site";
import type { SourceRow } from "./types.ts";

// Rules applied in collect.ts to every kind read through collectSource.
const PUBLISHER = ["publisherRole", "publisherUrlPrefixes"];
const COLLECTED = [...PUBLISHER, "_girlsbands", "allowUrlPrefixes", "denyUrlPrefixes", "ingestNoiseFilter", "itemUrlPrefixRewrite", "sortByPublishedAt", "timezone", "detail", "fetchPublicContent"];

const KEYS: Record<SourceRow["kind"], string[]> = {
  rss: [...COLLECTED, "feedUrl", "summaryIsBody", "preserveUrlFragment", "allowCategories", "denyCategories"],
  web_list: [
    ...COLLECTED, "urls", "url", "baseUrl", "parseMode", "adapter", "cacheToleranceSeconds", "linksStartLine", "preserveUrlFragment",
    "itemSelector", "linkSelector", "titleSelector", "summarySelector", "summaryIsBody", "publishedAtSelector", "publishedAtRegex", "publishedAtUtcOffset",
  ],
  json_list: [
    ...COLLECTED, "urls", "url", "mode", "method", "headers", "bodyJson", "jsonKey", "windowVar", "itemsPath", "itemsObjectValues",
    "titlePaths", "summaryPaths", "summaryTemplate", "summaryIsBody", "authorPaths", "publishedAtPath", "publishedAtUnit",
    "publishedAtUtcOffset", "externalIdPath", "urlTemplate", "urlTemplateFallback", "rawDropKeys", "requireBoolean", "minNumeric",
    "imageField", "imagePrefix", "detailAdapter", "detailUrlTemplate",
  ],
  // X accounts are mostly read in shards, which apply only these.
  x_search: [...PUBLISHER, "_girlsbands", "ingestNoiseFilter", "itemUrlPrefixRewrite", "query", "searchType"],
  mp_account: [...PUBLISHER, "wxid", "ghid", "nickname"],
  external: [...PUBLISHER],
};

// Objects with fixed keys (headers and bodyJson are request data, free-form).
const NESTED: Record<string, string[]> = {
  // fanPlatform marks a source that is itself a fan platform (publication/rules.ts reads it to tag the
  // organizer of a 同人 Only event); it sits in the source's own config, next to the backfill flags.
  _girlsbands: ["initialBackfillLimit", "initialBackfillMonths", "fanPlatform"],
  ingestNoiseFilter: ["dropMarkers", "dropMarkersTitleOnly", "keepIfMatches"],
  itemUrlPrefixRewrite: ["from", "to"],
  requireBoolean: ["path", "equals"],
  minNumeric: ["path", "min"],
  detail: [
    "maxFetches", "publishedAtSelector", "publishedAtRegex", "publishedAtUtcOffset", "publishedAtAuthoritative", "upgradeDatePrecision",
    "titleSelector", "titleRegex", "titleAuthoritative", "summarySelector",
  ],
};

const VALUES: Record<string, string[]> = {
  publisherRole: ["organization", "person"],
  adapter: ["mimo_home"],
  parseMode: ["html", "markdown", "docusaurus_changelog"],
  // The clock this source's stated times are on; anything else is a typo, not a third timezone.
  timezone: [...TIMEZONES],
  detailAdapter: ["bilibili-show", "allcpp-event"],
};

/** The config entries a source of this kind would ignore or cannot run, e.g. ["adapter=site_cards", "detail.titleFoo"]. */
export function unsupportedConfig(kind: SourceRow["kind"], config: Record<string, unknown>): string[] {
  const allowed = new Set(KEYS[kind] ?? []);
  const out: string[] = [];
  for (const [key, value] of Object.entries(config ?? {})) {
    if (!allowed.has(key)) out.push(key);
    else if (key === "publisherUrlPrefixes" && (!Array.isArray(value) || !value.every((v) => {
      if (typeof v !== "string") return false;
      try { const u = new URL(v); return /^https?:$/.test(u.protocol) && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
    }))) out.push(key);
    // One listing URL per search a source fans out over (tags, keywords): the query is the search.
    else if (key === "urls" && (!Array.isArray(value) || value.length === 0 || !value.every((v) => {
      if (typeof v !== "string") return false;
      try { const u = new URL(v); return /^https?:$/.test(u.protocol) && !u.username && !u.password; } catch { return false; }
    }))) out.push(key);
    else if (VALUES[key] && !VALUES[key]!.includes(String(value))) out.push(`${key}=${String(value)}`);
    else if (NESTED[key] && value && typeof value === "object") {
      for (const sub of Object.keys(value)) if (!NESTED[key]!.includes(sub)) out.push(`${key}.${sub}`);
    }
  }
  return out;
}

export class UnsupportedConfig extends Error {
  readonly statusCode = 400;
}

/** Refuses a config with entries its kind does not implement (admin create, edit and preview). */
export function assertSupportedConfig(kind: SourceRow["kind"], config: Record<string, unknown>): void {
  const bad = unsupportedConfig(kind, config);
  if (bad.length) throw new UnsupportedConfig(`不支持的配置项：${bad.join("、")}`);
}
