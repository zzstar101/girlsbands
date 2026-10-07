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
import { fitInside, ogImage } from "../apps/api/src/og/cover.ts";

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
const isGreen = (r: number, g: number, b: number) => g > 200 && r < 60 && b < 60;

/** 红底绿边：整张图都显示出来时，四条边应该条条都在 —— 只断言一个纯色块是看不出裁切的。 */
async function framed(width: number, height: number, frame: number): Promise<string> {
  const inner = await sharp({ create: { width: width - 2 * frame, height: height - 2 * frame, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
  const png = await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 255, b: 0 } } })
    .composite([{ input: inner, top: frame, left: frame }]).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** 四边中点（判断一张带边的图有没有被切掉一条边）。 */
async function edges(png: Buffer, at: { minX: number; maxX: number; minY: number; maxY: number }, inset = 1) {
  const midX = Math.round((at.minX + at.maxX) / 2);
  const midY = Math.round((at.minY + at.maxY) / 2);
  return [await pixel(png, midX, at.minY + inset), await pixel(png, midX, at.maxY - inset), await pixel(png, at.minX + inset, midY), await pixel(png, at.maxX - inset, midY)];
}

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
  assert.equal(posterEtag({ url: "https://girlsbands.com/items/x", kicker: "抽选", title: "T", summary: null, source: "S", date: "2026-10-05", selected: false, image: { data: red, ...POSTER_IMAGE } }).length, 24);
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

test("方图整张显示：按自己的比例缩到框里，四条边一条不少", async () => {
  const png = (await renderOg({ ...CARD, image: { data: await framed(400, 400, 12), ...CARD_IMAGE } })).png;
  const green = await box(png, isGreen);
  const red = await box(png, isRed);
  // 400×400 放进 390×260 的框：受高度限制，画成 260×260 的正方形（曾经是裁成 390×260 的一块）。
  assert.ok(Math.abs(green.width - green.height) <= 4, `方图不该被拉成长方形：${green.width}×${green.height}`);
  assert.ok(green.height >= 250 && green.height <= 262, `图该占满框的高度：${green.height}`);
  for (const edge of await edges(png, green)) assert.ok(isGreen(edge[0]!, edge[1]!, edge[2]!), `图的一条边被切掉了：${edge}`);
  assert.ok(red.minX > green.minX && red.maxX < green.maxX && red.minY > green.minY && red.maxY < green.maxY, "红心该完整地待在绿边里");
  assert.ok(green.maxX <= 1200 - 64 && green.maxY <= 630 - 64, "图不能伸进内边距");
});

test("宽图整张显示：横向铺满框、左右两条边都在", async () => {
  const png = (await renderOg({ ...CARD, image: { data: await framed(1600, 400, 16), ...CARD_IMAGE } })).png;
  const green = await box(png, isGreen);
  assert.ok(Math.abs(green.width - 390) <= 4, `宽图该铺满框的宽：${green.width}`);
  assert.ok(green.height >= 92 && green.height <= 102, `4:1 的图该比框矮：${green.height}`);
  assert.ok(Math.abs(green.width / green.height - 4) < 0.3, `比例该保持 4:1：${green.width}×${green.height}`);
  for (const edge of await edges(png, green)) assert.ok(isGreen(edge[0]!, edge[1]!, edge[2]!), `图的一条边被切掉了：${edge}`);
});

test("海报有图时头图占满内容宽度，且正文没有被挤出内边距", async () => {
  const blue = await solid(0, 0, 255, 1808, 640);
  const png = (await renderPoster({
    url: "https://girlsbands.com/items/x", kicker: "抽选", title: "MyGO!!!!! 追加公演", summary: "公告写明受理窗口与缴款期限。",
    source: "BanG Dream! 官方", date: "2026-10-05", selected: true, image: { data: blue, ...POSTER_IMAGE },
  })).png;
  const meta = await sharp(png).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1440]);

  const picture = await box(png, isBlue);
  // 头图框 856×400（POSTER_IMAGE）；纸片带一点倾斜，所以量出来的边会差几个像素。
  assert.ok(Math.abs(picture.width - 856) <= 4, `头图该铺满框的宽：${picture.width}`);
  assert.ok(Math.abs(picture.height - 303) <= 10, `1808×640 的图在 856 宽里该是 303 高：${picture.height}`);
  assert.ok(Math.abs((picture.minX + picture.maxX) / 2 - 1080 / 2) <= 4, "头图在海报里水平居中");

  // 纸片（米色卡）整张在海报里，头图在纸片上半部；头图下面、纸片里面有正文（深色字）。
  const paper = await box(png, (r, g, b) => r === 0xf3 && g === 0xef && b === 0xe6);
  assert.ok(paper.minX >= 40 && paper.maxX <= 1080 - 40 && paper.minY >= 24 && paper.maxY <= 1440 - 40, `纸片不能出画：${JSON.stringify(paper)}`);
  assert.ok(picture.minX > paper.minX && picture.maxX < paper.maxX && picture.minY > paper.minY, "头图在纸片里");
  assert.ok(picture.maxY < paper.maxY - 300, `头图下面要给正文和票根留地方：${picture.maxY} vs ${paper.maxY}`);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let text = 0;
  for (let y = picture.maxY + 20; y < paper.maxY - 40; y++) {
    for (let x = picture.minX + 20; x < picture.maxX - 20; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i]! < 120 && data[i + 1]! < 120 && data[i + 2]! < 120) text++;
    }
  }
  assert.ok(text > 2000, `头图下面该有正文：${text} 个深色像素`);
});

test("海报遇到竖图：整张显示，并在内容宽里居中", async () => {
  const png = (await renderPoster({
    url: "https://girlsbands.com/items/x", kicker: "抽选", title: "MyGO!!!!! 追加公演", summary: "公告写明受理窗口与缴款期限。",
    source: "BanG Dream! 官方", date: "2026-10-05", selected: true, image: { data: await framed(640, 1808, 48), ...POSTER_IMAGE },
  })).png;
  const green = await box(png, isGreen);
  assert.ok(Math.abs(green.height - 400) <= 4, `竖图该占满头图框的高：${green.height}`);
  assert.ok(green.width >= 136 && green.width <= 150, `640×1808 的图该窄于框宽：${green.width}`);
  assert.ok(Math.abs(green.width / green.height - 640 / 1808) < 0.02, `比例该保持 640:1808：${green.width}×${green.height}`);
  assert.ok(Math.abs((green.minX + green.maxX) / 2 - 1080 / 2) <= 4, "竖图该在框里居中");
  // 纸片微微倾斜，包围盒的边离图边差一两个像素，所以边框画厚一点、往里取 5 个像素。
  for (const edge of await edges(png, green, 5)) assert.ok(isGreen(edge[0]!, edge[1]!, edge[2]!), `图的一条边被切掉了：${edge}`);
});

test("图按自己的比例缩进框里：不裁切、不拉伸、也不把小图放大", () => {
  const box = CARD_IMAGE;
  assert.deepEqual(fitInside({ width: 780, height: 520 }, box), { width: 390, height: 260 }, "正好 3:2 的图铺满框");
  assert.deepEqual(fitInside({ width: 400, height: 400 }, box), { width: 260, height: 260 }, "方图受高度限制");
  assert.deepEqual(fitInside({ width: 1600, height: 400 }, box), { width: 390, height: 98 }, "宽图受宽度限制");
  assert.deepEqual(fitInside({ width: 336, height: 189 }, box), { width: 336, height: 189 }, "小图不放大（336 档就是原样）");
  assert.deepEqual(fitInside({ width: 640, height: 1808 }, POSTER_IMAGE), { width: 142, height: 400 }, "海报的竖图受高度限制");
});

test("取不到图时 ogImage 回 null（分享图退回纯文字卡）", async () => {
  assert.equal(await ogImage(null, CARD_IMAGE), null, "没有封面就没有图");
  const unreachable = { url: proxiedImage("http://127.0.0.1:1/never.jpg", "image-720")!, width: 780, height: 520 };
  assert.equal(await ogImage(unreachable, CARD_IMAGE), null, "上游取不到就退回纯文字");
});
