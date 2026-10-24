// The month calendar and the .ics export. Both read the same dated rows as the radar (deadlines.ts),
// so the radar, a month page and a reader's own calendar can never disagree about a date.
//
// The calendar belongs to a subject — a project or a band, whose series dates come along — because that
// is what a reader plans around. The export is offered whole-site as well.
import type { CalendarResponse, DeadlineView, Timezone } from "@girlsbands/contracts/site";
import { FAN_EVENT_LABEL, isFanEvent, TIMEZONE_OFFSETS } from "@girlsbands/contracts/site";
import { SITE } from "@girlsbands/industry/site";
import { config } from "../config.ts";
import { addDays, deadlineMonths, deadlineRange, jstDate } from "./deadlines.ts";
import { itemUrl } from "./links.ts";
import { findPageTopic } from "./topics.ts";
import { tracksAsSubject } from "./topic-chronicle.ts";

/** How far the month strip reaches on either side of this month. */
const BACK_MONTHS = 3;
const AHEAD_MONTHS = 12;
/** The export covers what a reader is planning, not the archive. */
const ICS_BACK_DAYS = 30;
const ICS_AHEAD_DAYS = 365;
const ICS_LIMIT = 2_000;

const MONTH = /^\d{4}-\d{2}$/;

/** A calendar month shifted by whole months, as `YYYY-MM`. */
function shiftMonth(month: string, delta: number): string {
  const months = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  return `${String(Math.floor(months / 12)).padStart(4, "0")}-${String((months % 12) + 1).padStart(2, "0")}`;
}

const monthStart = (month: string) => `${month}-01`;
const monthEnd = (month: string) => addDays(monthStart(shiftMonth(month, 1)), -1);

/**
 * The subject a calendar belongs to, or null when the slug is not one. A direction (Live, 票务) has a
 * page but no calendar of its own: its dates are everyone's, and they are on the radar and the feed.
 */
export function calendarSubject(slug: string): { id: string; name: string } | null {
  const topic = findPageTopic(slug);
  if (!topic || !topic.entityId || !tracksAsSubject(topic.group)) return null;
  return { id: topic.entityId, name: topic.name };
}

/** This month and every month near it that has a date — what the calendar lets a reader flip to. */
export async function calendarMonths(now: Date, subject: string): Promise<string[]> {
  const current = jstDate(now).slice(0, 7);
  const found = await deadlineMonths(now, {
    from: monthStart(shiftMonth(current, -BACK_MONTHS)),
    to: monthEnd(shiftMonth(current, AHEAD_MONTHS)),
    subject,
  });
  return [...new Set([current, ...found])].sort();
}

/** One month of a subject's dates. Null when the month is malformed or outside the strip. */
export async function calendarPage(now: Date, month: string | null, subject: string): Promise<CalendarResponse | null> {
  const wanted = month ?? jstDate(now).slice(0, 7);
  if (!MONTH.test(wanted)) return null;
  const months = await calendarMonths(now, subject);
  if (!months.includes(wanted)) return null;
  const items = await deadlineRange(now, { from: monthStart(wanted), to: monthEnd(wanted), subject });
  const days = new Map<string, DeadlineView[]>();
  for (const item of items) {
    const bucket = days.get(item.day);
    if (bucket) bucket.push(item);
    else days.set(item.day, [item]);
  }
  return {
    computedAt: now.toISOString(),
    subject,
    month: wanted,
    days: [...days.entries()].map(([date, list]) => ({ date, items: list })),
    months,
    total: items.length,
  };
}

// ---------------------------------------------------------------------------------------------------
// The export. A reader subscribes to it and their own calendar then carries every date the site knows,
// with the same titles and the same reading links.

/** RFC 5545 text: backslash, semicolon and comma are escaped, a line break becomes `\n`. */
const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const compact = (day: string) => day.replace(/-/g, "");

/** RFC 5545 folding: 75 octets per line, continuations start with a space, never split a character. */
function fold(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > 75) {
      out.push(current);
      current = " ";
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out;
}

/**
 * One date as a VEVENT. A time keeps the announcement's own clock and names its zone — 15:30 on the
 * announcement is 15:30 where the event happens, whether that is Japan or the mainland — and an entry
 * without one is an all-day event on the announcement's own calendar day.
 */
function event(v: DeadlineView, now: Date, host: string): string[] {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const timed = v.localTime !== null;
  const uid = `${v.itemId}-${v.kind}-${v.at.replace(/[^0-9A-Za-z]/g, "")}@${host}`;
  const description = [v.note, `来源：${v.source.name}`, itemUrl(v.itemId)].filter(Boolean).join("\n");
  // 同人场的标题前挂上标记，导出到读者自己的日历里也不会跟乐队的官方演出认混。
  const summary = [isFanEvent(v.organizer) ? FAN_EVENT_LABEL : null, v.title].filter(Boolean).join("｜");
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    timed
      ? `DTSTART;TZID=${v.timezone}:${compact(v.day)}T${v.localTime!.replace(":", "")}00`
      : `DTSTART;VALUE=DATE:${compact(v.day)}`,
    ...(timed ? [] : [`DTEND;VALUE=DATE:${compact(addDays(v.day, 1))}`]),
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${itemUrl(v.itemId)}`,
    `CATEGORIES:${escapeText(v.kind)}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}

/** The abbreviation each zone is shown with; a zone with no common one uses its offset, as tzdata does. */
const TZNAMES: Record<Timezone, string> = {
  "Asia/Tokyo": "JST",
  "Asia/Shanghai": "CST",
  "Asia/Hong_Kong": "HKT",
  "Asia/Taipei": "CST",
  "Asia/Seoul": "KST",
  "Asia/Singapore": "+08",
  "Asia/Kuala_Lumpur": "+08",
  "Asia/Bangkok": "+07",
  "Asia/Jakarta": "WIB",
  "Asia/Manila": "PHT",
};

/**
 * The zone definition a file needs, written out rather than referenced: no zone the site carries has
 * observed daylight saving or changed its offset since 1991 and no date reaches back that far, so each
 * is one constant observance. A client that does not know the IANA database still reads the times
 * correctly.
 */
function vtimezone(zone: Timezone): string[] {
  const offset = TIMEZONE_OFFSETS[zone].replace(":", "");
  return [
    "BEGIN:VTIMEZONE", `TZID:${zone}`, `X-LIC-LOCATION:${zone}`,
    "BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`, `TZNAME:${TZNAMES[zone]}`, "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

/** The whole site's dates, or one subject's, as an iCalendar file. */
export async function calendarIcs(now: Date, subject?: string): Promise<string> {
  const today = jstDate(now);
  const items = await deadlineRange(now, {
    from: addDays(today, -ICS_BACK_DAYS),
    to: addDays(today, ICS_AHEAD_DAYS),
    limit: ICS_LIMIT,
    subject,
  });
  const topic = subject === undefined ? null : findPageTopic(subject);
  const name = topic ? `${SITE.name} — ${topic.name} 日程` : `${SITE.name} — 全部日程`;
  const host = new URL(config.siteUrl).host;
  // Only a timed event carries a TZID, so only those need a definition in the file. An all-day event is
  // a date on the announcement's own calendar: no clock, no zone.
  const zones = [...new Set(items.filter((v) => v.localTime !== null).map((v) => v.timezone))].sort();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//girlsbands//calendar//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-CALDESC:${escapeText(`收录最近 ${ICS_BACK_DAYS} 天与未来 ${ICS_AHEAD_DAYS} 天的演出、抽选、发售与周边开订日期，与站内截止雷达同一份数据。`)}`,
    // The site's own baseline; every timed event still names its zone, so this only tells an app how to
    // show a file whose dates are mostly Japanese.
    "X-WR-TIMEZONE:Asia/Tokyo",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...zones.flatMap(vtimezone),
    ...items.flatMap((v) => event(v, now, host)),
    "END:VCALENDAR",
  ];
  return `${lines.flatMap(fold).join("\r\n")}\r\n`;
}
