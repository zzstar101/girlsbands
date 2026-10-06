// EdgeOne's own count of what the CDN served for the site's domain: requests and bytes out per day, and
// the day's top pages, countries and device kinds. Most page views never reach the origin (pages are
// cached at the edge), so this is the outside view next to our own beacon count (page_views).
// Days are Beijing days (the API is asked in +08:00, so its day buckets start at Beijing midnight).
import { sql } from "../db.ts";
import { credential } from "../config.ts";
import { callTencent } from "../lib/tencentcloud.ts";

const ZONE = "zone-3vvkl9bcteik";
const TOPS = { urls: "l7Flow_request_url", countries: "l7Flow_request_country", devices: "l7Flow_request_ua_device" } as const;

type Timing = { Data?: Array<{ TypeValue?: Array<{ MetricName: string; Detail?: Array<{ Timestamp: number; Value: number }> }> }> };
type Top = { Data?: Array<{ DetailData?: Array<{ Key: string; Value: number }> }> };

/** "2026-10-07" for a Beijing day `offset` days before today. */
function beijingDay(offset: number, now = Date.now()): string {
  return new Date(now + 8 * 3_600_000 - offset * 86_400_000).toISOString().slice(0, 10);
}

export async function pullEdgeOne(days = 3): Promise<void> {
  const secretId = credential("integrations", "TENCENTCLOUD_SECRET_ID");
  const secretKey = credential("integrations", "TENCENTCLOUD_SECRET_KEY");
  if (!secretId || !secretKey) return;
  const creds = { secretId, secretKey };
  const domain = new URL(process.env.SITE_URL ?? "https://girlsbands.com").hostname;
  const filters = [{ Key: "domain", Operator: "equals", Value: [domain] }];
  const first = beijingDay(days - 1);
  const last = beijingDay(0);

  const timing = await callTencent<Timing>("DescribeTimingL7AnalysisData", {
    StartTime: `${first}T00:00:00+08:00`, EndTime: `${last}T23:59:59+08:00`, ZoneIds: [ZONE], Interval: "day", Area: "overseas",
    MetricNames: ["l7Flow_request", "l7Flow_outFlux"], Filters: filters,
  }, creds);
  const series = new Map<string, Map<string, number>>(); // metric -> day -> value
  for (const t of timing.Data?.[0]?.TypeValue ?? []) {
    const byDay = new Map<string, number>();
    for (const d of t.Detail ?? []) byDay.set(new Date(d.Timestamp * 1000 + 8 * 3_600_000).toISOString().slice(0, 10), Number(d.Value) || 0);
    series.set(t.MetricName, byDay);
  }

  for (let offset = days - 1; offset >= 0; offset--) {
    const day = beijingDay(offset);
    const top: Record<string, Array<{ key: string; value: number }>> = {};
    for (const [name, metric] of Object.entries(TOPS)) {
      try {
        const r = await callTencent<Top>("DescribeTopL7AnalysisData", {
          StartTime: `${day}T00:00:00+08:00`, EndTime: `${day}T23:59:59+08:00`, ZoneIds: [ZONE], Area: "overseas", MetricName: metric, Limit: 15, Filters: filters,
        }, creds);
        top[name] = (r.Data?.[0]?.DetailData ?? []).map((d) => ({ key: d.Key, value: Number(d.Value) || 0 }));
      } catch {
        top[name] = [];
      }
    }
    const requests = series.get("l7Flow_request")?.get(day) ?? 0;
    const flux = series.get("l7Flow_outFlux")?.get(day) ?? 0;
    await sql`
      INSERT INTO edge_traffic_daily (day, domain, requests, flux_bytes, top)
      VALUES (${day}, ${domain}, ${requests}, ${flux}, ${sql.json(top)})
      ON CONFLICT (day, domain) DO UPDATE SET requests = excluded.requests, flux_bytes = excluded.flux_bytes, top = excluded.top`;
  }
}

export async function prunePageViews(): Promise<void> {
  await sql`DELETE FROM page_views WHERE at < now() - interval '90 days'`;
}
