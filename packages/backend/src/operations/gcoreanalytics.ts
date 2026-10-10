// Gcore's own count of what its edge served for the pages: requests and bytes out per day. Pages are cached
// at the edge, so most page views never reach the origin and only the CDN knows how many there were; the
// site's own beacon (page_views) counts the ones that ran the script, which is a different, smaller number.
// Only the two headline series are available: the per-country, per-path and per-device breakdowns live in
// Gcore's Advanced Analytics, which this account does not have enabled (its GraphQL aggs/dims answer empty),
// so those top lists stay empty for this source instead of being guessed at.
// Days are Beijing days: the API is asked from a Beijing midnight in UTC and its hourly buckets are summed
// per Beijing day here, because the daily granularity it also offers buckets by UTC day.
import { sql } from "../db.ts";
import { credential } from "../config.ts";

// The Gcore CDN resource that serves the pages domain (girlsbands.com). The ID is assigned when the resource
// is created, so replacing the resource means updating this constant.
const RESOURCE = "1113666";
export const GCORE_SOURCE = "gcore:pages";
const API = "https://api.gcore.com/cdn/statistics/series";

type Series = { metrics?: Record<string, Array<[number, number]>> };

/** "2026-10-07" for a Beijing day `offset` days before today. */
function beijingDay(offset: number, now = Date.now()): string {
  return new Date(now + 8 * 3_600_000 - offset * 86_400_000).toISOString().slice(0, 10);
}

/** Hourly buckets summed into Beijing days: one bucket is the hour that starts at its timestamp. */
export function beijingHours(buckets: Array<[number, number]>): Map<string, number> {
  const days = new Map<string, number>();
  for (const [timestamp, value] of buckets) {
    const day = new Date((Number(timestamp) + 8 * 3_600) * 1000).toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + (Number(value) || 0));
  }
  return days;
}

/** One metric's hourly buckets, summed into Beijing days. */
async function byDay(metric: string, from: string, to: string, key: string): Promise<Map<string, number>> {
  const query = new URLSearchParams({ service: "CDN", resource: RESOURCE, from, to, granularity: "1h", metrics: metric });
  const response = await fetch(`${API}?${query}`, { headers: { Authorization: `APIKey ${key}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Gcore statistics ${metric}: ${response.status} ${response.statusText}`);
  // One metric per request: two comma-separated metrics come back as 204 with no data at all.
  const body = await response.json() as Series;
  return beijingHours(body.metrics?.[metric] ?? []);
}

export async function pullGcore(days = 3): Promise<void> {
  const key = credential("integrations", "GCORE_API_KEY");
  if (!key) return;
  const from = new Date(`${beijingDay(days - 1)}T00:00:00+08:00`).toISOString();
  const to = new Date().toISOString();
  const requests = await byDay("requests", from, to, key);
  const flux = await byDay("sent_bytes", from, to, key);

  for (let offset = days - 1; offset >= 0; offset--) {
    const day = beijingDay(offset);
    await sql`
      INSERT INTO edge_traffic_daily (day, domain, requests, flux_bytes, top)
      VALUES (${day}, ${GCORE_SOURCE}, ${requests.get(day) ?? 0}, ${flux.get(day) ?? 0}, ${sql.json({})})
      ON CONFLICT (day, domain) DO UPDATE SET requests = excluded.requests, flux_bytes = excluded.flux_bytes, top = excluded.top`;
  }
}
