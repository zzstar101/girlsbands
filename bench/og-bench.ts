// Share-card render throughput, run *inside* the app image by whichever runtime the image ships (node
// for gb-bench:node, bun for gb-bench:bun), so it measures the exact /og/site.png path: satori lays the
// card out (pure JS — this is where the runtimes differ), sharp rasterises the SVG to a palette PNG,
// and renderOg writes the disk cache. No database: the site card is static copy from industry/site.ts.
// Every op is a cache miss: each card carries a distinct footer line (`meta`), so the disk cache and the
// in-flight sharing in render.ts never answer for the renderer. bench/ is dockerignored, so bench/micro.ts
// mounts this file at /app/bench/og-bench.ts; it runs under Node 24 too, so: no Bun APIs, erasable TS only.
//   docker run --rm --cpuset-cpus 0,1 --memory 4g -e GIRLSBANDS_DATA_DIR=/tmp/og -v $PWD/bench:/app/bench:ro \
//     gb-bench:node node bench/og-bench.ts --iterations 40
import { rm } from "node:fs/promises";
import { parseArgs } from "node:util";
import { renderOg, type OgCard } from "../apps/api/src/og/render.ts";
import { SITE } from "@girlsbands/industry/site";
import { config } from "@girlsbands/backend/config";

const { values: opt } = parseArgs({ options: { iterations: { type: "string", default: "40" }, concurrency: { type: "string", default: "4" } } });
const ITERATIONS = Number(opt.iterations);
const CONCURRENCY = Number(opt.concurrency);
const runtime = typeof (globalThis as { Bun?: { version: string } }).Bun !== "undefined" ? `bun ${(globalThis as unknown as { Bun: { version: string } }).Bun.version}` : `node ${process.version}`;

// The /og/site.png card (apps/api/src/routes/og.ts PAGES.site), plus a footer that makes each one unique.
let serial = 0;
const card = (): OgCard => ({ kicker: SITE.name, title: SITE.tagline, subtitle: SITE.description, meta: `${SITE.name} · bench ${serial++}` });

let peakRss = 0;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 25);

async function measure(runs: number, concurrency: number) {
  const started = performance.now();
  const latencies: number[] = [];
  let bytes = 0;
  for (let done = 0; done < runs; done += concurrency) {
    const batch = Math.min(concurrency, runs - done);
    await Promise.all(Array.from({ length: batch }, async () => {
      const t0 = performance.now();
      const { png } = await renderOg(card());
      latencies.push(performance.now() - t0);
      bytes = png.length;
    }));
  }
  const totalMs = performance.now() - started;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const sorted = latencies.toSorted((a, b) => a - b);
  const pct = (p: number) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!.toFixed(1);
  return { runs, concurrency, totalMs: +totalMs.toFixed(0), msPerOp: +(totalMs / runs).toFixed(2), opsPerSecond: +((runs / totalMs) * 1000).toFixed(2), latencyMs: { p50: pct(0.5), p90: pct(0.9), max: pct(1) }, pngBytes: bytes };
}

const cold0 = performance.now();
await renderOg(card()); // fonts are read and parsed on the first render: reported, not measured
const firstRenderMs = +(performance.now() - cold0).toFixed(0);
for (let i = 0; i < 3; i++) await renderOg(card()); // let the JIT see the layout code
const sequential = await measure(ITERATIONS, 1);
const concurrent = await measure(ITERATIONS, CONCURRENCY);
clearInterval(sampler);
await rm(`${config.dataDir}/ogcache`, { recursive: true, force: true });

console.log(JSON.stringify({ runtime, card: "/og/site.png (+ unique meta line)", firstRenderMs, sequential, concurrent, peakRssMiB: +(peakRss / 1048576).toFixed(1) }));
