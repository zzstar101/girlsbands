// The deadline radar: the dated events a report's own text states, read back out of the structure step
// (`analyses.output.fact.deadlines`, written by editorial/analyze.ts). Nothing new is inferred here — an
// entry only exists when the original wording it quotes was found verbatim in that report.
//
// `at` is Japan wall-clock, the date the announcement itself gives, so the window, the day buckets and
// the 48-hour flag are all computed in JST rather than in the Beijing calendar the rest of the site uses.
// A deadline that closes at 23:59 JST is a thing the reader must act on that day, and converting it to
// another calendar would move it to the day before.
//
// Scope: the listed set (public, pool eligible, released) rather than the selected set. A lottery closing
// is something the reader cannot miss even when the announcement that carried it was not worth pushing as
// news; the reports that did clear the bar carry `selected` and sort first within their day.
import type { DeadlineKind, DeadlinesResponse, DeadlineView } from "@girlsbands/contracts/site";
import { sql } from "../db.ts";
import { entityIds, entityTags, publicSourceName, hasItemPage } from "./rules.ts";
import { listedCondition } from "./scope.ts";

const JST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 86_400_000;
const SOON_MS = 2 * DAY_MS;
/** The most rows one window reads; the calendar's year and the radar's month both fit inside it. */
const MAX_LIMIT = 2_000;
const KINDS: ReadonlySet<string> = new Set<DeadlineKind>([
  "lottery_start", "lottery_end", "sale_start", "event", "stream_end", "result", "release_start", "merch_start", "other",
]);

/** `YYYY-MM-DD` of the instant on the Japan calendar. */
export function jstDate(instant: Date): string {
  return new Date(instant.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** A JST day shifted by whole days — month arithmetic for the calendar and the export. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The JST instant a stored `at` falls on: a bare day is midnight, a day with a time is that minute. */
function jstInstant(at: string): number {
  return Date.parse(`${at.length === 10 ? `${at}T00:00` : at}:00+09:00`);
}

interface Row {
  item_id: string;
  title: string;
  url: string;
  category: string | null;
  tags: string[];
  selected: boolean;
  published_at: Date | null;
  source_name: string;
  source_mode: string;
  kind: string | null;
  at: string | null;
  note: string | null;
}

/**
 * The dated rows inside a JST window, bucketed by day, oldest first. `at` sorts as text because the
 * stored format is zero-padded ISO — `2026-10-04` < `2026-10-04T10:00` < `2026-10-05`. `storyId`
 * narrows it to one event's own reports; `subject` to one entity and everything in its series.
 */
async function deadlineWindow(
  now: Date,
  opts: { from: string; to: string; limit: number; storyId?: number; subject?: string; itemIds?: string[] },
): Promise<{ days: Array<{ date: string; items: DeadlineView[] }>; total: number }> {
  if (opts.itemIds?.length === 0) return { days: [], total: 0 };
  const itemFilter = opts.itemIds ? sql`AND p.article_id IN ${sql(opts.itemIds)}` : sql``;
  const storyFilter = opts.storyId === undefined ? sql`` : sql`AND p.story_id = ${opts.storyId}`;
  const subjectFilter = opts.subject === undefined ? sql`` : sql`AND p.tags && ${entityTags(opts.subject)}::text[]`;
  const rows = await sql<Row[]>`
    SELECT p.article_id AS item_id, p.title, p.url, p.category, p.tags, p.selected, p.published_at,
           s.name AS source_name, s.participation_mode AS source_mode,
           d.value->>'kind' AS kind, d.value->>'at' AS at, d.value->>'note' AS note
    FROM publications p
    JOIN sources s ON s.id = p.source_id
    JOIN analyses an ON an.id = p.analysis_id
    CROSS JOIN LATERAL jsonb_array_elements(an.output->'fact'->'deadlines') AS d(value)
    WHERE ${listedCondition(now)}
      AND jsonb_typeof(an.output->'fact'->'deadlines') = 'array'
      ${itemFilter}
      ${storyFilter}
      ${subjectFilter}
      AND d.value->>'at' >= ${opts.from} AND d.value->>'at' < ${addDays(opts.to, 1)}
    ORDER BY d.value->>'at', p.selected DESC, p.article_id
    LIMIT ${opts.limit}`;

  const days = new Map<string, DeadlineView[]>();
  let total = 0;
  for (const r of rows) {
    if (!hasItemPage({ visibility: "public", sourceMode: r.source_mode })) continue;
    const at = r.at;
    // A malformed or time-less row never reaches a reader: the extraction only emits both, and this
    // is the last gate before the page prints a date someone might plan around.
    if (!at || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(at)) continue;
    const day = at.slice(0, 10);
    const view: DeadlineView = {
      at,
      day,
      kind: KINDS.has(r.kind ?? "") ? (r.kind as DeadlineKind) : "other",
      note: r.note?.trim() || null,
      itemId: r.item_id,
      title: r.title,
      url: r.url,
      category: (r.category as DeadlineView["category"]) ?? null,
      subjects: entityIds(r.tags ?? []),
      source: { name: publicSourceName(r.source_name) },
      publishedAt: r.published_at ? r.published_at.toISOString() : null,
      selected: r.selected,
      soon: jstInstant(at) - now.getTime() <= SOON_MS,
    };
    total += 1;
    const bucket = days.get(day);
    if (bucket) bucket.push(view);
    else days.set(day, [view]);
  }
  return { days: [...days.entries()].map(([date, items]) => ({ date, items })), total };
}

/**
 * Everything due in the next `horizonDays` JST days, bucketed by day, oldest first. `storyId` narrows
 * it to one event's own reports, which is what its page shows; `subject` to one band or project (and
 * its series), which is what its calendar shows.
 */
export async function upcomingDeadlines(
  now = new Date(),
  opts: { horizonDays?: number; limit?: number; storyId?: number; subject?: string } = {},
): Promise<DeadlinesResponse> {
  const horizonDays = Math.min(Math.max(Math.trunc(opts.horizonDays ?? 30), 1), 730);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 400), 1), MAX_LIMIT);
  const from = jstDate(now);
  const to = addDays(from, horizonDays);
  const { days, total } = await deadlineWindow(now, { from, to, limit, storyId: opts.storyId, subject: opts.subject });
  return { computedAt: now.toISOString(), from, to, days, total };
}

/**
 * The dates of one window as a flat, oldest-first list — a calendar month, or the year the .ics export
 * covers. Same rows as the radar, so the two can never disagree about a date.
 */
export async function deadlineRange(
  now: Date,
  opts: { from: string; to: string; limit?: number; subject?: string; itemIds?: string[] },
): Promise<DeadlineView[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? MAX_LIMIT), 1), MAX_LIMIT);
  const { days } = await deadlineWindow(now, { from: opts.from, to: opts.to, limit, subject: opts.subject, itemIds: opts.itemIds });
  return days.flatMap((d) => d.items);
}

/** The JST months that have a date in the window, oldest first — the calendar's month strip. */
export async function deadlineMonths(now: Date, opts: { from: string; to: string; subject?: string }): Promise<string[]> {
  const subjectFilter = opts.subject === undefined ? sql`` : sql`AND p.tags && ${entityTags(opts.subject)}::text[]`;
  const rows = await sql<{ month: string }[]>`
    SELECT DISTINCT substring(d.value->>'at' FROM 1 FOR 7) AS month
    FROM publications p
    JOIN analyses an ON an.id = p.analysis_id
    CROSS JOIN LATERAL jsonb_array_elements(an.output->'fact'->'deadlines') AS d(value)
    WHERE ${listedCondition(now)}
      AND jsonb_typeof(an.output->'fact'->'deadlines') = 'array'
      ${subjectFilter}
      AND d.value->>'at' ~ '^\\d{4}-\\d{2}'
      AND d.value->>'at' >= ${opts.from} AND d.value->>'at' < ${addDays(opts.to, 1)}
    ORDER BY month`;
  return rows.map((r) => r.month);
}
