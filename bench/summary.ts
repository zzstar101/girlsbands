// Folds the repeated runs in bench/results into the medians the migration report quotes.
// Usage: bun bench/summary.ts   (prints markdown tables to stdout)
import { readdirSync } from "node:fs";

const dir = new URL("./results/", import.meta.url).pathname;
type Run = Record<string, any>;
const load = (pattern: RegExp): Run[] =>
  readdirSync(dir).filter((f) => pattern.test(f)).sort().map((f) => require(dir + f));

const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const pct = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && a ? `${b >= a ? "+" : ""}${(((b - a) / a) * 100).toFixed(0)}%` : "—";
const geomean = (xs: number[]) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);

function compare(title: string, a: Run[], b: Run[], la: string, lb: string, skip: string[] = []) {
  console.log(`\n### ${title} (${la} n=${a.length}, ${lb} n=${b.length}, median)\n`);
  console.log(`| endpoint | ${la} rps | ${lb} rps | Δ | ${la} p99 ms | ${lb} p99 ms |`);
  console.log("|---|---|---|---|---|---|");
  const ratios: number[] = [];
  for (const name of Object.keys(a[0].endpoints)) {
    if (skip.includes(name)) continue;
    const ra = median(a.map((r) => r.endpoints[name]?.successRps));
    const rb = median(b.map((r) => r.endpoints[name]?.successRps));
    if (!name.endsWith("hotTopics")) ratios.push(rb / ra);
    console.log(`| ${name} | ${fmt(ra)} | ${fmt(rb)} | ${pct(ra, rb)} | ${fmt(median(a.map((r) => r.endpoints[name]?.p99)))} | ${fmt(median(b.map((r) => r.endpoints[name]?.p99)))} |`);
  }
  console.log(`\ngeomean ${lb}/${la} (excluding hotTopics${skip.length ? ", " + skip.join(", ") : ""}): ${fmt(geomean(ratios), 3)}`);
}

// run.ts rewrites its JSON after every phase; a run still in progress has no peakMemory yet.
const node = load(/^node(-\d+)?\.json$/).filter((r) => r.peakMemory);
const bun = load(/^bun(-\d+)?\.json$/).filter((r) => r.peakMemory);
if (node.length && bun.length) {
  console.log("## Node vs Bun full runs");
  console.log("\n| metric | node | bun | Δ |\n|---|---|---|---|");
  const row = (label: string, f: (r: Run) => number, d = 1) => {
    const a = median(node.map(f)), b = median(bun.map(f));
    console.log(`| ${label} | ${fmt(a, d)} | ${fmt(b, d)} | ${pct(a, b)} |`);
  };
  row("api startup ms", (r) => r.startupMs.api.median, 0);
  row("web startup ms", (r) => r.startupMs.web.median, 0);
  for (const svc of ["api", "web", "worker"]) row(`${svc} idle VmRSS MiB`, (r) => r.idleMemory.process[svc].rssMiB);
  for (const svc of ["api", "web", "worker", "db"]) row(`${svc} idle container MiB`, (r) => parseFloat(r.idleMemory.container[svc]));
  for (const svc of ["api", "web"]) row(`${svc} peak VmHWM MiB (after ramp)`, (r) => r.peakMemory[svc].peakMiB);
  for (const url of Object.keys(node[0].ttfb)) {
    const short = url.replace("http://web:3000", "");
    row(`TTFB ${short} p50 ms`, (r) => r.ttfb[url].ttfb.p50);
    row(`TTFB ${short} p99 ms`, (r) => r.ttfb[url].ttfb.p99);
  }
  row("max concurrency (p99<1s, err<1%)", (r) => r.maxConcurrency, 0);
  console.log(`\nmax concurrency per run: node ${node.map((r) => r.maxConcurrency).join("/")}, bun ${bun.map((r) => r.maxConcurrency).join("/")}`);
  compare("Throughput, c64 20s", node, bun, "node", "bun");
  console.log("\n### Ramp (web URL mix) per run\n");
  for (const r of [...node, ...bun])
    console.log(`- ${r.label}: ` + r.ramp.map((s: Run) => `c${s.concurrency} ${fmt(s.successRps)}rps p99 ${fmt(s.p99, 0)}${s.pass ? "" : " FAIL"}`).join(", "));
}

const pg = load(/^sqlab-pgjs-\d+\.json$/);
const bs = load(/^sqlab-bunsql-\d+\.json$/);
if (pg.length && bs.length) compare("postgres.js vs Bun.SQL (API on Bun)", pg, bs, "postgres.js", "Bun.SQL", ["api:pool"]);
