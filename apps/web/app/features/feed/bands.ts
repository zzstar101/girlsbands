import { ENTITIES, seriesKeyOf } from "@girlsbands/industry/taxonomy";

/**
 * Bands, projects and their fan aliases, read from the industry pack so adding a band is a config
 * change and never a code change. A card can only name a band when the classifier put the entity on
 * the item, so a miss is normal and callers must render nothing rather than guess.
 */
export interface Subject {
  /** The `ENTITIES` id — also the topic slug, so a band page is `/topics/<id>`. */
  id: string;
  /** The name readers see. */
  label: string;
  /** Lowercased, punctuation-free forms that match a tag or a free-text mention. */
  keys: string[];
  /** The band's own accent colour from the industry pack; null keeps the site accent. */
  accent: string | null;
  /** `band` is a real group; `project` is a whole series, a single work or a game (BanG Dream!, Our Notes). */
  kind: "band" | "project";
}

function fold(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s!！・･]/g, "");
}

function keysOf(id: string): string[] {
  const e = ENTITIES[id]!;
  return [...new Set([id, e.name, e.displayTag ?? "", ...e.aliases, ...(e.otherNames ?? [])].filter(Boolean).map(fold))];
}

const BY_ID: ReadonlyMap<string, Subject> = new Map(
  Object.keys(ENTITIES).map((id) => {
    const e = ENTITIES[id]!;
    return [id, { id, label: e.displayTag ?? e.name, keys: keysOf(id), accent: e.accent ?? null, kind: e.kind }];
  }),
);

const BY_KEY: ReadonlyMap<string, Subject> = new Map([...BY_ID.values()].flatMap((s) => s.keys.map((k) => [k, s] as const)));

/** The subject a stored `entity:<id>` marker or an entity id names. */
export function subjectOfId(id: string): Subject | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The project a band belongs to, when it belongs to one: a band page then leads back to the project
 * page that already carries it. A project's own page has no parent, and neither has a lone band.
 */
export function parentOf(id: string): Subject | null {
  const key = seriesKeyOf(id);
  return key && key !== id ? subjectOfId(key) : null;
}

/** The subject a public tag names, when the tag is a band or project name rather than a topic tag. */
export function subjectOfTag(tag: string): Subject | null {
  return BY_KEY.get(fold(tag)) ?? null;
}

/** The band and project labels among a public tag list, in tag order and without duplicates. */
export function subjectsOfTags(tags: readonly string[] | null | undefined): Subject[] {
  if (!tags?.length) return [];
  const found: Subject[] = [];
  for (const tag of tags) {
    const subject = subjectOfTag(tag);
    if (subject && !found.includes(subject)) found.push(subject);
  }
  return found;
}

/**
 * The bands an item belongs to: the entity ids the classifier filed it under come first, then any band
 * named by a tag. Items classified before the entity field existed still resolve through their tags.
 */
export function subjectsOfItem(item: { subjects?: readonly string[] | null; tags: readonly string[] }): Subject[] {
  const filed: Subject[] = [];
  for (const id of item.subjects ?? []) {
    const subject = subjectOfId(id);
    if (subject && !filed.includes(subject)) filed.push(subject);
  }
  return [...filed, ...subjectsOfTags(item.tags).filter((s) => !filed.includes(s))];
}

/** Every real band (not projects), in pack order — for picks like the home headline's 「大家好，我们是 ×××」. */
export function allBands(): Subject[] {
  return [...BY_ID.values()].filter((s) => s.kind === "band");
}
