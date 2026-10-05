// The deadline radar: the dated events a report's own text states, read back out of the structure step
// (`analyses.output.fact.deadlines`, written by editorial/analyze.ts). Nothing new is inferred here — an
// entry only exists when the original wording it quotes was found verbatim in that report.
//
// `at` is the wall clock the announcement itself gives, and `timezone` says which clock that is: a
// Japanese source states Japan time, a mainland one Beijing time (sources/timezone.ts). The day buckets
// are the announcement's own calendar rather than the Beijing one the rest of the site uses, because a
// deadline that closes at 23:59 local is a thing the reader must act on that day, and converting it to
// another calendar would move it to the day before.
//
// Scope: the listed set (public, pool eligible, released) rather than the selected set. A lottery closing
// is something the reader cannot miss even when the announcement that carried it was not worth pushing as
// news; the reports that did clear the bar carry `selected` and sort first within their day.
import type { DeadlineKind, DeadlinesResponse, DeadlineView } from "@girlsbands/contracts/site";
import { DEADLINE_KINDS, TICKET_ROUND_KINDS, type TicketRoundKind } from "@girlsbands/contracts/site";
import { sql } from "../db.ts";
import { deadlineInstant, isTimezone, splitDeadlineAt, timezoneOf } from "../sources/timezone.ts";
import { entityIds, entityTags, publicSourceName, hasItemPage } from "./rules.ts";
import { listedCondition } from "./scope.ts";
import { roundNote, roundSlotKind, type RoundSlot } from "./tickets.ts";

const JST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 86_400_000;
const SOON_MS = 2 * DAY_MS;
/** The most rows one window reads; the calendar's year and the radar's month both fit inside it. */
const MAX_LIMIT = 2_000;
const KINDS: ReadonlySet<string> = new Set<string>(DEADLINE_KINDS);
const ROUND_KINDS: ReadonlySet<string> = new Set<string>(TICKET_ROUND_KINDS);
const SLOTS: ReadonlySet<string> = new Set<string>(["applyStart", "applyEnd", "resultOn", "paymentDueOn"]);

/** `YYYY-MM-DD` of the instant on the Japan calendar. */
export function jstDate(instant: Date): string {
  return new Date(instant.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** A JST day shifted by whole days — month arithmetic for the calendar and the export. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
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
  source_config: Record<string, unknown> | null;
  kind: string | null;
  at: string | null;
  note: string | null;
  /** 轮次那一支的列（公告那一支全是 null）：哪一种受理、是四个日期槽位里的哪一个。 */
  round_kind: string | null;
  round_slot: string | null;
  round_timezone: string | null;
  platform: string | null;
}

/**
 * The dated rows inside a JST window, bucketed by day, oldest first. `at` sorts as text because the
 * stored format is zero-padded ISO — `2026-10-04` < `2026-10-04T10:00` < `2026-10-05`. `storyId`
 * narrows it to one event's own reports; `subject` to one entity and everything in its series.
 *
 * Two sources of dates, unioned: what each report's own text states, and the ticket rounds of the
 * shows it is about (ticket_rounds, written by lives/tickets.ts). A show that has rounds keeps its
 * ticket dates from there and its report's own ticket-ish entries are dropped, so the same closing
 * day cannot appear twice.
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
    WITH dated AS (
      SELECT p.article_id AS item_id, p.title, p.url, p.category, p.tags, p.selected, p.published_at,
             s.name AS source_name, s.participation_mode AS source_mode, s.config AS source_config,
             d.value->>'kind' AS kind, d.value->>'at' AS at, d.value->>'note' AS note,
             NULL::text AS round_kind, NULL::text AS round_slot, NULL::text AS round_timezone, NULL::text AS platform
      FROM publications p
      JOIN sources s ON s.id = p.source_id
      JOIN analyses an ON an.id = p.analysis_id
      LEFT JOIN facts f ON f.id = p.fact_id
      CROSS JOIN LATERAL jsonb_array_elements(an.output->'fact'->'deadlines') AS d(value)
      WHERE ${listedCondition(now)}
        AND jsonb_typeof(an.output->'fact'->'deadlines') = 'array'
        ${itemFilter}
        ${storyFilter}
        ${subjectFilter}
        AND d.value->>'at' >= ${opts.from} AND d.value->>'at' < ${addDays(opts.to, 1)}
        -- 这一天已经由轮次接管时不再重复列出：报告自己写出的票务日期与 ticket_rounds 说的是同一天。
        AND NOT EXISTS (
          SELECT 1 FROM ticket_rounds tr
          WHERE d.value->>'kind' IN ('lottery_start', 'lottery_end', 'sale_start', 'sale_end', 'result', 'payment_deadline')
            AND (tr.live_event_id = f.live_event_id OR tr.first_article_id = p.article_id)
            AND substring(d.value->>'at' FROM 1 FOR 10) IN (
              substring(tr.apply_start_at FROM 1 FOR 10), substring(tr.apply_end_at FROM 1 FOR 10),
              substring(tr.result_on FROM 1 FOR 10), substring(tr.payment_due_on FROM 1 FOR 10)
            )
        )
      UNION ALL
      SELECT p.article_id AS item_id, p.title, p.url, p.category, p.tags, p.selected, p.published_at,
             s.name AS source_name, s.participation_mode AS source_mode, s.config AS source_config,
             NULL::text AS kind, e.slot_at AS at, NULL::text AS note,
             tr.kind AS round_kind, e.slot AS round_slot, tr.timezone AS round_timezone, tr.platform AS platform
      FROM ticket_rounds tr
      JOIN publications p ON p.article_id = tr.first_article_id
      JOIN sources s ON s.id = p.source_id
      CROSS JOIN LATERAL (VALUES
        ('applyStart', tr.apply_start_at), ('applyEnd', tr.apply_end_at),
        ('resultOn', tr.result_on), ('paymentDueOn', tr.payment_due_on)
      ) AS e(slot, slot_at)
      WHERE ${listedCondition(now)}
        ${itemFilter}
        ${storyFilter}
        ${subjectFilter}
        AND e.slot_at IS NOT NULL
        AND e.slot_at >= ${opts.from} AND e.slot_at < ${addDays(opts.to, 1)}
    )
    SELECT * FROM dated ORDER BY at, selected DESC, item_id LIMIT ${opts.limit}`;

  const days = new Map<string, DeadlineView[]>();
  let total = 0;
  for (const r of rows) {
    if (!hasItemPage({ visibility: "public", sourceMode: r.source_mode })) continue;
    const at = r.at;
    // A malformed or time-less row never reaches a reader: the extraction only emits both, and this
    // is the last gate before the page prints a date someone might plan around.
    const split = at === null ? null : splitDeadlineAt(at);
    if (!at || !split) continue;
    const timezone = r.round_timezone !== null && isTimezone(r.round_timezone) ? r.round_timezone : timezoneOf(r.source_config);
    const roundKind = r.round_kind !== null && ROUND_KINDS.has(r.round_kind) ? (r.round_kind as TicketRoundKind) : null;
    const slot = SLOTS.has(r.round_slot ?? "") ? (r.round_slot as RoundSlot) : null;
    const day = split.day;
    const view: DeadlineView = {
      at,
      day,
      localTime: split.localTime,
      timezone,
      kind: roundKind && slot ? roundSlotKind(roundKind, slot) : KINDS.has(r.kind ?? "") ? (r.kind as DeadlineKind) : "other",
      note: roundKind ? roundNote(roundKind, r.platform) : r.note?.trim() || null,
      itemId: r.item_id,
      title: r.title,
      url: r.url,
      category: (r.category as DeadlineView["category"]) ?? null,
      subjects: entityIds(r.tags ?? []),
      source: { name: publicSourceName(r.source_name) },
      publishedAt: r.published_at ? r.published_at.toISOString() : null,
      selected: r.selected,
      soon: deadlineInstant(day, split.localTime, timezone) - now.getTime() <= SOON_MS,
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
    WITH months AS (
      SELECT substring(d.value->>'at' FROM 1 FOR 7) AS month
      FROM publications p
      JOIN analyses an ON an.id = p.analysis_id
      LEFT JOIN facts f ON f.id = p.fact_id
      CROSS JOIN LATERAL jsonb_array_elements(an.output->'fact'->'deadlines') AS d(value)
      WHERE ${listedCondition(now)}
        AND jsonb_typeof(an.output->'fact'->'deadlines') = 'array'
        ${subjectFilter}
        AND d.value->>'at' >= ${opts.from} AND d.value->>'at' < ${addDays(opts.to, 1)}
        -- 这一天已经由轮次接管时不再重复列出：报告自己写出的票务日期与 ticket_rounds 说的是同一天。
        AND NOT EXISTS (
          SELECT 1 FROM ticket_rounds tr
          WHERE d.value->>'kind' IN ('lottery_start', 'lottery_end', 'sale_start', 'sale_end', 'result', 'payment_deadline')
            AND (tr.live_event_id = f.live_event_id OR tr.first_article_id = p.article_id)
            AND substring(d.value->>'at' FROM 1 FOR 10) IN (
              substring(tr.apply_start_at FROM 1 FOR 10), substring(tr.apply_end_at FROM 1 FOR 10),
              substring(tr.result_on FROM 1 FOR 10), substring(tr.payment_due_on FROM 1 FOR 10)
            )
        )
      UNION ALL
      SELECT substring(e.slot_at FROM 1 FOR 7) AS month
      FROM ticket_rounds tr
      JOIN publications p ON p.article_id = tr.first_article_id
      CROSS JOIN LATERAL (VALUES
        (tr.apply_start_at), (tr.apply_end_at), (tr.result_on), (tr.payment_due_on)
      ) AS e(slot_at)
      WHERE ${listedCondition(now)}
        ${subjectFilter}
        AND e.slot_at IS NOT NULL
        AND e.slot_at >= ${opts.from} AND e.slot_at < ${addDays(opts.to, 1)}
    )
    SELECT DISTINCT month FROM months WHERE month ~ '^\\d{4}-\\d{2}' ORDER BY month`;
  return rows.map((r) => r.month);
}
