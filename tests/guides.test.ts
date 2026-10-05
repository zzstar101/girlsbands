// 远征参考页（/guide，W15）的出口：外链清单自己的约束，加上「别的模块也要读到它」的两处 —— sitemap 与分享图。
// Written from the ways it can go wrong:
// - 两份资料撞 id / 撞标题（页面卡片互相覆盖）；
// - href 写成 http、相对路径或二手转述页（点出去是内网、是登录墙、或者根本不是原作者）；
// - summary 太长（卡片标题被挤掉）或为空（只剩一个光链接）；
// - sitemap 里残留 /guide/<slug>（正文早就不写了，那些地址会 404）；
// - 分享图对页面对不上，或者旧攻略篇目的卡片没下线。
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@girlsbands/backend/db";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { sitemapXml } from "@girlsbands/backend/publication/sitemap";
import { GUIDE_PATH, GUIDE_RESOURCES } from "@girlsbands/industry/guides";
import { buildApp } from "../apps/api/src/app.ts";

const app = await buildApp();

after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

test("外链清单：id 与标题不重复、摘要写清用途、地址是 https", () => {
  assert.equal(GUIDE_PATH, "/guide");
  assert.ok(GUIDE_RESOURCES.length >= 2, "指路页至少要指两份资料（站主 2026-10-05 拍板）");
  const ids = new Set<string>();
  const titles = new Set<string>();
  const hrefs = new Set<string>();
  for (const r of GUIDE_RESOURCES) {
    assert.match(r.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${r.id} 是 URL 片段式的稳定 id`);
    assert.ok(!ids.has(r.id), `id ${r.id} 不重复`);
    assert.ok(!titles.has(r.title), `标题 ${r.title} 不重复`);
    assert.ok(!hrefs.has(r.href), `地址 ${r.href} 不重复`);
    ids.add(r.id);
    titles.add(r.title);
    hrefs.add(r.href);
    assert.ok(r.title.length > 0 && r.title.length <= 20, `${r.id} 的标题要短`);
    assert.ok(r.summary.length > 0 && r.summary.length <= 45, `${r.id} 的摘要一句话说清用途`);
    assert.ok(r.source.length > 0, `${r.id} 要写清谁写的`);
    // 只收公开可读的 https 页面：http 会被浏览器拦，相对路径点不出站。
    const url = new URL(r.href);
    assert.equal(url.protocol, "https:", `${r.id} 用 https`);
    assert.ok(url.hostname.includes("."), `${r.id} 是完整域名`);
  }
});

test("这些资料是外部页面：地址不落在本站路径上", () => {
  for (const r of GUIDE_RESOURCES) {
    assert.ok(!new URL(r.href).pathname.startsWith("/guide"), `${r.id} 不指向本站自己的 /guide`);
  }
});

test("sitemap 收 /guide 一次，且不再有 /guide/<slug>", async () => {
  const xml = await sitemapXml();
  assert.ok(xml.includes(`${GUIDE_PATH}</loc>`), "sitemap 有远征参考页");
  assert.ok(!/\/guide\/[a-z0-9-]+<\/loc>/.test(xml), "正文已下线：sitemap 里不该再有 /guide/<slug>");
});

test("分享图：页面对得上一张，旧攻略篇目的卡片已下线", async () => {
  const index = await app.inject({ method: "GET", url: "/og/pages/guide.png" });
  assert.equal(index.statusCode, 200);
  assert.match(String(index.headers["content-type"]), /^image\/png/);
  assert.equal((await app.inject({ method: "GET", url: "/og/pages/guide-tickets.png" })).statusCode, 404, "旧篇目卡片要下线");
  assert.equal((await app.inject({ method: "GET", url: "/og/pages/guide-nope.png" })).statusCode, 404);
});
