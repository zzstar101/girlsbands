// Dependency install time on the 2c4g slice (cores 0,1, 4 GB): `npm ci` in node:24-trixie-slim on the
// Node tree (package-lock.json) against `bun install --frozen-lockfile` in oven/bun:1.4-slim (1.4.2) on
// the Bun tree (bun.lock). Each run copies the tree into a fresh container (no node_modules) and times
// only the install command, inside the container. The tree is streamed in as a tar (no node_modules).
//   cold  empty package cache, registry through the host proxy        ×3
//   warm  cache in a named volume primed by one unmeasured run        ×5
// Cold runs are dominated by the network (registry + proxy), so their spread is wide and run-to-run
// differences under ~20% are noise; warm runs still resolve against the registry (neither command is
// offline by default), so they are not network-free either.
//   bun bench/install.ts --node-src /tmp/gbbench/src-node --bun-src /tmp/gbbench/src-bun
import { $ } from "bun";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
  options: {
    "node-src": { type: "string", default: "/tmp/gbbench/src-node" },
    "bun-src": { type: "string", default: "/tmp/gbbench/src-bun" },
    out: { type: "string", default: "bench/results" },
    cpus: { type: "string", default: "0,1" },
    cold: { type: "string", default: "3" },
    warm: { type: "string", default: "5" },
    proxy: { type: "string", default: "http://192.168.5.2:7897" },
    only: { type: "string", default: "node,bun" },
  },
});
const log = (msg: string) => console.error(`[install] ${msg}`);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

const TOOLS = {
  node: { image: "node:24-trixie-slim", src: opt["node-src"]!, install: "npm ci --no-audit --no-fund", cacheEnv: "npm_config_cache=/cache", version: "node --version; npm --version" },
  bun: { image: "oven/bun:1.4-slim", src: opt["bun-src"]!, install: "bun install --frozen-lockfile", cacheEnv: "BUN_INSTALL_CACHE_DIR=/cache", version: "bun --version" },
} as const;
type Tool = keyof typeof TOOLS;

// Inside the container: fresh copy of the tree, timed install, sizes. Output on the last line.
const script = (tool: Tool) => `set -e
mkdir -p /work /cache && cd /work && tar -xf - 2>/dev/null
t0=$(date +%s%N)
${TOOLS[tool].install} >/tmp/install.log 2>&1 || { tail -40 /tmp/install.log >&2; exit 1; }
t1=$(date +%s%N)
all=$(find . -name node_modules -type d -prune | xargs du -smc | tail -1 | cut -f1)
echo "RESULT $(( (t1 - t0) / 1000000 )) $(du -sm node_modules | cut -f1) $all $(du -sm /cache | cut -f1) $(find . -name node_modules -type d -prune | wc -l)"`;

async function run(tool: Tool, cache: string | null) {
  const t = TOOLS[tool];
  const proxy = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "npm_config_proxy", "npm_config_https_proxy"].flatMap((k) => ["-e", `${k}=${opt.proxy}`]);
  const volume = cache ? ["-v", `${cache}:/cache`] : [];
  // The tree goes in on stdin: colima shares only $HOME with the VM, so /tmp sources cannot be mounted.
  const out = await $`tar -C ${t.src} --exclude node_modules --exclude .git -cf - . | docker run -i --rm --cpuset-cpus ${opt.cpus} --memory 4g ${proxy} -e ${t.cacheEnv} ${volume} --entrypoint bash ${t.image} -c ${script(tool)}`.env({ ...process.env, COPYFILE_DISABLE: "1" }).text();
  const [ms, rootMiB, allMiB, cacheMiB, dirs] = out.trim().split("\n").at(-1)!.replace("RESULT ", "").split(" ").map(Number);
  return { seconds: ms! / 1000, nodeModulesMiB: rootMiB!, allNodeModulesMiB: allMiB!, nodeModulesDirs: dirs!, cacheMiB: cacheMiB! };
}

function summarize(runs: Awaited<ReturnType<typeof run>>[]) {
  const s = runs.map((r) => r.seconds);
  return { medianSeconds: +median(s).toFixed(2), minSeconds: Math.min(...s), maxSeconds: Math.max(...s), allSeconds: s, runs };
}

// Runs are interleaved node/bun with the order flipped every run, so a slow patch of network or proxy
// lands on both tools rather than on one.
const tools = opt.only!.split(",") as Tool[];
const orderOf = (i: number) => (i % 2 ? [...tools].reverse() : tools);
const result: Record<string, unknown> = { cpus: opt.cpus, memory: "4g", proxy: opt.proxy, at: new Date().toISOString(),
  note: "cold = empty cache, registry via host proxy (network-bound, noisy); warm = cache in named volume, fresh node_modules, registry still reachable; runs interleaved, order alternating" };
const cold: Record<string, Awaited<ReturnType<typeof run>>[]> = {};
const warm: Record<string, Awaited<ReturnType<typeof run>>[]> = {};
const prime: Record<string, Awaited<ReturnType<typeof run>>> = {};
const volume = (tool: Tool) => `gbbench-install-cache-${tool}`;
for (const tool of tools) {
  const t = TOOLS[tool];
  const version = (await $`docker run --rm --entrypoint bash ${t.image} -c ${t.version}`.text()).trim().split("\n").join(" / ");
  result[tool] = { image: t.image, version, command: t.install };
  cold[tool] = []; warm[tool] = [];
}
for (let i = 0; i < Number(opt.cold); i++) for (const tool of orderOf(i)) {
  cold[tool]!.push(await run(tool, null));
  log(`${tool} cold ${i + 1}: ${cold[tool]!.at(-1)!.seconds}s, node_modules ${cold[tool]!.at(-1)!.nodeModulesMiB} MiB`);
}
for (const tool of tools) {
  await $`docker volume rm -f ${volume(tool)}`.quiet();
  await $`docker volume create ${volume(tool)}`.quiet();
  prime[tool] = await run(tool, volume(tool)); // unmeasured: fills the cache
  log(`${tool} prime: ${prime[tool]!.seconds}s, cache ${prime[tool]!.cacheMiB} MiB`);
}
for (let i = 0; i < Number(opt.warm); i++) for (const tool of orderOf(i)) {
  warm[tool]!.push(await run(tool, volume(tool)));
  log(`${tool} warm ${i + 1}: ${warm[tool]!.at(-1)!.seconds}s`);
}
for (const tool of tools) {
  await $`docker volume rm -f ${volume(tool)}`.quiet();
  Object.assign(result[tool] as object, { cold: summarize(cold[tool]!), prime: prime[tool], warm: summarize(warm[tool]!) });
}
await Bun.write(`${opt.out}/install.json`, JSON.stringify(result, null, 2));
