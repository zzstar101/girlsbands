// 镜像（志愿者的 Nitter 实例）挂掉时，存下来的 /pic/ 图片地址全部 502；同一张图在 pbs.twimg.com 上还在。
import assert from "node:assert/strict";
import { test } from "node:test";
import { unwrapNitterPicture } from "@girlsbands/backend/lib/image-url";

test("镜像的 /pic/ 地址：头像、正文图片、带域名、orig、enc 各种写法都还原成 pbs.twimg.com", () => {
  assert.equal(unwrapNitterPicture("http://nitter.meowing.monster/pic/https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F1942837312251203584%2FRYcSL-vj_400x400.jpg"), "https://pbs.twimg.com/profile_images/1942837312251203584/RYcSL-vj_400x400.jpg");
  assert.equal(unwrapNitterPicture("http://nitter.meowing.monster/pic/media%2FHUJsGOmacAAHiAl.jpg"), "https://pbs.twimg.com/media/HUJsGOmacAAHiAl.jpg");
  assert.equal(unwrapNitterPicture("https://nitter.kareem.one/pic/pbs.twimg.com%2Fmedia%2FHUTbkKEbwAA4Knb.jpg%3Fname%3Dsmall"), "https://pbs.twimg.com/media/HUTbkKEbwAA4Knb.jpg?name=small");
  assert.equal(unwrapNitterPicture("https://nitter.kareem.one/pic/orig/media%2FHUTbkKEbwAA4Knb.jpg"), "https://pbs.twimg.com/media/HUTbkKEbwAA4Knb.jpg");
  const enc = Buffer.from("https://pbs.twimg.com/media/HUTbkKEbwAA4Knb.jpg").toString("base64url");
  assert.equal(unwrapNitterPicture(`https://nitter.kareem.one/pic/enc/${enc}`), "https://pbs.twimg.com/media/HUTbkKEbwAA4Knb.jpg");
});

test("镜像的 /pic/ 地址：不是镜像图片代理的、或指向别的站的，原样不动", () => {
  assert.equal(unwrapNitterPicture("https://pbs.twimg.com/media/HUJsGOmacAAHiAl.jpg"), null);
  assert.equal(unwrapNitterPicture("https://nitter.meowing.monster/girlsbandcry/status/1"), null);
  assert.equal(unwrapNitterPicture("https://nitter.meowing.monster/pic/https%3A%2F%2Fevil.example%2Fa.jpg"), null);
  assert.equal(unwrapNitterPicture("https://example.com/pic/media%2Fa.jpg"), null);
  assert.equal(unwrapNitterPicture("not a url"), null);
});
