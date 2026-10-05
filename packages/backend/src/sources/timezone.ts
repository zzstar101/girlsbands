// The clock a source's stated times are on. A Japanese announcement states Japan time, a mainland one
// Beijing time, and the site never converts either into the other: 15:30 on the announcement is 15:30
// where the reader is going. The zone is a fact about the source rather than something to read out of
// the text — a wrongly guessed zone would silently move a deadline by an hour or a day — so it lives in
// the source's own config and defaults to Japan, which is where every source but the mainland ones is.
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
