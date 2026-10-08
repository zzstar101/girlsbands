// The 2c4g benchmark (docs/bun-migration.md): brings up bench/compose.yml with one image, loads a copy of
// the data, and measures startup, memory, per-endpoint throughput, page TTFB and the highest concurrency
// the site sustains. The load generator (oha, and bun for TTFB) runs on the VM's other cores.
//   bun bench/run.ts --label node --image gb-bench:node --runtime node --dump /tmp/gbbench/aniband.sql.gz
import { $ } from "bun";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
  options: {
    label: { type: "string" },
    image: { type: "string" },
    runtime: { type: "string" },
    dump: { type: "string" },
    out: { type: "string", default: "bench/results" },
    duration: { type: "string", default: "20s" },
    starts: { type: "string", default: "10" },
    only: { type: "string" }, // comma list of phases: startup,memory,endpoints,ttfb,ramp
    // Also load the multi-query read endpoints (timeline, topic, pool, item) — the ones where a
    // database driver change shows; members/stats/sitemap are cached in process and would not.
    "db-heavy": { type: "boolean", default: false },
  },
});
const label = opt.label!;
const phases = new Set((opt.only ?? "startup,memory,endpoints,ttfb,ramp").split(","));
const here = new URL(".", import.meta.url).pathname;
const env = { ...process.env, BENCH_IMAGE: opt.image!, BENCH_RUNTIME: opt.runtime! };
const compose = (...args: string[]) => $`docker compose -f ${here}compose.yml ${args}`.env(env);
const NETWORK = "gbbench_default";
const LOADGEN = ["--rm", "--network", NETWORK, "--cpuset-cpus", "2,3"];
const log = (msg: string) => console.error(`[${label}] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const result: Record<string, unknown> = { label, image: opt.image, runtime: opt.runtime, at: new Date().toISOString() };
const save = () => Bun.write(`${opt.out}/${label}.json`, JSON.stringify(result, null, 2));

async function waitFor(url: string, timeoutMs = 60_000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return performance.now() - t0;
    } catch {}
    await sleep(10);
  }
  throw new Error(`${url} not ready after ${timeoutMs} ms`);
}

async function procMemory(service: string) {
  const status = await compose("exec", "-T", service, "cat", "/proc/1/status").text();
  const kb = (key: string) => Number(status.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m"))?.[1] ?? NaN);
  return { rssMiB: +(kb("VmRSS") / 1024).toFixed(1), peakMiB: +(kb("VmHWM") / 1024).toFixed(1) };
}

async function containerMemory() {
  const lines = (await $`docker stats --no-stream --format ${"{{.Name}}\t{{.MemUsage}}"}`.text()).trim().split("\n");
  return Object.fromEntries(lines.filter((l) => l.startsWith("gbbench-")).map((l) => {
    const [name, usage] = l.split("\t");
    return [name!.replace(/^gbbench-|-1$/g, ""), usage!.split(" / ")[0]];
  }));
}

async function oha(args: string[], stdin?: string) {
  const proc = Bun.spawn(["docker", "run", "-i", ...LOADGEN, "ghcr.io/hatoo/oha:latest", "--no-tui", "--output-format", "json", ...args], { stdin: stdin ? new Blob([stdin]) : "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err] = [await new Response(proc.stdout).text(), await new Response(proc.stderr).text()];
  if ((await proc.exited) !== 0) throw new Error(`oha failed: ${err}`);
  const r = JSON.parse(out);
  const codes: Record<string, number> = r.statusCodeDistribution ?? {};
  // Requests still in flight when the run ends are cut off by oha, not refused by the server.
  const errors: Record<string, number> = Object.fromEntries(Object.entries(r.errorDistribution ?? {}).filter(([e]) => e !== "aborted due to deadline")) as Record<string, number>;
  const ok = Object.entries(codes).filter(([c]) => Number(c) < 400).reduce((a, [, n]) => a + n, 0);
  const total = Object.values(codes).reduce((a, n) => a + n, 0) + Object.values(errors).reduce((a, n) => a + n, 0);
  const ms = (s: number | null | undefined) => (s == null ? null : +(s * 1000).toFixed(2));
  return {
    requests: total,
    rps: +r.summary.requestsPerSec.toFixed(1),
    successRps: +((r.summary.requestsPerSec * ok) / Math.max(1, total)).toFixed(1),
    errorRate: +(1 - ok / Math.max(1, total)).toFixed(4),
    p50: ms(r.latencyPercentiles.p50),
    p90: ms(r.latencyPercentiles.p90),
    p99: ms(r.latencyPercentiles.p99),
    mean: ms(r.summary.average),
    codes,
    errors,
  };
}

// ---- stack ----
log("fresh stack");
await compose("down", "-v", "--remove-orphans").quiet();
await compose("up", "-d", "--wait", "db").quiet();
log("loading data copy");
await $`gunzip -c ${opt.dump!} | docker compose -f ${here}compose.yml exec -T db psql -q -U girlsbands -d girlsbands -v ON_ERROR_STOP=1`.env(env).quiet();
await compose("run", "--rm", "--no-deps", "api", opt.runtime!, "scripts/migrate.ts").quiet();
await compose("up", "-d", "api", "worker", "web").quiet();
await waitFor("http://127.0.0.1:13001/api/health");
await waitFor("http://127.0.0.1:13000/fonts/OFL-Anton.txt");

const itemId = (await compose("exec", "-T", "db", "psql", "-U", "girlsbands", "-d", "girlsbands", "-Atc",
  "SELECT article_id FROM analyses ORDER BY id DESC LIMIT 1").text()).trim();
const pages = { home: "/", topic: "/topics/bang-dream", item: `/items/${itemId}` };
const apis: Record<string, string> = {
  items: "/api/v1/items",
  hotTopics: "/api/v1/hot-topics",
  snapshot: "/api/v1/selected/snapshot",
  siteHome: "/api/site/home",
  feed: "/feed.xml",
  calendar: "/calendar.ics",
  ...(opt["db-heavy"] ? {
    timeline: "/api/site/timeline",
    siteTopic: "/api/site/topics/bang-dream",
    pool: "/api/site/pool?q=%E9%82%A6&tab=relevance",
    siteItem: `/api/site/items/${itemId}`,
  } : {}),
};
for (const [name, path] of Object.entries(pages)) {
  const res = await fetch(`http://127.0.0.1:13000${path}`);
  if (res.status !== 200) throw new Error(`${name} ${path}: ${res.status}`);
}
result.urls = { pages, apis };

// ---- startup: stop a service, start it, time until it answers ----
if (phases.has("startup")) {
  const startup: Record<string, number[]> = { api: [], web: [] };
  const probes = { api: "http://127.0.0.1:13001/api/health", web: "http://127.0.0.1:13000/fonts/OFL-Anton.txt" } as const;
  for (let i = 0; i < Number(opt.starts); i++) {
    for (const service of ["api", "web"] as const) {
      await compose("stop", service).quiet();
      const t0 = performance.now();
      await compose("start", service).quiet();
      await waitFor(probes[service]);
      startup[service].push(+(performance.now() - t0).toFixed(0));
    }
  }
  const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)];
  result.startupMs = Object.fromEntries(Object.entries(startup).map(([k, v]) => [k, { median: median(v), all: v }]));
  log(`startup ${JSON.stringify(result.startupMs)}`);
  await compose("restart", "worker").quiet();
}

// ---- idle memory ----
if (phases.has("memory")) {
  // One light pass over the pages so the idle figure is a server that has served, not a cold one.
  for (const path of [...Object.values(pages), ...Object.values(apis)]) await fetch(`http://127.0.0.1:13000${path}`).then((r) => r.arrayBuffer());
  await sleep(30_000);
  result.idleMemory = {
    process: { api: await procMemory("api"), web: await procMemory("web"), worker: await procMemory("worker") },
    container: await containerMemory(),
  };
  log(`idle memory ${JSON.stringify(result.idleMemory)}`);
}
await save();

// ---- per-endpoint throughput (64 connections) ----
if (phases.has("endpoints")) {
  const endpoints: Record<string, unknown> = {};
  const targets = [
    ...Object.entries(apis).map(([k, p]) => [`api:${k}`, `http://api:3001${p}`] as const),
    ...Object.entries(pages).map(([k, p]) => [`ssr:${k}`, `http://web:3000${p}`] as const),
    ["web:proxy-items", "http://web:3000/api/v1/items"] as const,
  ];
  for (const [name, url] of targets) {
    await oha(["-z", "5s", "-c", "16", url]); // warm-up
    endpoints[name] = await oha(["-z", opt.duration!, "-c", "64", "-w", url]);
    log(`${name} ${JSON.stringify(endpoints[name])}`);
    result.endpoints = endpoints;
    await save();
  }
}

// ---- TTFB, one visitor at a time ----
if (phases.has("ttfb")) {
  const urls = Object.values(pages).map((p) => `http://web:3000${p}`);
  const out = await $`docker run ${LOADGEN} -v ${here}:/bench:ro oven/bun:1.4-slim bun /bench/ttfb.ts 200 ${urls}`.text();
  result.ttfb = JSON.parse(out);
  log(`ttfb ${out.trim()}`);
  await save();
}

// ---- ramp: a page mix through the web process until p99 > 1 s or errors > 1 % ----
if (phases.has("ramp")) {
  const mix = [pages.home, pages.topic, pages.item, pages.home, apis.items, apis.siteHome, apis.feed].map((p) => `http://web:3000${p}`).join("\n");
  const ramp: unknown[] = [];
  let sustained: number | null = null;
  for (const c of [8, 16, 32, 64, 128, 256, 512, 1024, 2048]) {
    const r = await oha(["-z", opt.duration!, "-c", String(c), "--urls-from-file", "/dev/stdin", "-w"], mix);
    const memory = { api: await procMemory("api"), web: await procMemory("web"), container: await containerMemory() };
    const pass = r.errorRate < 0.01 && r.p99 !== null && r.p99 < 1000;
    ramp.push({ concurrency: c, pass, ...r, memory });
    log(`ramp c=${c} ${pass ? "pass" : "FAIL"} rps=${r.rps} p99=${r.p99} err=${r.errorRate}`);
    result.ramp = ramp;
    await save();
    if (!pass) break;
    sustained = c;
  }
  result.maxConcurrency = sustained;
  result.peakMemory = { api: await procMemory("api"), web: await procMemory("web"), worker: await procMemory("worker") };
  await save();
}

await compose("logs", "--no-color", "--tail", "200").text().then((t) => Bun.write(`${opt.out}/${label}.log`, t));
await compose("down", "-v").quiet();
log("done");
