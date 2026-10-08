// Time to first byte of the server-rendered pages, one visitor at a time: the time until the response
// headers arrive (a streamed page sends them before its body) and until the last byte. Runs inside the
// load-generator container: bun bench/ttfb.ts <requests> <url>...
const [count, ...urls] = Bun.argv.slice(2);
const n = Number(count);

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]!;
const summary = (values: number[]) => {
  const s = values.toSorted((a, b) => a - b);
  return { mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p50: +pct(s, 50).toFixed(2), p95: +pct(s, 95).toFixed(2), p99: +pct(s, 99).toFixed(2) };
};

const results: Record<string, unknown> = {};
for (const url of urls) {
  const ttfb: number[] = [];
  const total: number[] = [];
  for (let i = 0; i < n + 10; i++) {
    const t0 = performance.now();
    const res = await fetch(url, { headers: { "accept-encoding": "identity" } });
    const t1 = performance.now();
    await res.arrayBuffer();
    const t2 = performance.now();
    if (res.status !== 200) throw new Error(`${url}: ${res.status}`);
    if (i < 10) continue; // warm-up
    ttfb.push(t1 - t0);
    total.push(t2 - t0);
  }
  results[url] = { ttfb: summary(ttfb), total: summary(total) };
}
console.log(JSON.stringify(results));
