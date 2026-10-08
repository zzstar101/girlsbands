// The invariant-test runner behind `bun run test`. bun test has no per-file process isolation —
// --parallel isolates modules but still shares process.env, which these files mutate — so every
// tests/*.test.ts file gets its own `bun test` process, six at a time like the node runner did, with
// tests/preload.ts giving that process its own database copy and scratch folders. A failing file
// fails the run. Pass file paths to run a subset: `bun tests/run.ts tests/architecture.test.ts`.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { globalSetup, globalTeardown } from "./databases.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const preload = fileURLToPath(new URL("./preload.ts", import.meta.url));
const CONCURRENCY = 6;
const TIMEOUT_MS = 120_000;

type Result = { file: string; code: number; ms: number; output: string; tests: number; pass: number; fail: number };

function runFile(file: string) {
  return new Promise<Result>((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["test", file, "--preload", preload, `--timeout=${TIMEOUT_MS}`], { cwd: root });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk));
    child.on("close", (code) =>
      resolve({
        file,
        code: code ?? 1,
        ms: Date.now() - started,
        output,
        tests: Number(/^Ran (\d+) tests? across/m.exec(output)?.[1] ?? 0),
        pass: Number(/^\s*(\d+) pass\b/m.exec(output)?.[1] ?? 0),
        fail: Number(/^\s*(\d+) fail\b/m.exec(output)?.[1] ?? 0),
      }),
    );
  });
}

async function runAll(files: string[]) {
  const results: Result[] = [];
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
      while (next < files.length) {
        const file = files[next++]!;
        const result = await runFile(file);
        results.push(result);
        done += 1;
        const counts = result.tests ? `${result.pass} pass, ${result.fail} fail` : "did not run";
        console.log(`${result.code === 0 ? "ok  " : "FAIL"} ${result.file}  ${counts}  ${(result.ms / 1000).toFixed(1)}s  [${done}/${files.length}]`);
      }
    }),
  );
  return results;
}

const requested = process.argv.slice(2);
const files = (requested.length ? requested : readdirSync(path.join(root, "tests")).filter((file) => file.endsWith(".test.ts")).sort().map((file) => path.join("tests", file))).map((file) =>
  path.relative(root, path.resolve(root, file)),
);

console.log(`${files.length} files, ${CONCURRENCY} at a time`);
const started = Date.now();
await globalSetup();
let results: Result[];
try {
  results = await runAll(files);
} finally {
  await globalTeardown();
}

const failed = results.filter((result) => result.code !== 0);
for (const result of failed) console.log(`\n--- ${result.file} (exit ${result.code}) ---\n${result.output.trimEnd()}`);
const total = results.reduce((sum, result) => ({ tests: sum.tests + result.tests, pass: sum.pass + result.pass, fail: sum.fail + result.fail }), { tests: 0, pass: 0, fail: 0 });
console.log(`\n${files.length} files: ${files.length - failed.length} passed, ${failed.length} failed; ${total.tests} tests: ${total.pass} pass, ${total.fail} fail; ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exitCode = failed.length ? 1 : 0;
