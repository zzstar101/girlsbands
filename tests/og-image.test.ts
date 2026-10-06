import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readable } from "@girlsbands/backend/content/extract";
import { imageFromField } from "@girlsbands/backend/sources/json-list";
import { fromHtml } from "@girlsbands/backend/sources/web-list";

const source = { config: { url: "https://events.example/list", itemSelector: ".event" } } as never;

test("article metadata provides the first usable image when body has no image", () => {
  const body = "这是一段足够长的活动公告正文。".repeat(20);
  const got = readable(`<html><head><meta property="og:image" content="/assets/logo-event.jpg"><meta name="twitter:image" content="/poster/event.jpg"></head><body><article><p>${body}</p></article></body></html>`, "https://events.example/events/1");
  assert.equal(got?.images[0]?.url, "https://events.example/poster/event.jpg");
  assert.equal(readable(`<html><head><meta property="og:image" content="/logo.svg"></head><body><article><p>${body}</p></article></body></html>`, "https://events.example/events/1")?.images.length, 0);
});

test("web listing cards capture src/data-src images while rejecting placeholders", () => {
  const got = fromHtml('<div class="event"><a href="/e/1">イベントのお知らせ</a><img src="/favicon.png"><img data-src="/poster/one.jpg"></div><div class="event"><a href="/e/2">別のイベント案内</a><img src="/no_image.png"></div>', "https://events.example/list", source);
  assert.equal(got[0]?.media?.[0]?.url, "https://events.example/poster/one.jpg");
  assert.deepEqual(got[1]?.media, undefined);
});

test("JSON image field resolves dotted paths, relative URLs, and placeholders", () => {
  assert.equal(imageFromField({ media: { cover: "/poster/a.jpg" } }, "media.cover", "https://events.example/api"), "https://events.example/poster/a.jpg");
  assert.equal(imageFromField({ media: { cover: "https://cdn.example/a.jpg" } }, "media.cover"), "https://cdn.example/a.jpg");
  assert.equal(imageFromField({ media: { cover: "/default.jpg" } }, "media.cover", "https://events.example/"), null);
  assert.equal(imageFromField({ media: { cover: "/poster/a.jpg" } }, "media.cover"), null);
});

