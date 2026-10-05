// 分享图上的公告图：签名地址怎么找回上游地址、图在卡片与海报里的位置、「取不到图就退回纯文字」。
//
// 位置用**像素**断言而不是看截图：模板里图的大小、内外边距一旦被改动（或者右栏换成别的东西），
// 这里会立刻红，不用等谁肉眼发现。项目里没有别的自动视觉核对手段。
import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { proxiedImage, proxySource } from "@girlsbands/backend/media/imgproxy";
import { CARD_IMAGE, ogEtag, renderOg } from "../apps/api/src/og/render.ts";
import { POSTER_IMAGE, posterEtag, renderPoster } from "../apps/api/src/og/poster.ts";
import { ogImage } from "../apps/api/src/og/cover.ts";

const CARD = {
  kicker: "抽选",
  title: "MyGO!!!!! 追加公演，FC 先行受理今天开始",
  subtitle: "官方公告写明了受理窗口、当落发表日与缴款期限。",
  meta: "BanG Dream! 官方 · 2026-10-05",
  badge: { value: "87", label: "精选评分" },
};

async function solid(r: number, g: number, b: number, width: number, height: number): Promise<string> {
  const png = await sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function pixel(png: Buffer, x: number, y: number): Promise<number[]> {
  const { data } = await sharp(png).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!];
}

/** 颜色匹配区域的包围盒（用来确认图确实落在模板给它的框里）。 */
async function box(png: Buffer, match: (r: number, g: number, b: number) => boolean) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (!match(data[i]!, data[i + 1]!, data[i + 2]!)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const isRed = (r: number, g: number, b: number) => r > 200 && g < 60 && b < 60;
const isBlue = (r: number, g: number, b: number) => b > 200 && r < 60 && g < 60;

test("proxySource 把签名地址里的 u 还原成上游地址", () => {
  const signed = proxiedImage("https://pbs.twimg.com/media/abc.jpg", "image-336");
  assert.equal(proxySource(signed), "https://pbs.twimg.com/media/abc.jpg");
  assert.equal(proxySource(null), null, "没有封面就没有上游地址");
  assert.equal(proxySource("/og/items/x.png"), null, "不是代理地址就取不到");
  assert.equal(proxySource("https://girlsbands.com/api/img-proxy?mode=image-336"), null, "缺 u 参数就取不到");
});

test("卡片与海报的 ETag 跟着图走：同样字节同样指纹，换了图就换指纹", async () => {
  const red = await solid(255, 0, 0, 780, 520);
  const blue = await solid(0, 0, 255, 780, 520);
  const withRed = { ...CARD, image: { data: red, ...CARD_IMAGE } };
  assert.equal(ogEtag(withRed), ogEtag({ ...CARD, image: { data: red, ...CARD_IMAGE } }));
  assert.notEqual(ogEtag(withRed), ogEtag({ ...CARD, image: { data: blue, ...CARD_IMAGE } }), "换了图就该出新的图");
  assert.notEqual(ogEtag(withRed), ogEtag({ ...CARD, image: null }), "有没有图是两张卡");
  assert.equal(ogEtag(withRed).length, 24);
  assert.equal(posterEtag({ url: "https://girlsbands.com/items/x", kicker: "抽选", title: "T", summary: null, source: "S", date: "2026-10-05", score: null, image: { data: red, ...POSTER_IMAGE } }).length, 24);
});

test("卡片有图时图落在右栏、不越出内边距，没图时那一栏是空的", async () => {
  const red = await solid(255, 0, 0, 780, 520);
  const png = (await renderOg({ ...CARD, image: { data: red, ...CARD_IMAGE } })).png;
  const meta = await sharp(png).metadata();
  assert.deepEqual([meta.width, meta.height], [1200, 630]);

  const picture = await box(png, isRed);
  // 390×260 的框，图与框之间有 1px 描边，所以红区比框小一圈。
  assert.ok(Math.abs(picture.width - 388) <= 2, `图宽该是 390 的框：${picture.width}`);
  assert.ok(Math.abs(picture.height - 258) <= 2, `图高该是 260 的框：${picture.height}`);
  assert.ok(picture.maxX <= 1200 - 64, "图不能伸进右内边距");
  assert.ok(picture.maxY <= 630 - 64, "图不能压到底部内边距");
  assert.ok(picture.minX > 600, "图在右栏，不跟左边文字抢位置");

  const inside = await pixel(png, Math.round((picture.minX + picture.maxX) / 2), Math.round((picture.minY + picture.maxY) / 2));
  assert.ok(isRed(inside[0]!, inside[1]!, inside[2]!), `图中心该是图本身：${inside}`);
  const onLeft = await pixel(png, 300, Math.round((picture.minY + picture.maxY) / 2));
  assert.ok(!isRed(onLeft[0]!, onLeft[1]!, onLeft[2]!), `左栏不该被图盖住：${onLeft}`);

  const plain = (await renderOg({ ...CARD, image: null })).png;
  const same = await pixel(plain, Math.round((picture.minX + picture.maxX) / 2), Math.round((picture.minY + picture.maxY) / 2));
  assert.ok(!isRed(same[0]!, same[1]!, same[2]!), `没图的卡片这里应该是底：${same}`);
});

test("海报有图时头图占满内容宽度，且正文没有被挤出内边距", async () => {
  const blue = await solid(0, 0, 255, 1808, 640);
  const png = (await renderPoster({
    url: "https://girlsbands.com/items/x", kicker: "抽选", title: "MyGO!!!!! 追加公演", summary: "公告写明受理窗口与缴款期限。",
    source: "BanG Dream! 官方", date: "2026-10-05", score: 87, image: { data: blue, ...POSTER_IMAGE },
  })).png;
  const meta = await sharp(png).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1440]);

  const picture = await box(png, isBlue);
  assert.equal(picture.minX, 88, "头图左边对齐内容左边距");
  assert.ok(Math.abs(picture.width - 904) <= 2, `头图该是内容宽：${picture.width}`);
  assert.ok(Math.abs(picture.height - 320) <= 2, `头图该是 320 高：${picture.height}`);
  assert.equal(picture.maxX, 1080 - 89, "头图右边对齐内容右边距");

  // 正文与二维码都在头图下面：最靠下的深色像素（标题、摘要、来源、二维码、页脚）不能越过底部内边距。
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let lowest = -1;
  for (let y = info.height - 1; y >= 0 && lowest < 0; y--) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i]! < 120 && data[i + 1]! < 120 && data[i + 2]! < 120) { lowest = y; break; }
    }
  }
  assert.ok(lowest <= 1440 - 72, `正文不能越过底部内边距：${lowest}`);
  assert.ok(lowest > picture.maxY + 100, `正文确实在头图下面：${lowest} vs ${picture.maxY}`);
});

test("取不到图时 ogImage 回 null（分享图退回纯文字卡）", async () => {
  assert.equal(await ogImage(null, CARD_IMAGE), null, "没有封面就没有图");
  const unreachable = { url: proxiedImage("http://127.0.0.1:1/never.jpg", "image-720")!, width: 780, height: 520 };
  assert.equal(await ogImage(unreachable, CARD_IMAGE), null, "上游取不到就退回纯文字");
});
