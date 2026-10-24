// The clock a stated time is on. A Japanese announcement states Japan time, a mainland one Beijing
// time, and the site never converts either into the other: 15:30 on the announcement is 15:30 where the
// reader is going. The zone is a fact about the source rather than something to guess out of the text —
// a wrongly guessed zone would silently move a deadline by an hour or a day — so it lives in the source's
// own config and defaults to Japan, which is where every source but the mainland ones is.
//
// One exception, and only on the announcement's own word: a Japanese source announcing a show abroad
// (香港公演、台北公演) writes its times on the clock of the place (「抽選受付 12:00（現地時間）」). The
// show's place is a fact too — a venue in the glossary, or the place the live step read out of the text
// (lives/link.ts) — and a time that says it is local time, or names its clock (「香港時間」), is on that
// clock. A time that says neither stays on the source's clock: guessing is still not allowed.
import { TIMEZONES, TIMEZONE_OFFSETS, type Timezone } from "@girlsbands/contracts/site";

export const DEFAULT_TIMEZONE: Timezone = "Asia/Tokyo";

export function isTimezone(value: unknown): value is Timezone {
  return typeof value === "string" && (TIMEZONES as readonly string[]).includes(value);
}

/** The clock a source's dates are on; Japan unless its config names another. */
export function timezoneOf(config: Record<string, unknown> | null | undefined): Timezone {
  const value = config?.timezone;
  return isTimezone(value) ? value : DEFAULT_TIMEZONE;
}

/** Clocks an announcement names outright, in Japanese, Chinese or as the usual abbreviation. */
const NAMED_CLOCKS: ReadonlyArray<[Timezone, RegExp]> = [
  ["Asia/Tokyo", /日本時間|日本时间|\bJST\b/],
  ["Asia/Shanghai", /北京時間|北京时间|中国時間|中國時間/],
  ["Asia/Hong_Kong", /香港時間|香港时间|\bHKT\b/],
  ["Asia/Taipei", /台湾時間|台灣時間|台湾时间|台北時間|台北时间/],
  ["Asia/Seoul", /韓国時間|韓國時間|韩国时间|\bKST\b/],
  ["Asia/Singapore", /シンガポール時間|新加坡时间|新加坡時間|\bSGT\b/],
  ["Asia/Kuala_Lumpur", /マレーシア時間|马来西亚时间|馬來西亞時間/],
  ["Asia/Bangkok", /タイ時間|泰国时间|泰國時間/],
  ["Asia/Jakarta", /インドネシア時間|印尼时间|印尼時間|\bWIB\b/],
  ["Asia/Manila", /フィリピン時間|菲律宾时间|菲律賓時間/],
];

/** 「現地時間」 and its siblings: the clock of the place the show is held in. */
const LOCAL_CLOCK = /現地時間|現地時刻|现地时间|当地时间|當地時間|local time/i;

/**
 * The clock a piece of announcement text says its times are on, or null when it says nothing. A named
 * clock is that clock; 「現地時間」 is `localZone` (the show's own place) when one is known. Two
 * different named clocks in one sentence (「香港時間 12:00（日本時間 13:00）」) cannot say which one the
 * extracted time is on, so they say nothing.
 */
export function statedTimezone(text: string, localZone: Timezone | null): Timezone | null {
  const named = new Set(NAMED_CLOCKS.filter(([, pattern]) => pattern.test(text)).map(([zone]) => zone));
  if (named.size === 1) return [...named][0]!;
  if (named.size > 1) return null;
  return localZone && LOCAL_CLOCK.test(text) ? localZone : null;
}

/** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` — the only two shapes the extraction emits. */
const AT = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/;

/** A stored `at` split into the day and the clock the announcement gave, or null when malformed. */
export function splitDeadlineAt(at: string): { day: string; localTime: string | null } | null {
  const match = AT.exec(at);
  return match ? { day: match[1]!, localTime: match[2] ?? null } : null;
}

/**
 * The absolute instant a wall-clock day — and, when the original stated one, an `HH:mm` on that zone's
 * clock — falls on. A bare day is that zone's midnight, which is what the 48-hour flag is measured from.
 */
export function deadlineInstant(day: string, localTime: string | null, timezone: Timezone): number {
  return Date.parse(`${day}T${localTime ?? "00:00"}:00${TIMEZONE_OFFSETS[timezone]}`);
}
