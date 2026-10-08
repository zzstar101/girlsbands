// Loaded as the preload of each test file's own `bun test` process (tests/run.ts passes it with
// --preload), before the file and the backend modules it imports. Importing databases.ts applies
// setup.ts first, so the file sees the test environment, its own database copy and its own
// data/tmp folders — that is what keeps files that run at the same time apart.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { cloneTemplate, scratchPrefix } from "./databases.ts";

// Worker threads a file starts inherit the preload and its copy.
if (isMainThread) {
  process.env.DATABASE_URL = await cloneTemplate(process.pid);
  const scratch = mkdtempSync(path.join(tmpdir(), scratchPrefix(process.ppid)));
  for (const dir of ["data", "tmp"]) mkdirSync(path.join(scratch, dir));
  process.env.GIRLSBANDS_DATA_DIR = path.join(scratch, "data");
  process.env.TMPDIR = path.join(scratch, "tmp"); // os.tmpdir(): whatever the file creates goes with it
  process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
}
