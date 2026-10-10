import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@girlsbands/backend/db";
import { adminStats, pageVisitorHash } from "@girlsbands/backend/admin/stats";
import { signTC3 } from "@girlsbands/backend/lib/tencentcloud";
import { beijingHours } from "@girlsbands/backend/operations/gcoreanalytics";
import { buildApp } from "../apps/api/src/app.ts";

const app = await buildApp();
after(async () => { await app.close(); await closeDb(); });

test("page-view beacon accepts text/plain JSON and stores no address", async () => {
  const path = `/items/${`pv-${Date.now()}`}`;
  const response = await app.inject({ method:"POST",url:"/api/site/pv",headers:{"content-type":"text/plain","user-agent":"Mozilla/5.0 desktop","eo-connecting-ip":"203.0.113.17"},payload:JSON.stringify({path,referrer:"https://example.org/article"}) });
  assert.equal(response.statusCode,204);
  assert.equal(response.headers["cache-control"],"no-store");
  const [row] = await sql<{path:string;item_id:string;visitor_day_hash:string;referrer_host:string}[]>`SELECT path,item_id,visitor_day_hash,referrer_host FROM page_views WHERE path=${path}`;
  assert.equal(row?.item_id,path.slice("/items/".length));
  assert.equal(row?.referrer_host,"example.org");
  assert.match(row?.visitor_day_hash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(row ?? {}).some((key)=>key === "ip" || key === "address"),false);
});

test("beacon ignores crawlers and admin paths", async () => {
  const crawler=await app.inject({method:"POST",url:"/api/site/pv",headers:{"content-type":"application/json","user-agent":"Googlebot"},payload:{path:"/"}});
  const admin=await app.inject({method:"POST",url:"/api/site/pv",headers:{"content-type":"application/json","user-agent":"Mozilla"},payload:{path:"/admin"}});
  assert.equal(crawler.statusCode,204); assert.equal(admin.statusCode,204);
});

test("each CDN keeps its own series, and a row from the retired counter is ignored", async () => {
  const [today] = await sql<{ day: string }[]>`SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai')::date,'YYYY-MM-DD') AS day`;
  const day = today!.day;
  await sql`INSERT INTO edge_traffic_daily (day, domain, requests, flux_bytes, top) VALUES (${day}, 'edgeone:assets', 100, 2048, ${sql.json({ urls: [{ key: "/assets/a.js", value: 100 }] })})`;
  await sql`INSERT INTO edge_traffic_daily (day, domain, requests, flux_bytes, top) VALUES (${day}, 'gcore:pages', 40, 1024, ${sql.json({})})`;
  await sql`INSERT INTO edge_traffic_daily (day, domain, requests, flux_bytes, top) VALUES (${day}, 'girlsbands.com', 999, 999, ${sql.json({})})`;
  // The stats cache keeps one window, not one per argument, so the first adminStats call of the file has to
  // come after these rows: that is why this test runs before the structure one below.
  const stats = await adminStats(30);
  const at = (rows: Array<{ day: string; requests: number }>) => rows.find((r) => r.day === day)?.requests;
  assert.equal(at(stats.traffic.edge?.daily ?? []), 100);
  assert.equal(at(stats.traffic.gcore?.daily ?? []), 40);
  assert.equal(stats.traffic.edge?.top.urls[0]?.key, "/assets/a.js");
  assert.deepEqual(stats.traffic.gcore?.top, { urls: [], countries: [], devices: [] });
});

test("admin analytics returns the requested section structure", async () => {
  const stats = await adminStats(30);
  assert.ok(stats.traffic && Array.isArray(stats.traffic.daily) && stats.traffic.edge !== undefined && stats.traffic.gcore !== undefined);
  assert.ok(stats.content && Array.isArray(stats.content.daily) && stats.content.queue);
  assert.ok(stats.sources && stats.models && stats.subscriptions && stats.feedback);
});

test("CDN hour buckets are summed per Beijing day", () => {
  // 1791558000 = 2026-10-09 23:00 +08:00, 1791561600 = 2026-10-10 00:00 +08:00.
  const days = beijingHours([[1791558000, 5], [1791561600, 7], [1791565200, 11]]);
  assert.deepEqual([...days], [["2026-10-09", 5], ["2026-10-10", 18]]);
});

test("visitor hash rotates daily and TC3 signing is deterministic", () => {
  assert.notEqual(pageVisitorHash("127.0.0.1","ua",new Date("2026-01-01T00:00:00Z"),"secret"),pageVisitorHash("127.0.0.1","ua",new Date("2026-01-02T00:00:00Z"),"secret"));
  const opts={secretId:"AKIDEXAMPLE",secretKey:"secret",service:"teo",host:"teo.tencentcloudapi.com",action:"DescribeTimingL7AnalysisData",version:"2022-09-01",payload:"{}",now:new Date("2026-01-02T03:04:05Z")};
  assert.deepEqual(signTC3(opts),signTC3(opts));
  assert.match(signTC3(opts).Authorization,/TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/);
});
