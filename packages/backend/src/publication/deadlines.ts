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
import type { DeadlineKind, DeadlinesResponse, DeadlineView } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { entityIds, publicSourceName } from "./rules.ts";
import { listedCondition } from "./scope.ts";

const JST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 86_400_000;
const SOON_MS = 2 * DAY_MS;
const KINDS: ReadonlySet<string> = new Set<DeadlineKind>([
  "lottery_start", "lottery_end", "sale_start", "event", "stream_end", "result", "other",
]);

/** `YYYY-MM-DD` of the instant on the Japan calendar. */
function jstDate(instant: Date): string {
  return new Date(instant.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
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
  kind: string | null;
  at: string | null;
  note: string | null;
}

/**
 * Everything due in the next `horizonDays` JST days, bucketed by day, oldest first. `at` sorts as text
 * because the stored format is zero-padded ISO — `2026-10-04` < `2026-10-04T10:00` < `2026-10-05`.
 * `storyId` narrows it to one event's own reports, which is what its page shows.
 */
export async function upcomingDeadlines(
  now = new Date(),
  opts: { horizonDays?: number; limit?: number; storyId?: number } = {},
): Promise<DeadlinesResponse> {
  const horizonDays = Math.min(Math.max(Math.trunc(opts.horizonDays ?? 30), 1), 730);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 400), 1), 800);
  const from = jstDate(now);
  const to = addDays(from, horizonDays);
  const storyFilter = opts.storyId === undefined ? sql`` : sql`AND p.story_id = ${opts.storyId}`;
  const rows = await sql<Row[]>`
    SELECT p.article_id AS item_id, p.title, p.url, p.category, p.tags, p.selected, p.published_at,
           s.name AS source_name,
           d.value->>'kind' AS kind, d.value->>'at' AS at, d.value->>'note' AS note
    FROM publications p
    JOIN sources s ON s.id = p.source_id
    JOIN analyses an ON an.id = p.analysis_id
    CROSS JOIN LATERAL jsonb_array_elements(an.output->'fact'->'deadlines') AS d(value)
    WHERE ${listedCondition(now)}
      AND jsonb_typeof(an.output->'fact'->'deadlines') = 'array'
      ${storyFilter}
      AND d.value->>'at' >= ${from} AND d.value->>'at' < ${addDays(to, 1)}
    ORDER BY d.value->>'at', p.selected DESC, p.article_id
    LIMIT ${limit}`;

  const computedAt = now.toISOString();
  const days = new Map<string, DeadlineView[]>();
  let total = 0;
  for (const r of rows) {
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

  return {
    computedAt,
    from,
    to,
    days: [...days.entries()].map(([date, items]) => ({ date, items })),
    total,
  };
}
