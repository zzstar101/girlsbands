// Fetches the official wordmark/logo of every band in industry/taxonomy.ts and normalises it to a
// transparent-background PNG under assets/band-logos/, then writes the manifest the renderers read
// (assets/band-logos/manifest.json): size, sha256 and the ink luminance that decides whether a logo
// is legible on the dark mail header.
//
// These images are the rights holders' own trademarks; we keep them only to show a band's mark in
// our mail header and on-site, not as our own artwork. See assets/band-logos/README.md.
//
// Usage: node scripts/fetch-band-logos.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { REPO_ROOT } from "@girlsbands/backend/config";
import { ENTITIES } from "@girlsbands/industry/taxonomy";

const OUT_DIR = path.join(REPO_ROOT, "assets/band-logos");
/** The sites serve the same bytes to any modern browser; a plain fetch UA gets 403 on two of them. */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const TIMEOUT_MS = 25_000;
/** Delay before attempt 2 and attempt 3. */
const BACKOFF_MS = [2_000, 5_000];
/** Longest edge of the stored PNG. */
const MAX_EDGE = 1200;
/** SVG rasterisation density: high enough that the 1200px resize downsamples instead of upscaling. */
const SVG_DENSITY = 600;
/** Alpha above this counts as ink. */
const INK_ALPHA = 200;
/** Alpha at or below this is invisible: it is neither ink nor artwork to keep when cropping. */
const ALPHA_FLOOR = 8;
/** Ink this bright reads on the dark header background. */
const ON_DARK_MIN = 0.55;

/** id -> direct URL of the official logo. bang-dream.com and gbc-firstriff.com want a Referer. */
const SOURCES: Record<string, string> = {
  "girls-band-cry": "https://girls-band-cry.com/wp-content/themes/gbc_v1-1/assets/images/common/logo.png",
  "togenashi-togeari": "https://girls-band-cry.com/wp-content/themes/gbc_v1-1/assets/images/common/character/logo_toge.png",
  "bang-dream": "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/images/common/common/logo_bangdream.png",
  mygo: "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_mygo.webp",
  "ave-mujica": "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_avemujica.webp",
  roselia: "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_roselia.webp",
  "kessoku-band": "https://bocchi.rocks/kessokuband/assets/img/common/header/logo_kessoku.svg",
  // 企划自己的字标（作品标题），取自 TV 版官网页脚的标题 logo；`/omnibus` 那张是剧场总集编的。
  "bocchi-the-rock": "https://bocchi.rocks/tv/assets/img/common/footer/ttl_logo.svg",
  poppinparty: "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_poppinparty.webp",
  afterglow: "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_afterglow.webp",
  "pastel-palettes": "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_pastel-palettes.webp",
  "hello-happy-world": "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_hello-happy-world.webp",
  morfonica: "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_morfonica.webp",
  "raise-a-suilen": "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_raise-a-suilen.webp",
  "mugendai-mewtype": "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_yumemita.webp",
  "our-notes": "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/images/common/common/logo_ournotes.png",
  millsage: "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_millsage.webp",
  ikkadumbrock: "https://bang-dream.com/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_ikka-dumb-rock.webp",
  kuzumimizuku: "https://gbc-firstriff.com/wp-content/themes/gbc-firstriff_teaser/assets/images/band/kuzumimizuku/img_logo-band-kuzumimizuku.png",
  "diamond-dust": "https://girls-band-cry.com/wp-content/themes/gbc_v1-1/assets/images/common/character/logo_dd.png",
};

type Logo = {
  file: string;
  source: string;
  sha256: string;
  width: number;
  height: number;
  inkLum: number | null;
  onDark: boolean;
};
type Manifest = { generatedAt: string; logos: Record<string, Logo> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function download(url: string): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < BACKOFF_MS.length + 1; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1]!);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, referer: `${new URL(url).origin}/` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`重试 ${BACKOFF_MS.length} 次后仍失败：${String(lastError)}`);
}

/** WCAG relative luminance of one sRGB channel, 0..255 in, 0..1 out. */
function channelLum(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Mean relative luminance of the opaque pixels (alpha > INK_ALPHA); null when nothing is opaque. */
async function measure(png: Buffer): Promise<{ width: number; height: number; inkLum: number | null }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! <= INK_ALPHA) continue;
    sum += 0.2126 * channelLum(data[i]!) + 0.7152 * channelLum(data[i + 1]!) + 0.0722 * channelLum(data[i + 2]!);
    count++;
  }
  return { width: info.width, height: info.height, inkLum: count === 0 ? null : sum / count };
}

/**
 * Bounding box of the artwork, or null when the whole image is transparent.
 *
 * "Artwork" means any pixel above ALPHA_FLOOR: a soft glow or drop shadow (alpha ≫ 0) is part of
 * the mark, not margin, so cropping may only ever remove transparent — or invisible — edges.
 * The floor exists because several sources carry a one-pixel rim at alpha ≤ 8 (≈3% opacity):
 * without it the box snaps to the full canvas and no margin is ever removed.
 *
 * Why not sharp's own `trim()`: it samples the **top-left pixel** as the background to compare
 * against, not the alpha channel. GIRLS BAND CRY's source has a transparent area whose RGB is
 * noisy ((71,112,76,0) against a (71,70,76,0) corner), so `trim({ threshold: 1 })` silently does
 * nothing and the margin survives. Measuring the alpha channel is deterministic, and it is the
 * only thing that keeps every logo's padding comparable.
 */
async function inkBox(source: Buffer, density?: number): Promise<sharp.Region | null> {
  const { data, info } = await sharp(source, density ? { density } : {})
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((data[(y * info.width + x) * info.channels + 3] ?? 0) <= ALPHA_FLOOR) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Crop the transparent margin by alpha, keep alpha, fit inside MAX_EDGE. */
async function normalise(raw: Buffer): Promise<Buffer> {
  const isSvg = /^\s*(<\?xml|<svg)/i.test(raw.subarray(0, 256).toString("utf8"));
  const density = isSvg ? SVG_DENSITY : undefined;
  const img = sharp(raw, density ? { density } : {});
  const box = await inkBox(raw, density);
  // No transparency at all (an opaque source, e.g. a logo flattened onto white) — there is no
  // alpha to measure, so fall back to colour-based trimming rather than keeping the flat margin.
  return await (box ? img.extract(box) : img.trim({ threshold: 1 }))
    .ensureAlpha()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const ids = Object.keys(ENTITIES);
  const logos: Record<string, Logo> = {};
  const failures: string[] = [];

  for (const id of ids) {
    const source = SOURCES[id];
    if (!source) {
      failures.push(`${id}（没有配置直链）`);
      console.log(`${id.padEnd(20)} 失败  未配置直链`);
      continue;
    }
    try {
      const png = await normalise(await download(source));
      const { width, height, inkLum } = await measure(png);
      const onDark = inkLum !== null && inkLum >= ON_DARK_MIN;
      const file = `${id}.png`;
      const target = path.join(OUT_DIR, file);
      const existing = await readFile(target).catch(() => null);
      if (!existing || !existing.equals(png)) await writeFile(target, png);
      logos[id] = {
        file,
        source,
        sha256: createHash("sha256").update(png).digest("hex"),
        width,
        height,
        inkLum: inkLum === null ? null : Number(inkLum.toFixed(4)),
        onDark,
      };
      console.log(
        `${id.padEnd(20)} 成功  ${`${width}x${height}`.padEnd(11)} ${String(png.length).padStart(8)} B  ` +
          `${(inkLum === null ? "null" : inkLum.toFixed(4)).padStart(6)}  ${String(onDark).padEnd(5)} ${source}`,
      );
    } catch (error) {
      failures.push(`${id}（${error instanceof Error ? error.message : String(error)}）`);
      console.log(`${id.padEnd(20)} 失败  ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const previousText = await readFile(manifestPath, "utf8").catch(() => null);
  const previous = previousText === null ? null : (JSON.parse(previousText) as Manifest);
  // Keep the run idempotent: unchanged logos keep the old timestamp and the file is not rewritten.
  const unchanged = previous !== null && JSON.stringify(previous.logos) === JSON.stringify(logos);
  const manifest: Manifest = {
    generatedAt: unchanged ? previous.generatedAt : new Date().toISOString(),
    logos,
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (text !== previousText) await writeFile(manifestPath, text);

  console.log(`抓取 ${Object.keys(logos).length}/${ids.length}，失败 ${failures.length}`);
  if (failures.length > 0) console.log(`失败：${failures.join("；")}`);
}

await main();
