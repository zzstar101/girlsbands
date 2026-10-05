// Publication rules. Each rule is defined once here and used by every exit.

import { seriesOf } from "@girlsbands/industry/taxonomy";

export interface SourceFacts {
  id: string;
  name: string;
  kind: string;
  tier: string;
  participation_mode: string;
  first_party: boolean;
  site_fulltext: boolean;
  syndicate_fulltext: boolean;
  rights_tier: string;
}

/**
 * Rights tiers (W17). The label records how a source's content may be shown, so the admin can answer a
 * rights holder and the site can tighten by layer (database/migrations/0066_rights_tiers.sql). Since the
 * switch (2026-10-06) it is an input: bodyModeOf below forces a third party's report down to a summary
 * and lets official, licensed and event-data material keep the licence flag's answer.
 */
export const RIGHTS_TIERS = ["official", "media", "licensed", "event_data"] as const;

export type RightsTier = (typeof RIGHTS_TIERS)[number];

/**
 * The tier a source is labelled with: official own channels (T1, and their T1_5 mirrors — a member's own
 * account is as first-hand as the band's), event pages' facts, and everything else media. The judge is
 * the owner entity, not the tier alone (station owner, 2026-10-05): a T2 feed of official material is
 * still a third party, one of our own feeds with an owner is not.
 */
export function rightsTierOf(source: { tier: string; ownerEntityId: string | null }): RightsTier {
  if (source.tier === "T2_EVENT") return "event_data";
  if ((source.tier === "T1" || source.tier === "T1_5") && source.ownerEntityId) return "official";
  return "media";
}

export function channelOf(sourceKind: string, hasXPost: boolean): "x" | "news" {
  return sourceKind === "x_search" || hasXPost ? "x" : "news";
}

/** Public pool (/all): editorial sources, AI relevant, with a Chinese title and summary. */
export function isPoolEligible(input: {
  participationMode: string;
  relevance: string | null;
  title: string | null;
  summary: string | null;
}): boolean {
  return input.participationMode === "editorial" && input.relevance === "pass" && !!input.title && !!input.summary;
}

/**
 * Item detail page (and its Markdown export): every unwithdrawn item from an editorial source has one,
 * with or without a Chinese summary (noindex unless indexable). hot_signal material is heat evidence
 * only and has none. A paused source keeps its pages.
 */
export function hasItemPage(p: { visibility: string; sourceMode: string }): boolean {
  return p.visibility !== "withdrawn" && p.sourceMode === "editorial";
}

/** Selected: pool eligible, judged selected, and the source tier may enter the selection. */
export function isSelectable(eligible: boolean, judgedSelected: boolean | null, tier: string): boolean {
  return eligible && judgedSelected === true && tier !== "EXCLUDE_MP";
}

/**
 * Site full text: the source licence allows showing it and we have confirmed body text.
 * WeChat and paywalled content never get it just because it was fetchable (source flag false).
 *
 * A third party's report is a summary, always: `media` (a source with no owner entity — someone else's
 * article, even when we can fetch the whole body) never reaches full text. Everything else keeps the
 * licence flag's answer, which is how event data (a ticket page's dates, no article) and official
 * channels stay as they are (station owner, 2026-10-06).
 *
 * Changing this changes what is already stored: publications.body_mode is a column, so a switch needs a
 * republish backfill and not just an UPDATE (0056 knew that; admin/sources.ts keeps rights_tier in
 * PUBLICATION_FIELDS for it).
 */
export function bodyModeOf(source: SourceFacts, bodyStatus: string, hasBody: boolean): "full" | "summary" {
  if (source.rights_tier === "media") return "summary";
  return source.site_fulltext && bodyStatus === "ok" && hasBody ? "full" : "summary";
}

/** Full-RSS redistribution whitelist: only sources that explicitly allow it. */
export function mayRedistribute(source: SourceFacts, bodyMode: "full" | "summary"): boolean {
  return source.syndicate_fulltext && bodyMode === "full";
}

/**
 * Detail pages are noindex by default. Selected items are indexed automatically; an editor
 * can mark any other public page for indexing, or exclude a page, which then stays out.
 */
export function isIndexable(p: { visibility: string; hasSummary: boolean; selected: boolean; seoIndexedAt: Date | null; seoExcludedAt: Date | null }): boolean {
  return p.visibility === "public" && p.hasSummary && p.seoExcludedAt === null && (p.selected || p.seoIndexedAt !== null);
}

/** Display tags exclude internal entity markers; `entityIds` recovers them for the reader-facing entity field. */
export function displayTags(tags: string[]): string[] {
  return tags.filter((t) => !t.startsWith("entity:"));
}

/** The entity ids a stored tag list was filed under, in order and without duplicates. */
export function entityIds(tags: string[]): string[] {
  return [...new Set(tags.filter((t) => t.startsWith("entity:")).map((t) => t.slice("entity:".length)).filter(Boolean))];
}

/**
 * The tags that put a report under one entity: the entity itself plus everything in its series, so a
 * project's page, calendar and feed carry its bands' news as well as its own (industry/taxonomy.ts SERIES).
 * `entityIds` reads them back out, which is why a project's report shows the band it is about too.
 */
export function entityTags(entityId: string): string[] {
  const ids = seriesOf(entityId);
  return (ids.length > 0 ? ids : [entityId]).map((id) => `entity:${id}`);
}

/**
 * The source name readers see. Admin names carry notes for editors in full-width brackets: the channel,
 * what a feed keeps, a person's role or why the account is followed (「OpenAI：官网动态（RSS · 排除企业/客户案例）」,
 * 「某媒体（热点 RSS）」, 「X：Clément Delangue（Hugging Face CEO） (@ClementDelangue)」). Readers get the name
 * without them, and an X account its display name (its handle when the name is only a note). Every
 * exit people read uses this, and search matches it; JSON fields keep the stored name, which programs
 * may match.
 */
export function publicSourceName(name: string): string {
  let bare = name;
  while (/（[^（）]*）/.test(bare)) bare = bare.replace(/（[^（）]*）/g, " ");
  const x = /^X[:：]\s*(.*?)\s*(?:\(@[^)]*\))?\s*$/.exec(bare);
  return (x ? x[1]! : bare).replace(/\s+/g, " ").trim() || /@\w+/.exec(name)?.[0] || name.trim();
}
