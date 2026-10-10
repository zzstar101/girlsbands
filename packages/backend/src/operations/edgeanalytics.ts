// EdgeOne's own count of what its edge served for the site's static files and images: requests and bytes out
// per day, and the day's top paths, countries and device kinds. The pages are counted by Gcore instead
// (gcoreanalytics.ts), so this is the assets' outside view next to our own beacon count (page_views). Most
// asset requests never reach the origin (they are cached at the edge), which is why an outside count is worth
// keeping at all.
// The hosts live on the gbcclub.com site, the one whose edge reaches the mainland; the girlsbands.com site
// this replaced served the pages from an edge that does not, so its numbers are not comparable with these
// and migration 0073 drops its rows.
// Days are Beijing days (the API is asked in +08:00, so its day buckets start at Beijing midnight).
import { sql } from "../db.ts";
import { credential } from "../config.ts";
import { callTencent } from "../lib/tencentcloud.ts";

// The gbcclub.com site's EdgeOne zone ID and the area it is served from. EdgeOne assigns the ID at site
// creation, so deleting and recreating the site issues a new one and this constant has to be updated with it.
const ZONE = "zone-3p69kw70ulcy";
const AREA = "global";
// The asset hostnames that site serves. edge_traffic_daily.domain holds the label below rather than a
// request host: two CDNs count this site now, and a row has to say which one counted it.
const HOSTS = ["static.girlsbands.gbcclub.com", "img.girlsbands.gbcclub.com"];
export const EDGE_SOURCE = "edgeone:assets";
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
  // One filter carrying both hostnames is an OR, so a single set of calls covers the two; the tops below mix
  // paths from both, which is what we want (they are all assets).
  const filters = [{ Key: "domain", Operator: "equals", Value: [...HOSTS] }];
  const first = beijingDay(days - 1);
  const last = beijingDay(0);

  const timing = await callTencent<Timing>("DescribeTimingL7AnalysisData", {
    StartTime: `${first}T00:00:00+08:00`, EndTime: `${last}T23:59:59+08:00`, ZoneIds: [ZONE], Interval: "day", Area: AREA,
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
          StartTime: `${day}T00:00:00+08:00`, EndTime: `${day}T23:59:59+08:00`, ZoneIds: [ZONE], Area: AREA, MetricName: metric, Limit: 15, Filters: filters,
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
      VALUES (${day}, ${EDGE_SOURCE}, ${requests}, ${flux}, ${sql.json(top)})
      ON CONFLICT (day, domain) DO UPDATE SET requests = excluded.requests, flux_bytes = excluded.flux_bytes, top = excluded.top`;
  }
}

export async function prunePageViews(): Promise<void> {
  await sql`DELETE FROM page_views WHERE at < now() - interval '90 days'`;
}
