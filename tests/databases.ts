// Every invariant-test file runs on its own copy of the database, so the files run in parallel
// without sharing rows, paid-service budgets or an order (tests/run.ts). DATABASE_URL names the
// template, a throwaway database ending in _test or _ci (setup.ts refuses anything else); it is
// created if missing. run.ts calls globalSetup once for the whole run (migrate the template, drop
// copies left by an interrupted run) and globalTeardown at the end; tests/preload.ts, loaded in
// each file's own process, copies the template per process.
import "./setup.ts";
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const template = new URL(process.env.DATABASE_URL!);
const name = decodeURIComponent(template.pathname.slice(1));
const suffix = name.slice(name.lastIndexOf("_") + 1);
const copyPattern = `^${name.replace(/\W/g, "\\$&")}_f[0-9]+_${suffix}$`;

function urlOf(database: string) {
  const url = new URL(template);
  url.pathname = `/${database}`;
  return url.toString();
}

async function onServer(fn: (db: postgres.Sql) => Promise<unknown>) {
  const db = postgres(urlOf("postgres"), { max: 1, onnotice: () => {} });
  try {
    await fn(db);
  } finally {
    await db.end();
  }
}

/** Copies the migrated template to one process's own database and returns its URL. */
export async function cloneTemplate(pid: number) {
  const copy = `${name}_f${pid}_${suffix}`;
  await onServer((db) => db`CREATE DATABASE ${db(copy)} TEMPLATE ${db(name)}`);
  return urlOf(copy);
}

// Each file's scratch folder is named after the runner, so a run removes only its own leftovers.
export const scratchPrefix = (runner: number) => `girlsbands-test-${runner}-`;

const dropCopies = () =>
  onServer(async (db) => {
    for (const { datname } of await db<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname ~ ${copyPattern}`) {
      await db`DROP DATABASE IF EXISTS ${db(datname)} WITH (FORCE)`;
    }
  });

export async function globalSetup() {
  await onServer(async (db) => {
    if ((await db`SELECT 1 FROM pg_database WHERE datname = ${name}`).length === 0) await db`CREATE DATABASE ${db(name)}`;
  });
  execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/migrate.ts", import.meta.url))], { stdio: ["ignore", "ignore", "inherit"] });
  await dropCopies(); // left by an interrupted run
}

export async function globalTeardown() {
  await dropCopies();
  for (const entry of readdirSync(tmpdir())) {
    if (entry.startsWith(scratchPrefix(process.pid))) rmSync(path.join(tmpdir(), entry), { recursive: true, force: true }); // a crashed file's
  }
}
