// How a dated point is worded, shared by the deadline radar and an event's own page so the two can
// never drift apart. The words and the hints come from the contract (the reminder emails use the same
// ones); only the colour class is the website's own business.
import { DEADLINE_LABELS, type DeadlineKind } from "@aihot/contracts/site";

export const DEADLINE_KINDS: Record<DeadlineKind, { label: string; hint: string; className: string }> = {
  lottery_end: { ...DEADLINE_LABELS.lottery_end, className: "text-hot" },
  lottery_start: { ...DEADLINE_LABELS.lottery_start, className: "text-ink-3" },
  sale_start: { ...DEADLINE_LABELS.sale_start, className: "text-accent" },
  event: { ...DEADLINE_LABELS.event, className: "text-ink" },
  stream_end: { ...DEADLINE_LABELS.stream_end, className: "text-amber" },
  result: { ...DEADLINE_LABELS.result, className: "text-ink-3" },
  other: { ...DEADLINE_LABELS.other, className: "text-ink-4" },
};

/** `2026-10-04` → `10/04`. */
export function md(day: string): string {
  return `${day.slice(5, 7)}/${day.slice(8, 10)}`;
}

/** `2026-10-04T12:00` → `12:00`; a date with no stated time shows no clock. */
export function clock(at: string): string | null {
  return at.length > 10 ? at.slice(11, 16) : null;
}

/** 今天 / 明天 / 后天 for the first three days, then the empty string (the caller prints the weekday). */
export function dayName(day: string, from: string): string {
  const offset = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return offset === 0 ? "今天" : offset === 1 ? "明天" : offset === 2 ? "后天" : "";
}
