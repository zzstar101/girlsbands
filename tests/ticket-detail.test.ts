import "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@girlsbands/backend/config";
import { fetchJsonList } from "@girlsbands/backend/sources/json-list";
import { enrichCandidate } from "@girlsbands/backend/sources/detail-adapters";
import { unsupportedConfig } from "@girlsbands/backend/sources/config-keys";

const fixture = {
  cpplist: { result: { list: [{ id: 7445, eventId: 8210, name: "珠海音乐企划ONLY" }] } },
  list: { data: { result: [{ id: 42, project_name: "演出活动", cover: "https://i2.hdslb.com/poster.jpg", start_time: 1790000000 }] } },
  bili: { data: { name: "正式演出", cover: "//i2.hdslb.com/poster.jpg", price_low: 6800, price_high: 12800, sale_begin: "2026-08-01 10:00", sale_end: "2026-08-31 23:59", performance_desc: { list: [
    { module: "base_info", details: [{ title: "活动日期", content: "2026年9月1日" }, { title: "场馆地址", content: "上海" }] },
    { module: "activity_content", details: '<p>详情票务说明<img src="//i1.hdslb.com/bfs/openplatform/detail.jpg"></p>' },
  ] } } },
  cpp: { result: { eventId: 8, name: "同人Only", enterAddress: "上海展馆", enterTime: "2026-09-01", description: "", rule: '<p>入场规则</p><p><img src="https://imagecdn3.allcpp.cn/rule.jpg"></p>', logoPicUrl: "https://imagecdn3.allcpp.cn/logo.jpg", positionPicUrl: "ignored" }, isSuccess: true },
};
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.url === "/list") res.end(JSON.stringify(fixture.list));
  else if (req.url === "/cpplist") res.end(JSON.stringify(fixture.cpplist));
  else if (req.url === "/bili/42") res.end(JSON.stringify(fixture.bili));
  else if (req.url === "/cpp/8") res.end(JSON.stringify(fixture.cpp));
  else { res.writeHead(503); res.end(JSON.stringify({ error: "offline" })); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const allow = config.allowPrivateNetworkFetch;
config.allowPrivateNetworkFetch = true;
after(async () => { config.allowPrivateNetworkFetch = allow; await new Promise<void>((resolve) => server.close(() => resolve())); });

test("bilibili listing receives sanitized body and deduplicated cover/detail images", async () => {
  const [candidate] = await fetchJsonList({ config: { url: `${root}/list`, itemsPath: "data.result", titlePaths: ["project_name"], urlTemplate: `${root}/project?id={id}`, externalIdPath: "id", imageField: "cover", summaryIsBody: true } } as never);
  const got = await enrichCandidate(candidate!, "bilibili-show", "42", { url: `${root}/bili/42` });
  assert.equal(got.bodyStatus, "ok");
  assert.match(got.bodyText!, /活动日期\s*：2026年9月1日/);
  assert.match(got.bodyText!, /¥68–¥128/);
  assert.match(got.bodyText!, /开售时间/);
  assert.deepEqual(got.media?.map((m) => m.url), ["https://i2.hdslb.com/poster.jpg", "https://i1.hdslb.com/bfs/openplatform/detail.jpg"]);
});

test("allcpp event rule html and images become the body and media", async () => {
  const candidate = { url: "https://www.allcpp.cn/allcpp/event/event.do?event=8", title: "Only", excerpt: "摘要", bodyText: "摘要", bodyStatus: "ok", media: [] } as never;
  const got = await enrichCandidate(candidate, "allcpp-event", "8", { url: `${root}/cpp/8` });
  assert.match(got.bodyText!, /活动时间\s*：2026-09-01/);
  assert.match(got.bodyText!, /活动地点\s*：上海展馆/);
  assert.match(got.bodyText!, /入场规则/);
  assert.deepEqual(got.media?.map((m) => m.url), ["https://imagecdn3.allcpp.cn/logo.jpg", "https://imagecdn3.allcpp.cn/rule.jpg"]);
});

test("detail errors retain the listing candidate and config validates adapter values", async () => {
  const candidate = { url: "https://mall.bilibili.com/?id=42", title: "列表标题", excerpt: "列表摘要", bodyText: "列表摘要", bodyStatus: "ok", media: [] } as never;
  const got = await enrichCandidate(candidate, "bilibili-show", "42", { url: `${root}/failed` });
  assert.equal(got.title, "列表标题");
  assert.equal(got.bodyText, "列表摘要");
  assert.deepEqual(unsupportedConfig("json_list", { detailAdapter: "bilibili-show" }), []);
  assert.deepEqual(unsupportedConfig("json_list", { detailAdapter: "unknown" }), ["detailAdapter=unknown"]);
});


test("allcpp listings carry the event id the detail API and page use, not the listing row id", async () => {
  const [candidate] = await fetchJsonList({ config: { url: `${root}/cpplist`, itemsPath: "result.list", titlePaths: ["name"], urlTemplate: "https://www.allcpp.cn/allcpp/event/event.do?event={eventId}", externalIdPath: "id", detailIdPath: "eventId" } } as never);
  assert.equal(candidate!.url, "https://www.allcpp.cn/allcpp/event/event.do?event=8210");
  assert.deepEqual(candidate!.raw, { externalId: 7445, detailId: 8210 });
});
