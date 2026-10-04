// A listing source can fan one run out over several search URLs — a CPP doujin tag, a Bilibili
// keyword, a Showstart search — because those listings take exactly one query per request. A keyword
// with nothing on is skipped, a URL that breaks still fails the run, and each URL's own count reaches
// the admin through the fetch run's detail.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { config } from "@girlsbands/backend/config";
import { closeDb, sql } from "@girlsbands/backend/db";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { collectSource } from "@girlsbands/backend/sources/collect";

const T = tag();
const FANOUT = `test-fanout-${T}`;
const QUIET = `test-fanout-quiet-${T}`;
const PARTLY_BROKEN = `test-fanout-broken-${T}`;

const list = (items: unknown[]) => JSON.stringify({ result: { list: items } });
const pages: Record<string, () => string> = {
  "/list.json?tag=a": () => list([{ id: 1, name: `上海BanG Dream ONLY7 ${T}`, tag: "bangdream", enterTime: 1794672000000, cityName: "上海" }]),
  "/list.json?tag=b": () => list([{ id: 2, name: `北京音乐番Only 2.0 ${T}`, tag: "BanGDream", enterTime: 1792773000000, cityName: "北京" }]),
  "/list.json?tag=quiet": () => list([]),
  "/list.json?tag=quiet2": () => list([]),
};
const server = http.createServer((req, res) => {
  const path = req.url ?? "";
  const found = Object.hasOwn(pages, path);
  res.writeHead(found ? 200 : 404, { "content-type": "application/json" });
  res.end(found ? pages[path]!() : "");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const site = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;

const listing = (urls: string[]) => ({
  urls,
  itemsPath: "result.list",
  titlePaths: ["name"],
  summaryTemplate: "活动时间：{date:enterTime}｜城市：{cityName}｜标签：{tag}",
  summaryIsBody: true,
  urlTemplate: "https://www.allcpp.cn/allcpp/event/event.do?event={id}",
});

before(async () => {
  const rows: Array<[string, string[]]> = [
    [FANOUT, [`${site}/list.json?tag=a`, `${site}/list.json?tag=b`, `${site}/list.json?tag=quiet`]],
    [QUIET, [`${site}/list.json?tag=quiet`, `${site}/list.json?tag=quiet2`]],
    [PARTLY_BROKEN, [`${site}/list.json?tag=a`, `${site}/list.json?tag=missing`]],
  ];
  for (const [id, urls] of rows) {
    await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, next_fetch_at)
              VALUES (${id}, ${`Test ${id}`}, 'json_list', ${sql.json(listing(urls) as never)}, 'T2', 'editorial', '2100-01-01')`;
  }
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await stopBoss();
  await closeDb();
});

test("a fan-out reads every search URL and skips the ones with nothing on", async () => {
  const got = await collectSource(FANOUT, { force: true });
  assert.equal(got.status, "ok");
  assert.equal(got.found, 2, "the quiet tag contributes nothing");
  assert.equal(got.created, 2);
  const [run] = await sql<{ detail: { urls: Array<{ count: number }> } }[]>`SELECT detail FROM fetch_runs WHERE source_id = ${FANOUT} ORDER BY id DESC LIMIT 1`;
  assert.deepEqual(run!.detail.urls.map((u) => u.count), [1, 1, 0], "the admin sees each URL's own count");
  const rows = await sql<{ excerpt: string; body_status: string }[]>`SELECT excerpt, body_status FROM articles WHERE source_id = ${FANOUT} ORDER BY url`;
  assert.deepEqual(rows.map((r) => [r.excerpt, r.body_status]), [
    ["活动时间：2026-11-15｜城市：上海｜标签：bangdream", "ok"],
    ["活动时间：2026-10-24｜城市：北京｜标签：BanGDream", "ok"],
  ], "the composed line is the material, and it needs no page fetch");
});

test("no URL with anything on fails the run; a URL that breaks fails it at once", async () => {
  const quiet = await collectSource(QUIET, { force: true });
  assert.equal(quiet.status, "failed");
  assert.match(String(quiet.error), /no items matched \(2 urls\)/);
  const broken = await collectSource(PARTLY_BROKEN, { force: true });
  assert.equal(broken.status, "failed");
  assert.match(String(broken.error), /HTTP 404/);
});
