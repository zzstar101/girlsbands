// 邮件顶部的「通栏头图」：**官方 logo + 应援色底板 + 巨号日号**，用户从三稿里挑中的那一版
// （他的原稿是 .data/event-mail-v1/build.ts，1200×450 的 SVG；这里是同一份几何用 satori 重画）。
//
// 版面（坐标逐条对着用户那版 SVG，只把「基线 y」换算成 CSS 上沿）：
//   左上 `ANIBAND RADAR` 22px 粗、字距 3｜右上 `EVENT SUBSCRIPTION` 20px 字距 2
//   → 右上角 220px 的鬼影日号（应援色/墨色，透明度 .13）→ 中间偏上 650×215 的官方 logo
//   → y332 一条 1px 细线 → 左下乐队名 24px 粗 → 它下面 `LIVE / TICKET / RELEASE` 17px 字距 3
//   → 右下 `10 / 04 · JST` 24px。整版左右对齐在 x=64（HERO_PAD）。
//
// 为什么底不能直接用应援色：逐像素量过 19 支官方 logo，只有 4 支的墨迹能直接压在应援色上，
// 其余各支的应援色都是中间调，墨迹对比度掉到 1.5:1 上下。所以按「丢掉多少墨迹」在四块底里挑一块
// （见 plateFor），另有 4 支按用户那版画廊里的实际效果手工覆盖（PLATE_OVERRIDE）。
//
// 为什么装饰层交给 sharp：satori 的 <svg> 只认「属性直接写在 props 上」的写法（h() 会把第二个参数
// 塞进 style，图形会整片消失），而且不支持 <text> 与 polygon。装饰里有 stroke、圆环、斜切多边形，
// 与其一条条改写，不如让 librsvg 栅格化（sharp 自带），再把整层当一张 PNG 贴回 satori——
// 实测 satori 只认 JPEG/PNG 的 data URI，**WebP 会被静默丢掉**，所以这里一律 PNG。
//
// 画布 1200×450，是因为邮件里按 600×225 显示——2 倍图在高分屏上才是清的。图由 API 现画，
// 地址是 /og/email/<token>.png，token 就是那份 spec 的 base64url（见 industry/email/hero.ts）；
// 同一份 spec 永远命中同一个磁盘缓存。
//
// 为什么不在这里出网：logo 是 scripts/fetch-band-logos.ts 抓一次入库的静态资源，渲染时只读磁盘。
// 这条公开路由过去会照着 token 里的 URL 去外网取图，现在 token 里只有一个受形状约束的乐队 id
// （见 industry/email/hero.ts 的 logoId），取图那一段的 SSRF 面随之整个消失。
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { REPO_ROOT } from "@aihot/backend/config";
import { SITE } from "@aihot/industry/site";
import { dateParts, HERO_H, HERO_PAD, HERO_W, type HeroSpec } from "@aihot/industry/email/hero";
import { inkOn } from "@aihot/industry/email/layout";
import { h, JP_FAMILY, renderPng, type Node } from "./render.ts";

/** 画面改一次就升一次：它是 ETag 与磁盘缓存的一部分，不升的话旧图会一直被命中。 */
export const HERO_TEMPLATE_VERSION = "hero-2026-10-04.16";

/**
 * 基线 → CSS 上沿。Noto Sans JP 的 hhea ascender/descender 是 1160/288（每 em 1000），
 * 行盒高度设为 1em 时基线落在行盒的 93.6% 处，所以 `top = baseline - 0.936 × fontSize`。
 * 所有文字节点都必须显式写 `lineHeight: 1`，否则 satori 的默认行高会把这个换算推翻。
 */
const BASELINE_RATIO = 0.936;
const topOf = (baseline: number, size: number): number => Math.round(baseline - size * BASELINE_RATIO);

const BRAND_SIZE = 22;
const BRAND_TRACK = 3;
const BRAND_BASE = 66;
const KIND_SIZE = 20;
const KIND_TRACK = 2;
const KIND_BASE = 66;
const GHOST_SIZE = 220;
const GHOST_TRACK = -12;
const GHOST_BASE = 292;
const GHOST_ALPHA = 0.13;
const NAME_SIZE = 24;
const NAME_BASE = 365;
const TAG_SIZE = 17;
const TAG_TRACK = 3;
const TAG_BASE = 405;
const TAG_ALPHA = 0.7;
const STAMP_SIZE = 24;
const STAMP_BASE = 398;
const RULE_Y = 332;
const RULE_ALPHA = 0.18;
/** logo 的显示框与垂直中心（用户那版：塞进 650×215，中心压在 y=203）。 */
const LOGO_W = 650;
const LOGO_H = 215;
const LOGO_CENTER_Y = 203;
/** 画面上写死的三处固定词。站名从 SITE 取，不在这里另写一个。 */
const BRAND_WORDS = SITE.name.toUpperCase();
const KIND_WORDS = "EVENT SUBSCRIPTION";
const TAG_WORDS = "LIVE / TICKET / RELEASE";

/** 大块图形按 WCAG 的 3:1（正文字才要 4.5:1）。 */
const MIN_CONTRAST = 3;
/** alpha 低于这个值的像素不算墨迹（抗锯齿的边缘会把亮度分布拉平）。 */
const INK_ALPHA = 200;
/**
 * 墨迹亮度直方图的桶数。桶里按**均值**判对比度，所以桶越粗越保守：16 桶时一个横跨阈值的桶
 * 会把桶内其实看得清的高光墨迹也算成看不清（实测 Pastel*Palettes 因此被多推暗两档）。
 * 64 桶（桶宽 0.0156）之后，直方图算出来的丢墨比例与逐像素精确值基本一致。
 */
const BINS = 64;
/** 深色底的门槛：相对亮度低于它就用亮字。 */
const DARK_LIMIT = 0.3;
/** 近黑底板。白、近黑两块是无彩色，跟浅板/深板一起比「谁丢的墨迹少」。 */
const DARK_PLATE = "#111113";
/** 浅板 = 应援色兑白 88%，深板 = 应援色兑黑 82%（即每通道 ×0.18）。 */
const PALE_MIX = 0.12;
const DEEP_MIX = 0.18;

/**
 * 用户那版画廊里手工定下的四块底（其余 15 支走 plateFor 的度量）。
 * 来源是 .data/event-mail-v1/build.ts；改了就要重跑 19 支的对照图，别凭印象动。
 */
export const PLATE_OVERRIDE: Record<string, string> = {
  mygo: "#102b3b",
  "togenashi-togeari": "#111113",
  "ave-mujica": "#f0e3e8",
  "pastel-palettes": "#fff8fc",
};

const LOGO_DIR = path.join(REPO_ROOT, "assets", "band-logos");
const MANIFEST = "manifest.json";

/** manifest 里一条 logo 的记录。形状在这里二次校验。 */
interface StoredLogo {
  file: string;
  width: number;
  height: number;
  /** 处理后 PNG 的 sha256；进 etag，所以换了 logo 文件就不会再命中旧缓存。 */
  sha256: string;
}

/** 墨迹亮度直方图：64 桶，每桶存像素数与亮度之和。 */
interface InkHist {
  count: number[];
  sum: number[];
}

interface LogoImage extends StoredLogo {
  /** 原始 PNG 字节。合成底板时要交给 sharp 缩放，所以留字节而不是 data URI。 */
  png: Buffer;
  hist: InkHist | null;
}

/**
 * 读 manifest。读不到就返回空表——**这不是错误**：仓库还没跑过抓取脚本时，全员安静地退回
 * 只有文字的版本，而不是让 /og/email/ 500。空表不缓存，所以抓取脚本跑完不必重启 API 也能读到。
 */
async function loadLogos(): Promise<Map<string, StoredLogo>> {
  const map = new Map<string, StoredLogo>();
  try {
    const raw = JSON.parse(await readFile(path.join(LOGO_DIR, MANIFEST), "utf8")) as { logos?: Record<string, unknown> };
    for (const [id, value] of Object.entries(raw.logos ?? {})) {
      const e = value as Partial<StoredLogo>;
      // 文件名必须就是 <id>.png：清单被写脏时宁可少一张 logo，也不许拿它去拼路径。
      if (typeof e.file !== "string" || e.file !== `${id}.png`) continue;
      if (!Number.isFinite(e.width) || !Number.isFinite(e.height) || !e.width || !e.height) continue;
      map.set(id, {
        file: e.file,
        width: e.width as number,
        height: e.height as number,
        sha256: typeof e.sha256 === "string" ? e.sha256 : "",
      });
    }
  } catch {
    /* 没抓过 / 文件缺失：退回只有文字的版本。 */
  }
  return map;
}

let logosPromise: Promise<Map<string, StoredLogo>> | null = null;
const images = new Map<string, Promise<LogoImage | null>>();

function storedLogos(): Promise<Map<string, StoredLogo>> {
  if (!logosPromise) {
    logosPromise = loadLogos().then((map) => {
      if (map.size === 0) logosPromise = null;
      return map;
    });
  }
  return logosPromise;
}

/** sRGB 线性化后的单通道权重（WCAG 相对亮度）。 */
function lin(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function lumOf(r: number, g: number, b: number): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 相对亮度 0..1。只认 #rrggbb——spec 里的颜色已被 normalizeHero 校验过。 */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = Number.parseInt(m[1] as string, 16);
  return lumOf((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** 在 sRGB 空间混合两色：t=0 全 a，t=1 全 b。浅板/深板都是它兑出来的。 */
function mix(a: string, b: string, t: number): string {
  const x = Number.parseInt(a.slice(1), 16);
  const y = Number.parseInt(b.slice(1), 16);
  const channel = (shift: number): string => {
    const va = (x >> shift) & 255;
    const vb = (y >> shift) & 255;
    return Math.round(va * (1 - t) + vb * t)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** `#rrggbb` + 透明度 → satori 认的 `rgba()`。鬼影日号与细线都靠它压淡，而不是换一个颜色。 */
function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 逐像素量墨迹的亮度分布。量不出来（图坏了）返回 null，那时退回「应援色直接当底」。 */
async function inkHist(png: Buffer): Promise<InkHist | null> {
  try {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const count = new Array<number>(BINS).fill(0);
    const sum = new Array<number>(BINS).fill(0);
    for (let i = 0; i < info.width * info.height; i++) {
      const o = i * info.channels;
      if ((data[o + 3] ?? 0) <= INK_ALPHA) continue;
      const L = lumOf(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
      const bin = Math.min(BINS - 1, Math.floor(L * BINS));
      count[bin] += 1;
      sum[bin] += L;
    }
    return count.some((c) => c > 0) ? { count, sum } : null;
  } catch {
    return null;
  }
}

/** 这块底上有多少比例的墨迹读不清（对比度 < 3:1）。按桶均值算，不用桶中心，免得把纯黑算亮。 */
function unreadable(hist: InkHist, bg: number): number {
  let total = 0;
  let bad = 0;
  for (let b = 0; b < BINS; b++) {
    const n = hist.count[b] ?? 0;
    if (n === 0) continue;
    total += n;
    if (contrast((hist.sum[b] ?? 0) / n, bg) < MIN_CONTRAST) bad += n;
  }
  return total === 0 ? 0 : bad / total;
}

/** 把一支乐队的 logo 读成字节，并顺手量出它的墨迹亮度分布。 */
function logoImage(id: string): Promise<LogoImage | null> {
  const cached = images.get(id);
  if (cached) return cached;
  const p = (async (): Promise<LogoImage | null> => {
    const entry = (await storedLogos()).get(id);
    if (!entry) return null;
    try {
      const png = await readFile(path.join(LOGO_DIR, entry.file));
      return { ...entry, png, hist: await inkHist(png) };
    } catch {
      // 清单里有、文件不在：说明仓库状态不自洽。退回只有文字的版本，不是错误。
      return null;
    }
  })();
  images.set(id, p);
  return p;
}

/**
 * 挑底：手工覆盖 → 量出来哪块丢的墨迹最少。
 *
 * 候选四块（用户那版的配方）：应援色兑白 88% 的浅板、应援色 ×0.18 的深板、站点的白、近黑。
 * 顺序就是平局时的优先序：能压在浅板上就不压深板，能压白就不压近黑。
 * 没有 logo（没有可量的墨迹）时退回应援色本身——那版面上只有文字，压在应援色上一定读得清。
 */
export function plateFor(spec: HeroSpec, logo: LogoImage | null): string {
  const override = spec.logo ? PLATE_OVERRIDE[spec.logo] : undefined;
  if (override) return override;
  const hist = logo?.hist ?? null;
  if (!hist) return spec.accent;
  const candidates = [
    mix(spec.accent, spec.surface, 1 - PALE_MIX),
    mix(spec.accent, "#000000", 1 - DEEP_MIX),
    spec.surface,
    DARK_PLATE,
  ];
  let best = candidates[0] as string;
  let bestLoss = unreadable(hist, luminance(best));
  for (const c of candidates.slice(1)) {
    const loss = unreadable(hist, luminance(c));
    if (loss < bestLoss) {
      best = c;
      bestLoss = loss;
    }
  }
  return best;
}

/** 装饰层：默认 16 条斜线，另有三支/五支乐队各有自己的图案（照用户那版原样搬过来）。 */
function deco(id: string | null, graphic: string, accent: string): string {
  if (id === "ave-mujica" || id === "roselia") {
    return (
      `<path d="M28 96V38H1172V96 M28 354V422H1172V354" fill="none" stroke="${accent}" stroke-width="2" opacity="0.4"/>` +
      `<circle cx="992" cy="220" r="154" fill="none" stroke="${accent}" opacity="0.15"/>` +
      `<circle cx="992" cy="220" r="138" fill="none" stroke="${accent}" opacity="0.15"/>`
    );
  }
  if (id === "togenashi-togeari" || id === "raise-a-suilen" || id === "afterglow") {
    return `<path d="M990 0H1105L855 450H740Z M1150 0H1190L940 450H900Z" fill="${accent}" opacity="0.5"/>`;
  }
  if (id === "pastel-palettes") {
    return (
      `<circle cx="1030" cy="220" r="180" fill="#dff6ea"/>` +
      `<circle cx="1050" cy="208" r="146" fill="none" stroke="#a4d9c2" stroke-width="2"/>` +
      `<path d="M788 0L1200 0L1200 142Z" fill="#f6e1ee"/>` +
      `<path d="M835 340L1200 340L1200 450L980 450Z" fill="#ecf8f0"/>`
    );
  }
  let lines = "";
  for (let i = 0; i < 16; i++) {
    lines += `<path d="M ${785 + i * 32} 92 L ${570 + i * 32} 365" stroke="${graphic}" opacity="0.07" stroke-width="2"/>`;
  }
  return lines;
}

/** 底板：一块纯色 + 装饰，再把官方 logo 按 650×215 塞进去、垂直中心压在 y=203。 */
async function baseLayer(spec: HeroSpec, plate: string, logo: LogoImage | null): Promise<string> {
  const on = inkOn(plate, spec.ink, spec.surface);
  const graphic = luminance(plate) < DARK_LIMIT ? spec.accent : on;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${HERO_W}" height="${HERO_H}" viewBox="0 0 ${HERO_W} ${HERO_H}">` +
    `<rect width="${HERO_W}" height="${HERO_H}" fill="${plate}"/>` +
    `${deco(spec.logo, graphic, spec.accent)}</svg>`;
  const layers: OverlayOptions[] = [];
  if (logo) {
    // fit:"inside" 会等比缩到框内（sharp 默认允许放大），所以小字标也能占满这块视觉中心。
    const { data, info } = await sharp(logo.png)
      .resize({ width: LOGO_W, height: LOGO_H, fit: "inside" })
      .png()
      .toBuffer({ resolveWithObject: true });
    layers.push({ input: data, left: HERO_PAD, top: Math.round(LOGO_CENTER_Y - info.height / 2) });
  }
  const png = await sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * 文字层。所有节点都绝对定位、`lineHeight: 1`，坐标由 topOf() 从基线换算。
 * 没有日期（确认信那种）就不画鬼影日号与右下角那行——空着比编一个日期强。
 */
function heroTree(spec: HeroSpec, plate: string, base: string): Node {
  const on = inkOn(plate, spec.ink, spec.surface);
  const graphic = luminance(plate) < DARK_LIMIT ? spec.accent : on;
  const { day, line } = dateParts(spec.date);
  const text = (style: Record<string, unknown>, content: string): Node =>
    h("div", { position: "absolute", display: "flex", lineHeight: 1, fontFamily: JP_FAMILY, ...style }, content);
  const rows: (Node | null)[] = [
    h("img", { position: "absolute", top: 0, left: 0, width: HERO_W, height: HERO_H }, null, { src: base }),
    text({ top: topOf(BRAND_BASE, BRAND_SIZE), left: HERO_PAD, fontSize: BRAND_SIZE, fontWeight: 700, letterSpacing: BRAND_TRACK, color: on }, BRAND_WORDS),
    text({ top: topOf(KIND_BASE, KIND_SIZE), right: HERO_PAD, fontSize: KIND_SIZE, letterSpacing: KIND_TRACK, color: on }, KIND_WORDS),
    day
      ? text(
          { top: topOf(GHOST_BASE, GHOST_SIZE), right: HERO_PAD - 2, fontSize: GHOST_SIZE, fontWeight: 700, letterSpacing: GHOST_TRACK, color: rgba(graphic, GHOST_ALPHA) },
          day,
        )
      : null,
    h("div", { position: "absolute", top: RULE_Y, left: HERO_PAD, right: HERO_PAD, height: 1, display: "flex", backgroundColor: rgba(on, RULE_ALPHA) }),
    text({ top: topOf(NAME_BASE, NAME_SIZE), left: HERO_PAD, fontSize: NAME_SIZE, fontWeight: 700, color: on }, spec.star),
    text({ top: topOf(TAG_BASE, TAG_SIZE), left: HERO_PAD, fontSize: TAG_SIZE, letterSpacing: TAG_TRACK, color: rgba(on, TAG_ALPHA) }, TAG_WORDS),
    line ? text({ top: topOf(STAMP_BASE, STAMP_SIZE), right: HERO_PAD, fontSize: STAMP_SIZE, color: on }, line) : null,
  ];
  return h(
    "div",
    { width: HERO_W, height: HERO_H, display: "flex", position: "relative", overflow: "hidden", backgroundColor: plate, fontFamily: JP_FAMILY },
    rows.filter((row): row is Node => row !== null),
  );
}

/**
 * 内容寻址：同一份 spec（含模板版本与站名）永远同一个 etag，也就是同一个缓存文件。
 *
 * `logoHash` 是那张 logo 的 sha256，必须一起进哈希：缓存文件只按 etag 命名，如果 etag 只看 spec，
 * 那么换掉某支乐队的 logo 文件之后，旧 spec 会一直命中旧图——画面改了、磁盘上却还是老 logo，
 * 而且**不报任何错**（这个坑已经在探针里踩过一次：改了挑底规则没升模板版本，量到的还是上一轮的字節）。
 */
export function heroEtag(spec: HeroSpec, logoHash = ""): string {
  return createHash("sha256")
    .update(HERO_TEMPLATE_VERSION)
    .update(SITE.name)
    .update(JSON.stringify(spec))
    .update(logoHash)
    .digest("hex")
    .slice(0, 24);
}

/**
 * 头图的 PNG 字节；这张 spec 画过就从磁盘缓存取，并发请求共用一次渲染（renderPng 负责）。
 *
 * logo 先加载再算 etag，所以 etag 覆盖了这张 logo 的实际字节；`logoImage()` 自己有内存缓存，
 * 这一步不会多读盘。
 *
 * `plateOverride` 只给 `.data/` 里的对照探针用：同一个 spec 换几块底画出来比给人看。
 * 生产调用一律不传——不传时底由 `plateFor()` 按墨迹对比度量出来；传了的话它进 ETag，
 * 否则磁盘缓存会把几种底当成同一张图、命回旧的那张。
 */
export async function renderHero(spec: HeroSpec, plateOverride?: string): Promise<{ png: Buffer; etag: string }> {
  const logo = spec.logo ? await logoImage(spec.logo) : null;
  if (plateOverride !== undefined && !/^#[0-9a-f]{6}$/i.test(plateOverride)) throw new Error(`bad plate override: ${plateOverride}`);
  const etag = heroEtag(spec, `${logo?.sha256 ?? ""}${plateOverride ?? ""}`);
  const plate = plateOverride ?? plateFor(spec, logo);
  const tree = async (): Promise<Node> => heroTree(spec, plate, await baseLayer(spec, plate, logo));
  return { png: await renderPng(etag, { width: HERO_W, height: HERO_H }, tree), etag };
}
