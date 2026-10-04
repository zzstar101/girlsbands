import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { config } from "@girlsbands/backend/config";
import { getBoss, enqueue, QUEUES, stopBoss } from "@girlsbands/backend/jobs/queue";

after(stopBoss);

test("a failed first database connection does not poison all later queue requests", async () => {
  const original = config.databaseUrl;
  const missing = new URL(original);
  missing.pathname = "/girlsbands_missing_queue_recovery_test";
  config.databaseUrl = missing.toString();
  try {
    await assert.rejects(getBoss(), /does not exist/);
  } finally {
    config.databaseUrl = original;
  }
  const boss = await getBoss();
  const id = await enqueue(QUEUES.analyze, { articleId: "recovered" });
  assert.ok(id);
  assert.equal((await boss.getJobById<{ articleId: string }>(QUEUES.analyze, id))?.data.articleId, "recovered");
});
