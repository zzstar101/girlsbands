import { createHash } from "node:crypto";
import { sql } from "../db.ts";
import { cached } from "../lib/cache.ts";
import { credential } from "../config.ts";
import { EDGE_SOURCE } from "../operations/edgeanalytics.ts";
import { GCORE_SOURCE } from "../operations/gcoreanalytics.ts";
import type { CdnTraffic, EdgeTop } from "@girlsbands/contracts/admin-stats";

const statsCache = cached(loadStats, { freshMs: 60_000, maxStaleMs: 60_000 });
export const adminStats = (days: number) => statsCache.get(days);

export function pageVisitorHash(ip: string, ua: string, date = new Date(), secret = credential("auth", "SESSION_SECRET") ?? "dev-feedback-secret"): string {
  const day = date.toISOString().slice(0, 10);
  const salt = createHash("sha256").update(`${secret}:${day}`).digest("hex");
  return createHash("sha256").update(`${salt}:${ip}:${ua}`).digest("hex");
}

export async function recordPageView(input: { path: string; referrer?: string | null; ip: string; ua: string; device: "mobile" | "tablet" | "desktop"; country?: string | null }): Promise<"stored" | "limited" | "ignored"> {
  if (input.path.startsWith("/admin") || input.path.startsWith("/api/") || input.path.length > 500) return "ignored";
  const now = new Date();
  const visitor = pageVisitorHash(input.ip, input.ua, now);
  const referrerHost = (() => { try { return input.referrer ? new URL(input.referrer).hostname.slice(0, 253) : null; } catch { return null; } })();
  const itemId = /^\/items\/([a-zA-Z0-9_-]{1,80})(?:\/|$)/.exec(input.path)?.[1] ?? null;
  const result = await sql<{ id: number }[]>`
    INSERT INTO page_views (path,item_id,referrer_host,device,visitor_day_hash,country)
    SELECT ${input.path},${itemId},${referrerHost},${input.device},${visitor},${input.country ?? null}
    WHERE (SELECT count(*) FROM page_views WHERE visitor_day_hash=${visitor} AND at > now()-interval '1 minute') < 120
    RETURNING id`;
  return result.length ? "stored" : "limited";
}

async function loadStats(days: number) {
  const cutoff = Math.min(Math.max(days, 1), 90);
  const [traffic, topItems, topPaths, referrers, devices, contentDaily, byProject, queue, sources, receipts, budget, subs, emails, feedback, edgeRows] = await Promise.all([
    sql`SELECT to_char((at AT TIME ZONE 'Asia/Shanghai')::date,'YYYY-MM-DD') AS "day",count(*)::int pv,count(DISTINCT visitor_day_hash)::int uv FROM page_views WHERE at >= now()-(${cutoff}::int * interval '1 day') GROUP BY 1 ORDER BY 1`,
    sql`SELECT p.item_id AS "itemId",coalesce(pub.title,p.item_id) title,count(*)::int pv FROM page_views p LEFT JOIN publications pub ON pub.article_id=p.item_id WHERE p.item_id IS NOT NULL AND p.at>=now()-(${cutoff}::int*interval '1 day') GROUP BY p.item_id,pub.title ORDER BY pv DESC LIMIT 20`,
    sql`SELECT path,count(*)::int pv FROM page_views WHERE at>=now()-(${cutoff}::int*interval '1 day') GROUP BY path ORDER BY pv DESC LIMIT 20`,
    sql`SELECT referrer_host host,count(*)::int pv FROM page_views WHERE referrer_host IS NOT NULL AND at>=now()-(${cutoff}::int*interval '1 day') GROUP BY 1 ORDER BY pv DESC LIMIT 20`,
    sql`SELECT device,count(*)::int pv FROM page_views WHERE at>=now()-(${cutoff}::int*interval '1 day') GROUP BY device ORDER BY pv DESC`,
    sql`SELECT to_char((a.discovered_at AT TIME ZONE 'Asia/Shanghai')::date,'YYYY-MM-DD') AS "day",count(*)::int collected,count(*) FILTER(WHERE p.article_id IS NOT NULL)::int published,count(*) FILTER(WHERE p.selected)::int selected,count(*) FILTER(WHERE a.processing_state='blocked')::int blocked FROM articles a LEFT JOIN publications p ON p.article_id=a.id WHERE a.discovered_at>=now()-(${cutoff}::int*interval '1 day') GROUP BY 1 ORDER BY 1`,
    sql`SELECT entity,count(*)::int count FROM (SELECT unnest(tags) entity FROM publications WHERE tags && ARRAY['entity:bang-dream','entity:girls-band-cry','entity:bocchi-the-rock']::text[] AND discovered_at>=now()-(${cutoff}::int*interval '1 day')) x WHERE entity = ANY(ARRAY['entity:bang-dream','entity:girls-band-cry','entity:bocchi-the-rock']::text[]) GROUP BY 1 ORDER BY 2 DESC`,
    sql`SELECT count(*) FILTER(WHERE processing_state NOT IN ('analyzed','blocked','failed','skipped'))::int waiting,count(*) FILTER(WHERE processing_state='failed')::int failed FROM articles`,
    sql`SELECT count(*)::int total,count(*) FILTER(WHERE enabled)::int enabled,coalesce(json_agg(json_build_object('id',id,'name',name,'lastError',last_error,'lastSuccessAt',last_ok_at) ORDER BY fail_count DESC) FILTER(WHERE health='failing'),'[]'::json) failing,count(*) FILTER(WHERE enabled AND (last_ok_at IS NULL OR last_ok_at<now()-interval '48 hours'))::int stale FROM sources`,
    sql`SELECT to_char((r.created_at AT TIME ZONE 'Asia/Shanghai')::date,'YYYY-MM-DD') AS "day",count(*)::int calls,count(*) FILTER(WHERE a.status='failed' OR r.status='failed')::int failed,count(*) FILTER(WHERE a.error ILIKE '%429%' OR r.error ILIKE '%429%')::int limited,coalesce(sum((a.usage->>'prompt_tokens')::numeric),0)::bigint tin,coalesce(sum((a.usage->>'completion_tokens')::numeric),0)::bigint tout,coalesce(sum(a.cost),0)::numeric cost FROM receipts r LEFT JOIN receipt_attempts a ON a.receipt_id=r.id AND a.attempt=r.attempts WHERE r.created_at>=now()-(${cutoff}::int*interval '1 day') GROUP BY 1 ORDER BY 1`,
    sql`SELECT coalesce(per_minute,0)::int per_minute FROM budgets WHERE service='llm'`,
    sql`SELECT count(*) FILTER(WHERE status IN ('confirmed','pending'))::int subscribers,count(*) FILTER(WHERE status='confirmed')::int confirmed, (SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT to_char((created_at AT TIME ZONE 'Asia/Shanghai')::date,'YYYY-MM-DD') AS "day",count(*)::int "newSubs",count(*) FILTER(WHERE unsubscribed_at IS NOT NULL)::int unsubs FROM subscribers WHERE created_at>=now()-(${cutoff}::int*interval '1 day') GROUP BY 1 ORDER BY 1)x) daily FROM subscribers`,
    sql`SELECT to_char((created_at AT TIME ZONE 'Asia/Shanghai')::date,'YYYY-MM-DD') AS "day",count(*) FILTER(WHERE status='sent')::int sent,count(*) FILTER(WHERE status='failed')::int failed FROM email_sends WHERE created_at>=now()-(${cutoff}::int*interval '1 day') GROUP BY 1 ORDER BY 1`,
    sql`SELECT count(*) FILTER(WHERE status IN ('new','triaged'))::int open,count(*)::int total,(SELECT coalesce(json_agg(x ORDER BY x.day),'[]'::json) FROM (SELECT to_char((created_at AT TIME ZONE 'Asia/Shanghai')::date,'YYYY-MM-DD') AS day,count(*)::int count FROM feedback WHERE created_at>=now()-(${cutoff}::int*interval '1 day') GROUP BY 1)x) daily FROM feedback WHERE created_at>=now()-(${cutoff}::int*interval '1 day')`,
    sql`SELECT domain,day::text AS "day",requests,flux_bytes AS "fluxBytes",top FROM edge_traffic_daily WHERE domain IN (${EDGE_SOURCE},${GCORE_SOURCE}) AND day>=((now() AT TIME ZONE 'Asia/Shanghai')::date-${cutoff}::int) ORDER BY day`,
  ]);
  const normalized = (rows: any[]) => rows.map((r) => ({ ...r, pv: Number(r.pv ?? 0), calls: Number(r.calls ?? 0), count: Number(r.count ?? 0) }));
  const modelRows = normalized(receipts as any[]);
  // One series per CDN: the rows carry the source label, and a window with nothing counted for a source
  // reads as null so the panel can say which one is missing instead of drawing a line at zero.
  const cdn = (label: string): CdnTraffic | null => {
    const rows = (edgeRows as any[]).filter((r) => r.domain === label);
    return rows.length ? { daily: rows.map((r: any) => ({ day:r.day,requests:Number(r.requests),fluxBytes:Number(r.fluxBytes) })), top: mergeTops(rows.map((r: any) => r.top)) } : null;
  };
  const edge = cdn(EDGE_SOURCE);
  const gcore = cdn(GCORE_SOURCE);
  const source = (sources as any[])[0] ?? { total:0,enabled:0,failing:[],stale:0 };
  const contentRows = contentDaily as any[];
  const fb = feedback as any[];
  const peak = await sql`SELECT coalesce(max(n),0)::int peak FROM (SELECT count(*) n FROM receipts WHERE created_at>now()-interval '90 days' GROUP BY date_trunc('minute',created_at)) x`;
  const purpose = await sql`SELECT purpose,count(*)::int calls,coalesce(avg(a.latency_ms),0)::int "avgLatencyMs" FROM receipts r LEFT JOIN receipt_attempts a ON a.receipt_id=r.id WHERE r.created_at>=now()-(${cutoff}::int*interval '1 day') GROUP BY purpose`;
  return {
    traffic:{daily:traffic,topItems,topPaths,referrers,devices,edge,gcore},
    content:{daily:contentRows,byProject:byProject.filter((x:any)=>x.entity?.startsWith("entity:")).map((x:any)=>({...x,entity:x.entity.slice(7)}),),queue:(queue as any[])[0]},
    sources:{total:source.total,enabled:source.enabled,failing:source.failing,staleCount:source.stale},
    models:{perMinutePeak:(peak as any[])[0].peak,daily:modelRows.map((r:any)=>({day:r.day,calls:r.calls,failed:r.failed,rateLimited:r.limited,tokensIn:Number(r.tin),tokensOut:Number(r.tout),cost:Number(r.cost)})),byPurpose:purpose,budget:{perMinute:Number((budget as any[])[0]?.per_minute ?? 0)}},
    subscriptions:{subscribers:Number((subs as any[])[0]?.subscribers??0),confirmed:Number((subs as any[])[0]?.confirmed??0),daily:(subs as any[])[0]?.daily??[],emails:{daily:emails}},
    feedback:{open:Number(fb[0]?.open??0),total:Number(fb[0]?.total??0),daily:fb[0]?.daily??[]},
  };
}

/** Adds each day's CDN top-N into one list per kind for the whole window (largest first). */
function mergeTops(days: Array<Record<string, Array<{ key: string; value: number }>> | null>): { urls: EdgeTop; countries: EdgeTop; devices: EdgeTop } {
  const merge = (kind: string): EdgeTop => {
    const sum = new Map<string, number>();
    for (const d of days) for (const e of d?.[kind] ?? []) sum.set(e.key, (sum.get(e.key) ?? 0) + Number(e.value || 0));
    return [...sum].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value).slice(0, 15);
  };
  return { urls: merge("urls"), countries: merge("countries"), devices: merge("devices") };
}
