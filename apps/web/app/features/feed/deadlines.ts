// How a dated point is worded, shared by the deadline radar and an event's own page so the two can
// never drift apart. The words and the hints come from the contract (the reminder emails use the same
// ones); only the colour class is the website's own business.
import { DEADLINE_LABELS, TIMEZONE_LABELS, type DeadlineKind, type Timezone } from "@girlsbands/contracts/site";

export const DEADLINE_KINDS: Record<DeadlineKind, { label: string; hint: string; className: string }> = {
  lottery_end: { ...DEADLINE_LABELS.lottery_end, className: "text-hot" },
  lottery_start: { ...DEADLINE_LABELS.lottery_start, className: "text-ink-3" },
  sale_start: { ...DEADLINE_LABELS.sale_start, className: "text-accent" },
  sale_end: { ...DEADLINE_LABELS.sale_end, className: "text-hot" },
  event: { ...DEADLINE_LABELS.event, className: "text-ink" },
  stream_end: { ...DEADLINE_LABELS.stream_end, className: "text-amber" },
  result: { ...DEADLINE_LABELS.result, className: "text-ink-3" },
  release_start: { ...DEADLINE_LABELS.release_start, className: "text-accent" },
  merch_start: { ...DEADLINE_LABELS.merch_start, className: "text-ink-3" },
  payment_deadline: { ...DEADLINE_LABELS.payment_deadline, className: "text-hot" },
  other: { ...DEADLINE_LABELS.other, className: "text-ink-4" },
};

/** `2026-10-04` → `10/04`. */
export function md(day: string): string {
  return `${day.slice(5, 7)}/${day.slice(8, 10)}`;
}

/**
 * `15:30 北京时间`, or `全天` when the original stated only a day. Every place that prints a clock goes
 * through this: the announcement's own zone is part of the date, and a bare "15:30" would be a lie for a
 * mainland show.
 */
export function clockText(localTime: string | null, timezone: Timezone): string {
  return localTime ? `${localTime} ${TIMEZONE_LABELS[timezone]}` : "全天";
}

/** 今天 / 明天 / 后天 for the first three days, then the empty string (the caller prints the weekday). */
export function dayName(day: string, from: string): string {
  const offset = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return offset === 0 ? "今天" : offset === 1 ? "明天" : offset === 2 ? "后天" : "";
}
