// Microbenchmarks beside the HTTP run (docs/bun-migration.md): each one runs inside the app image on the
// 2c4g slice (cores 0,1, 4 GB), node image with node, bun image with bun, and writes
// bench/results/micro-<phase>.json.
//   og       OG card render throughput (bench/og-bench.ts: satori → SVG → sharp PNG, cache misses)
//   img      img-proxy rendition throughput before/after (bench/img-proxy-bench.ts: resizeImage())
//   startup  runtime cold start (`<rt> -e 0`) and importing the API module graph (apps/api/src/app.ts,
//            no listen, no DB connection), timed inside the container so docker run is not in it
//   bun bench/micro.ts --only og,img,startup
import { $ } from "bun";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
  options: {
    out: { type: "string", default: "bench/results" },
    only: { type: "string", default: "og,img,startup" },
    cpus: { type: "string", default: "0,1" },
    "og-iterations": { type: "string", default: "40" },
    "img-iterations": { type: "string", default: "24" },
    starts: { type: "string", default: "20" },
    rounds: { type: "string", default: "2" }, // runtime order alternates per round (node,bun then bun,node)
  },
});
const phases = new Set(opt.only!.split(","));
const here = new URL(".", import.meta.url).pathname;
const RUNTIMES = ["node", "bun"] as const;
const SLICE = ["--rm", "--cpuset-cpus", opt.cpus!, "--memory", "4g", "-e", "NODE_ENV=production", "-e", "GIRLSBANDS_DATA_DIR=/tmp/girlsbands-data", "-v", `${here}:/app/bench:ro`];
const log = (msg: string) => console.error(`[micro] ${msg}`);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const stats = (xs: number[]) => ({ medianMs: +median(xs).toFixed(1), minMs: Math.min(...xs), maxMs: Math.max(...xs), meanMs: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1), allMs: xs });
const ROUNDS = Number(opt.rounds);
const orderOf = (round: number) => (round % 2 ? [...RUNTIMES].reverse() : [...RUNTIMES]);
const order = Array.from({ length: ROUNDS }, (_, r) => orderOf(r).join(","));
const versions: Record<string, unknown> = {};
for (const rt of RUNTIMES) {
  const image = (await $`docker image inspect -f ${"{{.Id}}"} gb-bench:${rt}`.text()).trim();
  const version = (await $`docker run --rm --entrypoint ${rt} gb-bench:${rt} --version`.text()).trim();
  versions[rt] = { image: `gb-bench:${rt}`, imageId: image, version };
}
const save = (phase: string, result: unknown) => Bun.write(`${opt.out}/micro-${phase}.json`, JSON.stringify({ phase, cpus: opt.cpus, memory: "4g", at: new Date().toISOString(), rounds: ROUNDS, order, versions, ...(result as object) }, null, 2));

async function inImage(rt: string, script: string, args: string[]) {
  log(`${rt}: ${script} ${args.join(" ")}`);
  const out = await $`docker run ${SLICE} gb-bench:${rt} ${rt} bench/${script} ${args}`.text();
  return JSON.parse(out.trim().split("\n").at(-1)!);
}

if (phases.has("og")) {
  // Each round is a fresh container per runtime; every round is kept (results[rt][round]).
  const result: Record<string, unknown[]> = { node: [], bun: [] };
  for (let r = 0; r < ROUNDS; r++) for (const rt of orderOf(r)) result[rt]!.push(await inImage(rt, "og-bench.ts", ["--iterations", opt["og-iterations"]!]));
  await save("og", result);
}

if (phases.has("img")) {
  const result: Record<string, unknown[]> = { node: [], bun: [] };
  for (let r = 0; r < ROUNDS; r++) for (const rt of orderOf(r)) result[rt]!.push(await inImage(rt, "img-proxy-bench.ts", ["--iterations", opt["img-iterations"]!]));
  await save("img", result);
}

if (phases.has("startup")) {
  // One container per runtime and round; each sample is a fresh process; --starts is split over the rounds. Three unmeasured starts first so the
  // page cache holds the runtime and the module files (the per-request cold start of a long-lived
  // server is not the question; how fast a restart is up is).
  const commands = { bare: (rt: string) => `${rt} -e 0`, apiImport: (rt: string) => `${rt} -e 'await import("/app/apps/api/src/app.ts")'` };
  const perRound = Math.ceil(Number(opt.starts) / ROUNDS);
  const samples: Record<string, Record<string, number[]>> = { node: { bare: [], apiImport: [] }, bun: { bare: [], apiImport: [] } };
  for (let r = 0; r < ROUNDS; r++) {
    for (const rt of orderOf(r)) {
      for (const [name, cmd] of Object.entries(commands)) {
        const loop = `cd /app; for i in 1 2 3; do ${cmd(rt)} >/dev/null || exit 1; done; for i in $(seq ${perRound}); do t0=$(date +%s%N); ${cmd(rt)} >/dev/null || exit 1; t1=$(date +%s%N); echo $(( (t1 - t0) / 1000 )); done`;
        log(`round ${r + 1} ${rt}: ${name} ×${perRound}`);
        const out = await $`docker run ${SLICE} --entrypoint bash gb-bench:${rt} -c ${loop}`.text();
        samples[rt]![name]!.push(...out.trim().split("\n").map((us) => +(Number(us) / 1000).toFixed(1)));
      }
    }
  }
  const result: Record<string, Record<string, unknown>> = { node: {}, bun: {} };
  for (const rt of RUNTIMES) for (const [name, cmd] of Object.entries(commands)) {
    const ms = samples[rt]![name]!;
    result[rt]![name] = { command: cmd(rt), runs: ms.length, ...stats(ms) };
    log(`${rt}: ${name} median ${median(ms).toFixed(1)} ms`);
  }
  await save("startup", result);
}
