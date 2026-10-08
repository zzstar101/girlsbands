// Image-proxy rendition throughput before/after the Bun migration: the real resizeImage() of
// packages/backend/src/media/images.ts, run inside each app image by its own runtime. gb-bench:node
// carries the Node code (every rendition through sharp); gb-bench:bun carries the Bun code (still PNG
// and WebP through Bun.Image, everything else still sharp). Same fixtures, same calls, so the two runs
// are the img-proxy's CPU cost per rendition before and after. Fetch, signing and the cache are not
// in it — those are measured end to end by bench/run.ts. bench/image-bench.ts is the engine-level
// comparison (bun only, pixel diffs); this one is the production function, both runtimes.
// Mounted at /app/bench by bench/micro.ts; runs under Node 24 too, so: no Bun APIs, erasable TS only.
//   docker run --rm --cpuset-cpus 0,1 --memory 4g -e GIRLSBANDS_DATA_DIR=/tmp/img -v $PWD/bench:/app/bench:ro \
//     gb-bench:bun bun bench/img-proxy-bench.ts --iterations 24
import { parseArgs } from "node:util";
import sharp from "sharp";
import { resizeImage } from "../packages/backend/src/media/images.ts";

const { values: opt } = parseArgs({ options: { iterations: { type: "string", default: "24" }, concurrency: { type: "string", default: "4" } } });
const ITERATIONS = Number(opt.iterations);
const CONCURRENCY = Number(opt.concurrency);
const bun = (globalThis as unknown as { Bun?: { version: string } }).Bun;
const runtime = bun ? `bun ${bun.version}` : `node ${process.version}`;

// Fixtures as in bench/image-bench.ts: noise makes them photo-like (a flat colour would measure headers).
const noisy = (width: number, height: number, channels: 3 | 4, background: string) =>
  sharp({ create: { width, height, channels, background, noise: { type: "gaussian", mean: 128, sigma: 40 } } });
const alphaPng = await (async () => {
  const raw = await noisy(1200, 800, 4, "#5d6b78").raw().toBuffer();
  for (let y = 0; y < 800; y++) for (let x = 0; x < 1200; x++) raw[(y * 1200 + x) * 4 + 3] = Math.round((x / 1199) * 255);
  return sharp(raw, { raw: { width: 1200, height: 800, channels: 4 } }).png().toBuffer();
})();

const cases = [
  { name: "png 1200×800 alpha → image-720", type: "image/png", mode: "image-720", body: alphaPng },
  { name: "png 2400×1600 opaque → image-1200", type: "image/png", mode: "image-1200", body: await noisy(2400, 1600, 3, "#d8d2c4").png().toBuffer() },
  { name: "webp 2000×2000 → image-336", type: "image/webp", mode: "image-336", body: await noisy(2000, 2000, 3, "#8a6a55").webp({ quality: 90 }).toBuffer() },
  { name: "webp 2000×2000 → image-1200", type: "image/webp", mode: "image-1200", body: await noisy(2000, 2000, 3, "#8a6a55").webp({ quality: 90 }).toBuffer() },
  { name: "jpeg 4000×3000 → image-720 (sharp on both: control)", type: "image/jpeg", mode: "image-720", body: await noisy(4000, 3000, 3, "#5d6b78").jpeg({ quality: 92 }).toBuffer() },
];

let peakRss = 0;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 25);

async function measure(job: () => Promise<unknown>, runs: number, concurrency: number) {
  const started = performance.now();
  for (let done = 0; done < runs; done += concurrency) {
    await Promise.all(Array.from({ length: Math.min(concurrency, runs - done) }, job));
  }
  const totalMs = performance.now() - started;
  return { runs, concurrency, msPerOp: +(totalMs / runs).toFixed(2), opsPerSecond: +((runs / totalMs) * 1000).toFixed(2) };
}

const results = [];
for (const c of cases) {
  const job = () => resizeImage(c.body, c.type, c.mode);
  const out = await job(); // codec setup is not the operation
  const outMeta = await sharp(out.body).metadata();
  const sequential = await measure(job, ITERATIONS, 1);
  const concurrent = await measure(job, ITERATIONS, CONCURRENCY);
  results.push({ case: c.name, inputBytes: c.body.length, output: { type: out.type, bytes: out.body.length, width: outMeta.width, height: outMeta.height }, sequential, concurrent });
  console.error(`${runtime} ${c.name}: ${sequential.msPerOp} ms/op seq, ${concurrent.opsPerSecond} ops/s @${CONCURRENCY}`);
}
clearInterval(sampler);
console.log(JSON.stringify({ runtime, iterations: ITERATIONS, concurrency: CONCURRENCY, results, peakRssMiB: +(peakRss / 1048576).toFixed(1) }));
