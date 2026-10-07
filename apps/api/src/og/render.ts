// 1200×630 share images. satori lays out text with Noto Sans SC (assets/og-fonts) and emits glyphs
// as paths, so rasterising with sharp needs no system fonts. Output is cached on disk by content.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import satori from "satori";
import sharp from "sharp";
import { config, REPO_ROOT } from "@girlsbands/backend/config";
import { SITE } from "@girlsbands/industry/site";

export const OG_TEMPLATE_VERSION = "og-2026-10-05.5";
const WIDTH = 1200;
const HEIGHT = 630;
const CACHE_DIR = path.join(config.dataDir, "ogcache");
/** The right-hand picture's box on a card (3:2): the picture is fitted inside it, never cropped. */
const IMAGE_WIDTH = 390;
const IMAGE_HEIGHT = 260;
/** The box itself, for callers that fetch the bytes (see og/cover.ts) — `OgImage.width`/`height` are the fitted size. */
export const CARD_IMAGE = { width: IMAGE_WIDTH, height: IMAGE_HEIGHT } as const;

/**
 * A picture already inline as a data URL: satori never fetches, and the card renders with no network.
 * `width`/`height` are the size it is *drawn* at — already fitted into the box by the caller, so its own
 * aspect ratio survives (see og/cover.ts).
 */
export interface OgImage {
  data: string;
  width: number;
  height: number;
}

export interface OgCard {
  kicker: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  /** Small emphasised figure on the right (e.g. an item score). */
  badge?: { value: string; label: string } | null;
  accent?: "teal" | "hot" | "amber";
  /** The announcement's own picture; a card without one is exactly the card it was before. */
  image?: OgImage | null;
}

/** 简体字族：中文标签走它。 */
export const CN_FAMILY = "Noto Sans SC";
/** 日文字族：乐队名走它——假名与日文汉字跟简体是两套字形，而且 GB2312 子集里根本没有 結/夢/楽。 */
export const JP_FAMILY = "Noto Sans JP";
/** 显示字族：头图上的乐队名与大字日期走它（超粗黑海报体）。只有名字与数字的字形，
 *  中文标签（「48 小时内」「日本时间 JST」）必须留在 CN_FAMILY，混用会出豆腐块。 */
export const DISPLAY_FAMILY = "Dela Gothic One";
/** 品牌字族：**只画站名一个词**（邮件头图左上角、分享图与海报的角标）。子集只收 `SITE.name`
 *  里的字（见 scripts/og/build-og-jp-font.ts 的 brandCharset()），别的词用它就会画成豆腐块。 */
export const BRAND_FAMILY = "ZCOOL KuaiLe";
/** 拉丁显示字族：Anton，和网站 --font-display 同款。子集只有拉丁、数字与标点。 */
export const LATIN_DISPLAY_FAMILY = "Anton";

let fontsPromise: Promise<Array<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" }>> | null = null;

// satori 0.33.5 按 fontFamily 选字族，缺字时按列表顺序逐字回退（列表顺序不影响字族选择）。
// 所以四个子集都要注册：日文名缺字回退到 SC，中文标签缺字回退到 JP。
function fonts() {
  fontsPromise ??= Promise.all([
    readFile(path.join(REPO_ROOT, "assets/og-fonts/noto-sans-sc-400.ttf")),
    readFile(path.join(REPO_ROOT, "assets/og-fonts/noto-sans-sc-700.ttf")),
    readFile(path.join(REPO_ROOT, "assets/og-fonts/noto-sans-jp-400.ttf")),
    readFile(path.join(REPO_ROOT, "assets/og-fonts/noto-sans-jp-700.ttf")),
    readFile(path.join(REPO_ROOT, "assets/og-fonts/dela-gothic-one.ttf")),
    readFile(path.join(REPO_ROOT, "assets/og-fonts/zcool-kuaile.ttf")),
    readFile(path.join(REPO_ROOT, "assets/og-fonts/anton.ttf")),
  ]).then(([scRegular, scBold, jpRegular, jpBold, display, brand, anton]) => [
    { name: CN_FAMILY, data: scRegular, weight: 400, style: "normal" },
    { name: CN_FAMILY, data: scBold, weight: 700, style: "normal" },
    { name: JP_FAMILY, data: jpRegular, weight: 400, style: "normal" },
    { name: JP_FAMILY, data: jpBold, weight: 700, style: "normal" },
    // 显示字体只有一个字重，两档都注册成它，免得 satori 按 700 找不到字族又回退。
    { name: DISPLAY_FAMILY, data: display, weight: 400, style: "normal" },
    { name: DISPLAY_FAMILY, data: display, weight: 700, style: "normal" },
    // 品牌字体同样只有一个字重，两档都注册。
    { name: BRAND_FAMILY, data: brand, weight: 400, style: "normal" },
    { name: BRAND_FAMILY, data: brand, weight: 700, style: "normal" },
    { name: LATIN_DISPLAY_FAMILY, data: anton, weight: 400, style: "normal" },
    { name: LATIN_DISPLAY_FAMILY, data: anton, weight: 700, style: "normal" },
  ]);
  return fontsPromise;
}

export type Node = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
export const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({ type, props: { style, children, ...extra } });

/** The site's host as shown on cards. */
export const SITE_HOST = new URL(config.siteUrl).host;

/** The site name as a wordmark: bold, with the accent dot the cards use. */
export function nameMark(size: number, color: string, dot: string): Node {
  return h("div", { display: "flex", alignItems: "center" }, [
    h("div", { width: size * 0.36, height: size * 0.36, borderRadius: 999, backgroundColor: dot, marginRight: size * 0.28 }),
    h("div", { display: "flex", fontFamily: BRAND_FAMILY, fontSize: size, fontWeight: 700, color, letterSpacing: 0.5 }, SITE.name),
  ]);
}

const ACCENTS = { teal: "#2ce2e8", hot: "#ff7a5f", amber: "#e2b454" } as const;

export function clamp(text: string, max: number) {
  const chars = [...text.replace(/\s+/g, " ").trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

async function tree(card: OgCard): Promise<Node> {
  const accent = ACCENTS[card.accent ?? "teal"];
  const image = card.image ?? null;
  // With a picture the text column keeps about half the width, so the title clamps earlier: three lines
  // at 44px are what fits beside the image and above the footer.
  const title = clamp(card.title, image ? 30 : 64);
  const titleSize = image
    ? [...title].length > 20 ? 44 : 52
    : [...title].length > 40 ? 50 : [...title].length > 24 ? 58 : 66;
  const subtitle = card.subtitle
    ? clamp(card.subtitle, image ? 34 : [...title].length > 40 ? 26 : [...title].length > 24 ? 50 : 78)
    : null;
  // The badge has no room beside the picture, so it moves into the footer as a pill.
  const footer = image
    ? card.meta || card.badge
      ? h("div", { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, fontSize: 24, color: "#82939a", borderTop: "1px solid rgba(230,237,237,0.12)", paddingTop: 22 }, [
          card.meta ? h("div", { display: "flex" }, clamp(card.meta, 70)) : null,
          card.badge ? h("div", { display: "flex", alignItems: "center", padding: "2px 16px", borderRadius: 999, border: `2px solid ${accent}`, color: "#ffffff" }, `${card.badge.label} ${card.badge.value}`) : null,
        ].filter(Boolean))
      : null
    : card.meta
      ? h("div", { display: "flex", fontSize: 24, color: "#82939a", borderTop: "1px solid rgba(230,237,237,0.12)", paddingTop: 22 }, clamp(card.meta, 70))
      : null;
  return h(
    "div",
    {
      width: WIDTH,
      height: HEIGHT,
      display: "flex",
      flexDirection: "column",
      padding: "64px 72px",
      fontFamily: "Noto Sans SC",
      color: "#e6eded",
      backgroundColor: "#0a1012",
      backgroundImage: "radial-gradient(circle at 88% 8%, rgba(44,226,232,0.28), rgba(10,16,18,0) 46%), radial-gradient(circle at 0% 100%, rgba(23,107,117,0.35), rgba(10,16,18,0) 50%)",
    },
    [
      h("div", { display: "flex", alignItems: "center", justifyContent: "space-between" }, [
        nameMark(46, "#e6eded", "#2ce2e8"),
        h("div", { display: "flex", fontSize: 24, color: "#82939a" }, SITE_HOST),
      ]),
      h("div", { display: "flex", marginTop: 56, alignItems: "center" }, [
        h("div", { width: 10, height: 10, borderRadius: 999, backgroundColor: accent, marginRight: 14 }),
        h("div", { display: "flex", fontSize: 28, fontWeight: 700, color: accent, letterSpacing: 1 }, clamp(card.kicker, 30)),
      ]),
      h("div", { display: "flex", flex: 1, marginTop: 22, gap: 40 }, [
        h("div", { display: "flex", flexDirection: "column", flex: 1 }, [
          h("div", { display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: 1.25, color: "#ffffff" }, title),
          // Long titles take three lines; the summary then gets one line so nothing reaches the footer.
          subtitle ? h("div", { display: "flex", marginTop: image ? 18 : 22, fontSize: image ? 26 : 28, lineHeight: 1.5, color: "#b1bec0" }, subtitle) : null,
        ].filter(Boolean)),
        image
          ? h("div", { display: "flex", alignItems: "center", justifyContent: "center", width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
              // The picture is scaled to fit inside this box, never cropped, so a portrait announcement
              // shows up whole with the box's background on either side.
              h("img", { width: image.width, height: image.height, objectFit: "contain", borderRadius: 20, border: "1px solid rgba(230,237,237,0.12)" }, undefined, { src: image.data, width: image.width, height: image.height }))
          : card.badge
            ? h("div", { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 170, height: 170, borderRadius: 999, border: `6px solid ${accent}` }, [
                h("div", { display: "flex", fontSize: 58, fontWeight: 700, color: "#ffffff" }, card.badge.value),
                h("div", { display: "flex", fontSize: 22, color: "#82939a" }, card.badge.label),
              ])
            : null,
      ].filter(Boolean)),
      footer,
    ].filter(Boolean),
  );
}

/**
 * Palette PNG at full quality with dithering: the flat card and its soft glow look the same as a
 * truecolour PNG at about half the bytes (117 → 62 KB for a typical article card). Share crawlers
 * keep getting PNG.
 */
const OG_PNG = { compressionLevel: 9, palette: true, quality: 100, dither: 1, effort: 10 } as const;

const inflight = new Map<string, Promise<Buffer>>();

/**
 * PNG bytes of a share image, from the disk cache (`name`.png) when it was rendered before. Concurrent
 * requests share one render; the file is written aside and moved into place, never read half-written.
 */
export function renderPng(name: string, size: { width: number; height: number }, tree: () => Promise<Node>): Promise<Buffer> {
  let job = inflight.get(name);
  if (!job) {
    job = render(path.join(CACHE_DIR, `${name}.png`), size, tree).finally(() => inflight.delete(name));
    inflight.set(name, job);
  }
  return job;
}

async function render(file: string, size: { width: number; height: number }, tree: () => Promise<Node>): Promise<Buffer> {
  try {
    return await readFile(file);
  } catch {
    // not cached yet
  }
  const svg = await satori(await tree() as never, { ...size, fonts: await fonts() });
  const png = await sharp(Buffer.from(svg)).png(OG_PNG).toBuffer();
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, png);
  await rename(tmp, file);
  return png;
}

export function ogEtag(card: OgCard): string {
  // The picture is hundreds of KB of base64 and identical bytes make an identical card, so its digest
  // stands in for it in the hash (and in the disk-cache name that comes from the hash).
  const image = card.image ? createHash("sha256").update(card.image.data).digest("hex") : null;
  return createHash("sha256").update(OG_TEMPLATE_VERSION).update(SITE.name).update(SITE_HOST).update(JSON.stringify({ ...card, image })).digest("hex").slice(0, 24);
}

/** PNG bytes for a card, from the disk cache when this exact card was rendered before. */
export async function renderOg(card: OgCard): Promise<{ png: Buffer; etag: string }> {
  const etag = ogEtag(card);
  return { png: await renderPng(etag, { width: WIDTH, height: HEIGHT }, () => tree(card)), etag };
}
