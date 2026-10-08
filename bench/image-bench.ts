// Stage S3 of the Bun migration: what the media pipeline now routes through Bun.Image instead of
// sharp — a still PNG or WebP fitted inside a rendition width and re-encoded as WebP, plus the
// width/height read og/cover.ts needs. Every row runs the identical transformation through both
// engines with the closest settings the two APIs allow, sequentially and at concurrency 4, and
// reports the output bytes together with the mean absolute pixel difference (decoded back through
// sharp): a faster engine that quietly changes the pixels has to be visible here, not in prod.
// The JPEG rows stay in the bench on purpose — they are the evidence for leaving mozjpeg on sharp.
//   bun bench/image-bench.ts [--iterations 8] [--out bench/results/images.json]
import { parseArgs } from "node:util";
import sharp from "sharp";

const { values: opt } = parseArgs({
  options: { iterations: { type: "string", default: "8" }, out: { type: "string" } },
});
const ITERATIONS = Number(opt.iterations);
const CONCURRENCY = 4;
// The production image (oven/bun:1.4-slim, Debian trixie) runs the static codecs with Highway
// geometry; picking the same backend here keeps these numbers the ones the server will produce.
Bun.Image.backend = "bun";

// Fixtures are made in memory with sharp, the way the article pipeline meets them: a 4000×3000
// photo-like JPEG, a 1200×800 PNG with an alpha ramp (the case whose encoder settings differ), and
// a 2000×2000 WebP. Noise inside create is what makes them photo-like; a flat colour would compress
// to nothing and measure the encoder's header, not its entropy pass.
const noisy = (width: number, height: number, channels: 3 | 4, background: string) =>
  sharp({ create: { width, height, channels, background, noise: { type: "gaussian", mean: 128, sigma: 40 } } });
const photoJpeg = await noisy(4000, 3000, 3, "#5d6b78").jpeg({ quality: 92 }).toBuffer();
const alphaPng = await (async () => {
  const raw = await noisy(1200, 800, 4, "#5d6b78").raw().toBuffer();
  // An alpha ramp across the width (fully transparent at one side, opaque at the other): an alpha
  // channel the encoder has to keep, not just a flag, and no pathological single-pixel edges.
  for (let y = 0; y < 800; y++) for (let x = 0; x < 1200; x++) raw[(y * 1200 + x) * 4 + 3] = Math.round((x / 1199) * 255);
  return sharp(raw, { raw: { width: 1200, height: 800, channels: 4 } }).png().toBuffer();
})();
const squareWebp = await noisy(2000, 2000, 3, "#8a6a55").webp({ quality: 90 }).toBuffer();
const sizes: Record<string, { width: number; height: number }> = { photoJpeg: { width: 4000, height: 3000 }, alphaPng: { width: 1200, height: 800 }, squareWebp: { width: 2000, height: 2000 } };
const fixtures: Record<string, Buffer> = { photoJpeg, alphaPng, squareWebp };

/** A rendition: EXIF orientation applied first, fit inside the width without enlarging, then encode. */
const sharpInside = (body: Buffer, width: number, encode: (p: sharp.Sharp) => sharp.Sharp) =>
  encode(sharp(body, { failOn: "none" }).rotate().resize({ width, withoutEnlargement: true })).toBuffer();
const bunInside = (body: Buffer, width: number, encode: (image: Bun.Image) => Bun.Image) =>
  encode(new Bun.Image(body).resize(width, undefined, { fit: "inside", withoutEnlargement: true })).buffer();

interface Row {
  op: string;
  fixture: string;
  width: number | null;
  /** What the two columns are called in the report; every row except the reference compares sharp with Bun. */
  labels?: [string, string];
  sharp: (body: Buffer) => Promise<Buffer>;
  bun: (body: Buffer) => Promise<Buffer>;
  note?: string;
}

const rows: Row[] = [
  {
    op: "still png → webp 88 (image-720)",
    fixture: "alphaPng",
    width: 720,
    sharp: (body) => sharpInside(body, 720, (image) => image.webp({ quality: 88, alphaQuality: 100, smartSubsample: true, effort: 4 })),
    bun: (body) => bunInside(body, 720, (image) => image.webp({ quality: 88 })),
    note: "the rendition resizeImage routes through Bun; sharp's settings are the ones its webp() takes, Bun has no alphaQuality/smartSubsample",
  },
  {
    op: "still webp → webp 82 (image-336)",
    fixture: "squareWebp",
    width: 336,
    sharp: (body) => sharpInside(body, 336, (image) => image.webp({ quality: 82 })),
    bun: (body) => bunInside(body, 336, (image) => image.webp({ quality: 82 })),
  },
  {
    op: "jpeg → jpeg 82 (image-720) — kept on sharp",
    fixture: "photoJpeg",
    width: 720,
    sharp: (body) => sharpInside(body, 720, (image) => image.jpeg({ quality: 82, mozjpeg: true })),
    bun: (body) => bunInside(body, 720, (image) => image.jpeg({ quality: 82 })),
    note: "reference for the decision: Bun's libjpeg-turbo has no mozjpeg trellis quantisation, so its bytes are the number to watch",
  },
  {
    op: "jpeg → webp 88 @336 (engine comparison, not a production route)",
    fixture: "photoJpeg",
    width: 336,
    sharp: (body) => sharpInside(body, 336, (image) => image.webp({ quality: 88, alphaQuality: 100, smartSubsample: true, effort: 4 })),
    bun: (body) => bunInside(body, 336, (image) => image.webp({ quality: 88 })),
    note: "no JPEG input is re-encoded as WebP in images.ts; this row only isolates resize+encode on a photographic source",
  },
  {
    op: "metadata read (og/cover.ts)",
    fixture: "photoJpeg",
    width: null,
    sharp: (body) => sharp(body).metadata().then(() => Buffer.alloc(0)),
    bun: (body) => new Bun.Image(body).metadata().then(() => Buffer.alloc(0)),
  },
  {
    op: "metadata read (og/cover.ts)",
    fixture: "alphaPng",
    width: null,
    sharp: (body) => sharp(body).metadata().then(() => Buffer.alloc(0)),
    bun: (body) => new Bun.Image(body).metadata().then(() => Buffer.alloc(0)),
  },
  {
    op: "metadata read (og/cover.ts)",
    fixture: "squareWebp",
    width: null,
    sharp: (body) => sharp(body).metadata().then(() => Buffer.alloc(0)),
    bun: (body) => new Bun.Image(body).metadata().then(() => Buffer.alloc(0)),
  },
  {
    op: "reference: sharp webp with and without smartSubsample (same engine)",
    fixture: "alphaPng",
    width: 720,
    labels: ["sharp webp smartSubsample", "sharp webp plain"],
    sharp: (body) => sharpInside(body, 720, (image) => image.webp({ quality: 88, alphaQuality: 100, smartSubsample: true, effort: 4 })),
    bun: (body) => sharpInside(body, 720, (image) => image.webp({ quality: 88, alphaQuality: 100, effort: 4 })),
    note: "how far apart two sharp option sets sit on the same pixels: the band the Bun row has to be judged in",
  },
];

const meanAbs = (diff: Record<string, unknown> | null) =>
  ((diff?.perChannel as Array<{ meanAbs: number }> | undefined) ?? []).reduce((sum, c) => sum + (c.meanAbs ?? 0), 0) / ((diff?.perChannel as unknown[] | undefined)?.length ?? 1);
// Peak RSS of the process while a measurement runs; a memory peak per operation would need a
// separate process per row, which is what bench/run.ts does for the whole server.
let section = "fixtures";
const peaks = new Map<string, number>();
const sampler = setInterval(() => peaks.set(section, Math.max(peaks.get(section) ?? 0, process.memoryUsage().rss)), 25);

async function measure(job: (body: Buffer) => Promise<Buffer>, body: Buffer, runs: number, concurrency: number) {
  await job(body); // warm the codecs: the first call is library setup, not the operation
  const started = performance.now();
  for (let done = 0; done < runs; done += concurrency) {
    const batch = Math.min(concurrency, runs - done);
    await Promise.all(Array.from({ length: batch }, () => job(body)));
  }
  const totalMs = performance.now() - started;
  peaks.set(section, Math.max(peaks.get(section) ?? 0, process.memoryUsage().rss)); // the interval can miss a short run
  return { runs, meanMs: +(totalMs / runs).toFixed(3), opsPerSecond: +((runs / totalMs) * 1000).toFixed(2), peakRssBytes: peaks.get(section) ?? 0 };
}

/** Both outputs decoded back through sharp, so a pixel comparison never depends on the engine under test. */
async function pixelDiff(a: Buffer, b: Buffer) {
  const [x, y] = await Promise.all([sharp(a).raw().toBuffer({ resolveWithObject: true }), sharp(b).raw().toBuffer({ resolveWithObject: true })]);
  const info = { dimensions: { width: x.info.width, height: x.info.height }, channels: { sharp: x.info.channels, bun: y.info.channels } };
  if (x.info.width !== y.info.width || x.info.height !== y.info.height) return { ...info, meanAbs: null, note: `dimension mismatch: bun ${y.info.width}x${y.info.height}` };
  if (x.info.channels !== y.info.channels) return { ...info, meanAbs: null, note: "channel count mismatch" };
  const channels = x.info.channels;
  const pixels = x.data.length / channels;
  const perChannel = Array.from({ length: channels }, () => ({ sum: 0, max: 0 }));
  const bands: Record<string, { sum: number; n: number; max: number }> = {};
  for (let i = 0; i < x.data.length; i += channels) {
    for (let c = 0; c < channels; c++) {
      const d = Math.abs(x.data[i + c]! - y.data[i + c]!);
      perChannel[c]!.sum += d;
      perChannel[c]!.max = Math.max(perChannel[c]!.max, d);
    }
    // With alpha, the RGB under a fully transparent pixel is invisible to every consumer we have;
    // reporting it separately keeps "the picture changed" apart from "bytes we never show differ".
    if (channels === 4) {
      const band = x.data[i + 3]! === 0 && y.data[i + 3]! === 0 ? "invisibleAlpha0" : x.data[i + 3]! === 255 && y.data[i + 3]! === 255 ? "opaqueAlpha255" : "partialAlpha";
      const stat = (bands[band] ??= { sum: 0, n: 0, max: 0 });
      stat.n += 1;
      for (let c = 0; c < 3; c++) { const d = Math.abs(x.data[i + c]! - y.data[i + c]!); stat.sum += d; stat.max = Math.max(stat.max, d); }
    }
  }
  const rounded = (sum: number, count: number) => (count === 0 ? null : +(sum / count).toFixed(3));
  return {
    ...info,
    perChannel: perChannel.map((c) => ({ meanAbs: rounded(c.sum, pixels), maxAbs: c.max })),
    byAlpha: Object.fromEntries(Object.entries(bands).map(([band, s]) => [band, { meanAbs: rounded(s.sum, s.n * 3), maxAbs: s.max, share: +(s.n / pixels).toFixed(3) }])),
  };
}

const results = [];
for (const row of rows) {
  const body = fixtures[row.fixture]!;
  const [sharpLabel, bunLabel] = row.labels ?? ["sharp", "Bun.Image"];
  const measured: Record<string, unknown> = {};
  for (const engine of ["sharp", "bun"] as const) {
    section = `${row.op} [${row.fixture}] ${engine}`;
    peaks.set(section, 0);
    measured[engine] = await measure(row[engine], body, ITERATIONS, 1);
    // Sequential first, then the same job four at a time: the server answers several renditions at once.
    const concurrent = await measure(row[engine], body, ITERATIONS, CONCURRENCY);
    measured[engine] = { ...measured[engine], concurrency: CONCURRENCY, concurrent, bytes: (await row[engine](body)).length };
  }
  const sharpOut = await row.sharp(body);
  const bunOut = await row.bun(body);
  // A metadata row produces no bytes to compare; the other engine's call must still be recorded.
  const diff = sharpOut.length === 0 && bunOut.length === 0 ? null : ((await pixelDiff(sharpOut, bunOut)) as Record<string, unknown>);
  const bytes = measured.sharp as { bytes: number };
  const bunBytes = measured.bun as { bytes: number };
  results.push({
    op: row.op,
    fixture: row.fixture,
    renditionWidth: row.width,
    note: row.note,
    engineLabels: [sharpLabel, bunLabel],
    sizeRatioBunOverSharp: +(bunBytes.bytes / bytes.bytes).toFixed(3),
    pixelDiff: diff,
    engines: measured,
  });
  console.error(`${row.op} [${row.fixture}]: sharp ${bytes.bytes}B vs bun ${bunBytes.bytes}B (${results.at(-1)!.sizeRatioBunOverSharp}), mean |Δ| ${diff ? meanAbs(diff).toFixed(2) : "n/a"}`);
}
clearInterval(sampler);

const report = {
  bun: Bun.version,
  backend: Bun.Image.backend,
  platform: `${process.platform} ${process.arch}`,
  iterations: ITERATIONS,
  concurrency: CONCURRENCY,
  fixtures: Object.fromEntries(Object.entries(fixtures).map(([name, body]) => [name, { bytes: body.length, ...sizes[name]! }])),
  results,
};
const json = JSON.stringify(report, null, 2);
if (opt.out) await Bun.write(opt.out, json);
console.log(json);
