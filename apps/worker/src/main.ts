// Worker process: queues and schedules for collection, processing, events, reports and ops.
import { assertProductionSecrets } from "@girlsbands/backend/config";
import { closeDb } from "@girlsbands/backend/db";
import { getBoss, stopBoss } from "@girlsbands/backend/jobs/queue";
import { registerContentJobs } from "@girlsbands/backend/jobs/content";
import { registerSourceJobs } from "@girlsbands/backend/jobs/sources";
import { registerEventJobs } from "@girlsbands/backend/jobs/events";
import { registerNotifyJobs } from "@girlsbands/backend/jobs/notify";
import { registerPublicationJobs } from "@girlsbands/backend/jobs/publication";
import { registerSchedules } from "./schedules.ts";
import { ensureContentTargets } from "@girlsbands/backend/notify/deliver";
import { startHeartbeat } from "@girlsbands/backend/operations/heartbeat";

assertProductionSecrets([["auth", "IMG_PROXY_SIGN_SECRET"]]);

await ensureContentTargets();
const boss = await getBoss();
await registerContentJobs(boss);
if (process.env.COLLECT_ENABLED === "true") await registerSourceJobs(boss);
await registerEventJobs(boss);
await registerNotifyJobs(boss);
await registerPublicationJobs(boss);
await registerSchedules(boss);
const heartbeat = startHeartbeat("worker");
console.log(JSON.stringify({ level: "info", msg: "worker started", pid: process.pid }));

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ level: "info", msg: "worker stopping" }));
  clearInterval(heartbeat);
  await stopBoss();
  await closeDb();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
