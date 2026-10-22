// Failure cases: automatic runs rewrite published issues; report/receipt commits split; empty gaps
// starve later daily/weekly/monthly issues or make a failed run look successful. All use a local model stub.
import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { composeDaily, composeDueReports, composeWeekly, composeMonthly } from "@girlsbands/backend/reports/compose";

const T = tag();
const SOURCE = `report-recovery-${T}`;
const answer = async (user: string) => ({ title: user.slice(0, 100), leadParagraph: "导语", highlights: [1], headline: "本期进展", overview: "总述", themes: [{ heading: "主题", summary: "摘要", refs: [1] }] });
const provider = await stub(async (_hit, request) => ({
  choices: [{ message: { content: JSON.stringify(await answer(JSON.parse(request.body).messages.at(-1).content)) } }],
}));
process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
process.env.DEEPSEEK_API_KEY = "test-key";
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${SOURCE}, 'Report recovery', 'rss', 'T1')`;
});
beforeEach(async () => {
  await sql`DELETE FROM reports`;
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
});
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

async function item(at: string) {
  const id = `recovery-${tag()}`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
    VALUES (${id}, ${SOURCE}, ${id}, 'https://example.com/report', ${id}, ${new Date(at)}, ${new Date(at)})`;
  await sql`INSERT INTO publications (article_id, title, source_id, channel, url, discovered_at, timeline_at, sort_at, eligible, selected, visible_after, visibility, score)
    VALUES (${id}, ${id}, ${SOURCE}, 'news', 'https://example.com/report', ${new Date(at)}, ${new Date(at)}, ${new Date(at)}, true, true, ${new Date(at)}, 'public', 90)`;
  return id;
}
const report = async (kind: string, key: string) => (await sql`SELECT content, revision, generated_at FROM reports WHERE kind = ${kind} AND key = ${key}`)[0];

test("automatic retries preserve all three published issue kinds; explicit corrections keep a revision", async () => {
  const id = await item("2024-02-01T12:00:00Z");
  for (const [kind, key, compose] of [
    ["daily", "2024-02-02", composeDaily], ["weekly", "2024-W05", composeWeekly], ["monthly", "2024-02", composeMonthly],
  ] as const) {
    await compose(key);
    const saved = await report(kind, key);
    const calls = provider.hits();
    await sql`UPDATE publications SET title = title || ' corrected' WHERE article_id = ${id}`;
    await compose(key);
    assert.deepEqual(await report(kind, key), saved, `${kind}: an automatic retry preserves the edition`);
    assert.equal(provider.hits(), calls, "no model request for an already published edition");
    await compose(key, "editor correction");
    assert.equal((await report(kind, key)).revision, 2);
    const [revision] = await sql`SELECT v.content FROM report_revisions v JOIN reports r ON r.id = v.report_id WHERE r.kind = ${kind} AND r.key = ${key}`;
    assert.deepEqual(revision.content, saved.content);
  }
});

test("report publication and its receipt commit together and recovery reuses the response", async () => {
  await item("2024-05-01T12:00:00Z");
  await composeDaily("2024-05-02");
  await sql.unsafe(`CREATE FUNCTION fail_report_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.status = 'completed' AND NEW.purpose = 'report_weekly' THEN RAISE EXCEPTION 'receipt commit interrupted'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER fail_report_receipt BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION fail_report_receipt()`);
  try {
    await assert.rejects(composeWeekly("2024-W18"), /receipt commit interrupted/);
    assert.equal(await report("weekly", "2024-W18"), undefined);
  } finally {
    await sql.unsafe("DROP TRIGGER fail_report_receipt ON receipts; DROP FUNCTION fail_report_receipt()");
  }
  const calls = provider.hits();
  await composeWeekly("2024-W18");
  assert.equal(provider.hits(), calls);
  assert.equal((await report("weekly", "2024-W18")).revision, 1);
  assert.equal((await sql`SELECT status FROM receipts WHERE subject = 'report:weekly:2024-W18'`)[0]!.status, "completed");
});

test("empty older gaps cannot starve a later daily, weekly or monthly; the gaps themselves are skipped", async () => {
  // An older issue carried an item; the days after it are empty. Weeklies and monthlies are compiled from dailies.
  const early = await item("2024-01-22T12:00:00Z");
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
    VALUES ('daily', '2024-01-23', now(), now(), ${sql.json({ sections: [{ label: "Live 与活动", items: [{ itemId: early, title: early }] }] })}, now())`;
  await item("2024-02-01T12:00:00Z");
  // 2024-02-02 11:00 Beijing: the days from the 24th on closed empty, so they are skipped instead of
  // failed; the day that does have an item, and the period issues made of the older daily, are still
  // written — an empty gap never starves them.
  const result = await composeDueReports(new Date("2024-02-02T03:00:00Z"));
  for (const [kind, key] of [["daily", "2024-02-02"], ["weekly", "2024-W04"], ["monthly", "2024-01"]]) {
    assert.ok(await report(kind!, key!), `${kind} ${key} was recovered past the empty gaps`);
  }
  assert.deepEqual(result.failed, [], "a window that closed empty is a skip, not a failure");
  assert.ok(result.skipped.includes("daily:2024-01-24"), "the empty days are named in the run's own result");
});

test("weeks and months that ended before the first daily issue are not due, so they do not fail every run", async () => {
  // The site went live mid-week: the first daily is a Wednesday. The week and month before have no dailies.
  await item("2024-03-05T12:00:00Z");
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
    VALUES ('daily', '2024-03-06', now(), now(), ${sql.json({ sections: [] })}, now())`;
  // 2024-03-06 10:00 Beijing: weekly due 2024-W09 (ends 03-03), monthly due 2024-02 — both before launch.
  const result = await composeDueReports(new Date("2024-03-06T02:00:00Z"));
  assert.deepEqual(result.failed, []);
  assert.equal(await report("weekly", "2024-W09"), undefined);
  assert.equal(await report("monthly", "2024-02"), undefined);
});

test("a daily window that stays empty more than a day past due stops being retried and is reported as skipped", async () => {
  // Content processing was down for 46 hours: the 2024-06-02 window (06-01 08:00 – 06-02 08:00 Beijing)
  // carries nothing, and what the catch-up releases afterwards is attributed to the window it was
  // released in — so this one can never gain an item. A report written a day later fills normally.
  await item("2024-06-03T12:00:00Z");
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
    VALUES ('daily', '2024-06-01', now(), now(), ${sql.json({ sections: [] })}, now())`;
  // On the day it fell due the rule stands: an empty issue is a failure upstream, not a report.
  await assert.rejects(composeDueReports(new Date("2024-06-02T04:00:00Z")), /reports:/);
  assert.equal(await report("daily", "2024-06-02"), undefined);
  // More than a day later the window is closed for good: skipped, said out loud, and not a failure.
  const result = await composeDueReports(new Date("2024-06-04T04:00:00Z"));
  assert.equal(await report("daily", "2024-06-02"), undefined, "a skip never writes an empty issue");
  assert.ok(result.skipped.includes("daily:2024-06-02"), "the skip is visible in the run's own result");
  assert.ok(result.skipped.includes("daily:2024-06-03"), "and so is the gap after it");
  assert.deepEqual(result.failed, [], "a hopeless window is not a failure any more");
  assert.ok(result.generated.includes("daily:2024-06-04"), "the day that does have items is still written");
  assert.ok(await report("daily", "2024-06-04"));
});
