// Public vocabularies shared by the website, the API and the worker. The categories themselves belong to
// the industry pack (industry/taxonomy.ts); their keys are external identities (URLs, API, RSS).
import { CATEGORIES, CHANNEL_LABELS, ENTITIES } from "@girlsbands/industry/taxonomy";

export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as unknown as readonly [CategoryKey, ...CategoryKey[]];

/** Website tab labels. */
export const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<CategoryKey, string>;

/** The public API, RSS and MCP use the same categories as the website. */
export const PUBLIC_API_CATEGORY_KEYS = CATEGORY_KEYS;
export type PublicApiCategoryKey = CategoryKey;

export function toPublicApiCategory(category: string | null): PublicApiCategoryKey | null {
  return isCategoryKey(category) ? category : null;
}

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && (CATEGORY_KEYS as readonly string[]).includes(value);
}

export const CHANNEL_KEYS = ["all", "news", "x", "firstParty"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

/**
 * Where a report came from. The keys are framework identities (news = collected articles, x = X posts,
 * firstParty = T1 official sources); the wording belongs to the industry pack, exactly like the categories.
 */
export { CHANNEL_LABELS };

export function isChannelKey(value: unknown): value is ChannelKey {
  return typeof value === "string" && (CHANNEL_KEYS as readonly string[]).includes(value);
}

/** Article ids. Also the local-data import validation pattern. */
export const ARTICLE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

/**
 * The subjects a reader can follow: the bands and projects of the industry pack (ENTITIES), which are
 * also the topic pages and the picker on the subscribe page. A direction page is not a subject and has
 * no follow button. One list for the browser's stored follows, the address it sends, and the API.
 */
export const FOLLOWABLE_ENTITY_IDS: readonly string[] = Object.keys(ENTITIES);

export function isFollowableEntity(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(ENTITIES, value);
}

/** One address carries at most this many subjects: it is made for one reader, not for a crawler. */
export const SUBJECT_LIMIT = 30;

/**
 * `?subjects=mygo,bang-dream` — the subjects one reader follows, as read from an address. Unknown ids are
 * dropped rather than rejected (a stored follow list may be older than the site); duplicates collapse, so
 * the address, the API's cache key and the cursor binding all agree on one filter.
 */
export function parseSubjectIds(value: string | null | undefined): string[] {
  const ids = new Set<string>();
  for (const raw of (value ?? "").split(",")) {
    const id = raw.trim();
    if (isFollowableEntity(id)) ids.add(id);
    if (ids.size >= SUBJECT_LIMIT) break;
  }
  return [...ids];
}
