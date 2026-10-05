import type { FeedItemSummary } from "@girlsbands/contracts/site";
import { deadlineRange, addDays, jstDate } from "./deadlines.ts";

/** Bulk attach dates to a page; no per-card queries or second date policy. */
export async function attachFeedDates(items: FeedItemSummary[], now: Date): Promise<void> {
  if (!items.length) return;
  const from = jstDate(now);
  const dates = await deadlineRange(now, { from, to: addDays(from, 730), itemIds: items.map((i) => i.id) });
  for (const item of items) { item.dates = dates.filter((d) => d.itemId === item.id); item.datesFrom = from; }
}
