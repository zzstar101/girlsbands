// 演出的公开读取。`status` 只记公告自己说的话（取消 / 延期）；读者问的「这场现在到哪一步了」由开演日
// 和报告里的日期读出来，所以它不落库 —— 存下来的阶段过一夜就会过时。
//
// 可见性跟其它公开出口一套：一条报告被下架就不算它的报告，报告全都下架后演出页跟着 404（下架不漏）。
import type { DeadlineKind, DeadlineView, LiveEventSummary, LiveEventView, LiveRef, LiveStage, LiveStatus, StoryReportView, Timezone } from "@girlsbands/contracts/site";
import { addDays, beijingDate, timezoneDate } from "@girlsbands/contracts/time";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { sql } from "../db.ts";
import { deadlineRange } from "./deadlines.ts";
import { storyReportCondition } from "./scope.ts";
import { ROUND_SLOTS, roundSlotKind, roundsOf } from "./tickets.ts";
import { liveReports } from "./report-views.ts";
import { coverOfItems } from "./covers.ts";

/** The dates of a live's own reports, wide enough to hold a lottery that opened long before the show. */
const DATE_WINDOW_DAYS = 400;
const MAX_SUBJECT_LIVES = 40;

/** 这些日期说明票务已经开始过：抽选开始/截止、一般发售。 */
const TICKET_KINDS = new Set<DeadlineKind>(["lottery_start", "lottery_end", "sale_start"]);

interface LiveRow {
  id: number;
  public_id: string;
  title: string;
  subject_entity: string;
  venue: string | null;
  timezone: Timezone;
  starts_on: string;
  ends_on: string | null;
  starts_time: string | null;
  status: LiveStatus;
  story_public_id: string | null;
  story_title: string | null;
  report_count: number;
  item_ids: string[];
}

/** 读者看到的阶段：公告只是它的一个输入，开演日与票务日期说了算。 */
function stageOf(row: Pick<LiveRow, "status" | "starts_on" | "ends_on" | "timezone">, dates: DeadlineView[], now: Date): LiveStage {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "postponed") return "postponed";
  const today = timezoneDate(row.timezone, now);
  if ((row.ends_on ?? row.starts_on) < today) return "finished";
  if (row.starts_on <= today) return "live_day";
  if (dates.some((d) => d.kind === "sale_start" && d.day <= today)) return "on_sale";
  if (dates.some((d) => TICKET_KINDS.has(d.kind))) return "ticketing";
  return "announced";
}

/** 演出自己的报告：与 story 页同一套可见性，只是把范围换成这场演出名下的全部 fact。 */
const REPORT_ROLLUP = (now: Date) => sql`
  SELECT count(DISTINCT p.article_id)::int AS report_count,
         coalesce(array_agg(DISTINCT p.article_id), '{}') AS item_ids
  FROM facts f
  JOIN fact_articles fa ON fa.fact_id = f.id
  JOIN publications p ON p.article_id = fa.article_id
  JOIN sources s ON s.id = p.source_id
  WHERE f.live_event_id = le.id AND ${storyReportCondition(now)}`;

/** story_id 会被合并：读的时候跟到还活着的那一条，公开 id 才跟着 308 走。 */
const LIVE_SELECT = (now: Date) => sql`
  le.id, le.public_id::text AS public_id, le.title, le.subject_entity, le.venue, le.timezone,
  le.starts_on::text AS starts_on, le.ends_on::text AS ends_on, le.starts_time, le.status,
  st.public_id::text AS story_public_id, st.title AS story_title,
  r.report_count, r.item_ids
  FROM live_events le
  LEFT JOIN stories st0 ON st0.id = le.story_id
  LEFT JOIN stories st ON st.id = COALESCE(st0.merged_into, st0.id)
  CROSS JOIN LATERAL (${REPORT_ROLLUP(now)}) r`;

function refOf(row: LiveRow, dates: DeadlineView[], now: Date): LiveRef {
  return {
    publicId: row.public_id,
    title: row.title,
    subject: row.subject_entity,
    subjectName: ENTITIES[row.subject_entity]?.name ?? row.subject_entity,
    venue: row.venue,
    timezone: row.timezone,
    startsOn: row.starts_on,
    startsTime: row.starts_time,
    stage: stageOf(row, dates, now),
  };
}

function daysLeftOf(row: LiveRow, now: Date): number {
  return Math.round((Date.parse(row.starts_on) - Date.parse(timezoneDate(row.timezone, now))) / 86400000);
}

/** 一场演出自己的日期，按它自己报告的 article id 取 —— 与截止雷达、日历同一份行。 */
async function datesOf(itemIds: string[], now: Date): Promise<DeadlineView[]> {
  if (itemIds.length === 0) return [];
  const today = beijingDate(now);
  return await deadlineRange(now, {
    from: addDays(today, -DATE_WINDOW_DAYS),
    to: addDays(today, DATE_WINDOW_DAYS),
    limit: 100,
    itemIds,
  });
}

/** 一批演出的日期，一次取完再按报告分回去（列表里每场单独查一次就太吵了）。 */
async function datesByLive(rows: LiveRow[], now: Date): Promise<Map<number, DeadlineView[]>> {
  const owner = new Map<string, number>();
  for (const row of rows) for (const id of row.item_ids) owner.set(id, row.id);
  const out = new Map<number, DeadlineView[]>();
  if (owner.size === 0) return out;
  for (const view of await datesOf([...owner.keys()], now)) {
    const id = owner.get(view.itemId);
    if (id === undefined) continue;
    out.set(id, [...(out.get(id) ?? []), view]);
  }
  return out;
}

/**
 * 一个主体的演出：没结束的在前（最近的一场最先），已经结束的在后（刚过去的在前）。跟日历读同一批行，
 * 只是按场次而不是按日期分组。
 */
export async function livesForSubject(subject: string, now: Date, limit = 12): Promise<LiveEventSummary[]> {
  const rows = await sql<LiveRow[]>`
    SELECT ${LIVE_SELECT(now)}
    WHERE le.subject_entity = ${subject} AND r.report_count > 0
    ORDER BY COALESCE(le.ends_on, le.starts_on) DESC
    LIMIT ${MAX_SUBJECT_LIVES}`;
  const dates = await datesByLive(rows, now);
  const ordered = rows.map((row) => ({ row, dates: dates.get(row.id) ?? [] }));
  ordered.sort((a, b) => {
    const done = (x: typeof a) => ((x.row.ends_on ?? x.row.starts_on) < timezoneDate(x.row.timezone, now) ? 1 : 0);
    const [ad, bd] = [done(a), done(b)];
    if (ad !== bd) return ad - bd;
    return ad === 0 ? a.row.starts_on.localeCompare(b.row.starts_on) : b.row.starts_on.localeCompare(a.row.starts_on);
  });
  return ordered.slice(0, limit).map(({ row, dates: own }) => ({
    ...refOf(row, own, now),
    endsOn: row.ends_on,
    daysLeft: daysLeftOf(row, now),
    reportCount: row.report_count,
  }));
}

/** 这一条 story 讲的是哪一场演出（它自己的页面上那一行「演出」）。 */
export async function liveRefForStory(storyId: number, now: Date): Promise<LiveRef | null> {
  const rows = await sql<LiveRow[]>`
    SELECT ${LIVE_SELECT(now)}
    WHERE (st0.id = ${storyId} OR st0.merged_into = ${storyId}) AND r.report_count > 0
    ORDER BY le.starts_on DESC
    LIMIT 1`;
  const [row] = rows;
  if (!row) return null;
  return refOf(row, await datesOf(row.item_ids, now), now);
}

/** 一批演出在别处出现时的那一行引用（碟里的序列号指向哪场演出）。没有公开报告的不算。 */
export async function liveRefs(ids: number[], now: Date): Promise<Map<number, LiveRef>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await sql<LiveRow[]>`SELECT ${LIVE_SELECT(now)} WHERE le.id IN ${sql(wanted)} AND r.report_count > 0`;
  const dates = await datesByLive(rows, now);
  return new Map(rows.map((row) => [row.id, refOf(row, dates.get(row.id) ?? [], now)]));
}

/** 一场演出的页面：报告、它自己的日期、以及它挂在哪个事件页下。报告全下架了就是 404。 */
export async function loadLive(publicId: string, now = new Date()): Promise<LiveEventView | null> {
  const rows = await sql<LiveRow[]>`SELECT ${LIVE_SELECT(now)} WHERE le.public_id = ${publicId}`;
  const [row] = rows;
  if (!row || row.report_count === 0) return null;
  const [dates, facts, rounds, cover] = await Promise.all([
    datesOf(row.item_ids, now),
    sql<{ id: number }[]>`SELECT id FROM facts WHERE live_event_id = ${row.id}`,
    roundsOf(row.id, now),
    coverOfItems(row.item_ids, now),
  ]);
  const reports: StoryReportView[] = await liveReports(facts.map((f) => f.id), now);
  const [seen] = await sql<{ first_seen_at: Date; updated_at: Date }[]>`
    SELECT first_seen_at, updated_at FROM live_events WHERE id = ${row.id}`;
  // 页面上票务日期由轮次那一栏负责，雷达里那些同样的行就不再重复列一遍。
  const covered = new Set(rounds.flatMap((r) => ROUND_SLOTS.flatMap((slot) => {
    const date = r[slot];
    return date ? [`${roundSlotKind(r.kind, slot)}|${date.day}`] : [];
  })));
  const today = timezoneDate(row.timezone, now);
  return {
    ...refOf(row, dates, now),
    endsOn: row.ends_on,
    daysLeft: daysLeftOf(row, now),
    reportCount: row.report_count,
    status: row.status,
    firstSeenAt: (seen?.first_seen_at ?? now).toISOString(),
    updatedAt: (seen?.updated_at ?? now).toISOString(),
    reports,
    rounds,
    dates: dates.filter((d) => d.day >= today && !covered.has(`${d.kind}|${d.day}`)),
    story: row.story_public_id === null ? null : { publicId: row.story_public_id, title: row.story_title ?? row.title },
    cover,
  };
}

/** 进 sitemap 的演出页：跟别的入口一样，只有还有公开报告的那些。 */
export async function liveSitemapEntries(now: Date, limit: number): Promise<Array<{ publicId: string; lastmod: Date }>> {
  return await sql<{ publicId: string; lastmod: Date }[]>`
    SELECT le.public_id::text AS "publicId", le.updated_at AS lastmod
    FROM live_events le
    WHERE EXISTS (
      SELECT 1 FROM facts f JOIN fact_articles fa ON fa.fact_id = f.id
      JOIN publications p ON p.article_id = fa.article_id JOIN sources s ON s.id = p.source_id
      WHERE f.live_event_id = le.id AND ${storyReportCondition(now)}
    )
    ORDER BY le.updated_at DESC
    LIMIT ${limit}`;
}
