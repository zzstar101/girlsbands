// The weekly Chinese spot check. Only what a reader can actually open in Chinese is in the pool;
// each item carries the preferred spelling of every controlled name its original mentions; and the
// draw is the same all week and different for a different seed, without depending on any clock or
// sort order that changes while you read.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { REVIEW_CHARS, type AdminReview, type BeforeJson } from "@girlsbands/contracts/admin";
import { closeDb, sql } from "@girlsbands/backend/db";
import { reviewSample } from "@girlsbands/backend/admin/review";

const T = tag();
const SOURCE = `test-review-${T}`;
after(async () => {
  await sql`DELETE FROM translations WHERE article_id LIKE ${`review-${T}-%`}`;
  await sql`DELETE FROM publications WHERE article_id LIKE ${`review-${T}-%`}`;
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM sources WHERE id = ${SOURCE}`;
  await closeDb();
});

let n = 0;
/** An item with a body, a publication and a translation — one knob per reason it may not be sampled. */
async function item(opts: { body?: string; origin?: string; mode?: "full" | "summary"; visibility?: string } = {}) {
  n += 1;
  const id = `review-${T}-${n}`;
  const body = opts.body ?? `後藤ひとりが Zepp Haneda で公演。2026年11月3日 18:00 開演。`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, language, discovered_at, timeline_at, body_text, body_html, body_status)
            VALUES (${id}, ${SOURCE}, ${id}, ${`https://example.com/${id}`}, ${`原文 ${n}`}, 'ja', now(), now(), ${body}, ${`<p>${body}</p>`}, 'ok')`;
  await sql`INSERT INTO publications (article_id, revision, visibility, eligible, selected, title, source_id, channel, url, discovered_at, timeline_at, sort_at, body_mode)
            VALUES (${id}, 1, ${opts.visibility ?? "public"}, true, false, ${`中文标题 ${n}`}, ${SOURCE}, 'news', ${`https://example.com/${id}`}, now(), now(), now(), ${opts.mode ?? "full"})`;
  await sql`INSERT INTO translations (article_id, lang, revision, title, body_html, body_text, complete, origin)
            VALUES (${id}, 'zh', 1, ${`中文标题 ${n}`}, ${`<p>${body}</p>`}, ${`译文 ${n}`}, true, ${opts.origin ?? "model"})`;
  return id;
}

test("the spot check holds only what a reader can open in Chinese", async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${SOURCE}, '抽检', 'rss', 'T1', 'editorial', '2100-01-01')`;
  const open = await item();
  await item({ mode: "summary" });
  await item({ visibility: "withdrawn" });
  await item({ origin: "source" });

  const sample: BeforeJson<AdminReview> = await reviewSample("2026-W41");
  assert.equal(sample.total, 1, "only the public, full-text, model-translated item is eligible");
  assert.deepEqual(sample.rows.map((r) => r.article_id), [open]);
  assert.deepEqual(sample.week, { start: "2026-10-05", end: "2026-10-11" }, "2026-W41 is read as a Beijing Monday..Sunday");
  assert.equal(sample.seed, "2026-W41");

  const row = sample.rows[0]!;
  assert.equal(row.title, "原文 1");
  assert.equal(row.title_zh, "中文标题 1");
  assert.equal(row.language, "ja");
  assert.equal(row.complete, true);
  assert.equal(row.cut, false);
  // The preferred spelling, not the form the original happened to use.
  assert.ok(row.names.includes("后藤一里"), `expected 后藤一里 in ${JSON.stringify(row.names)}`);
  assert.ok(!row.names.includes("後藤ひとり"));
});

test("a seed that is not a week label still draws, with no week to show", async () => {
  const sample: BeforeJson<AdminReview> = await reviewSample(`${T}-ad-hoc`);
  assert.equal(sample.week, null);
  assert.equal(sample.seed, `${T}-ad-hoc`);
  assert.equal(sample.rows.length, 1);
});

test("the same seed draws the same items and a different seed draws another order", async () => {
  for (let i = 0; i < 7; i += 1) await item();
  const ids = async (seed: string) => (await reviewSample(seed, 20)).rows.map((r) => r.article_id);
  assert.deepEqual(await ids("week-a"), await ids("week-a"), "a seed is a fixed draw");
  const orders = new Set<string>();
  for (const seed of ["week-a", "week-b", "week-c", "week-d"]) orders.add((await ids(seed)).join(","));
  assert.ok(orders.size > 1, "a different seed draws a different order");
});

test("long bodies are cut at the same place on both sides, and say so", async () => {
  const long = "あ".repeat(REVIEW_CHARS + 500);
  const id = await item({ body: long });
  await sql`UPDATE translations SET body_text = ${long}, complete = false WHERE article_id = ${id}`;

  const sample = await reviewSample("2026-W41", 50);
  const row = sample.rows.find((r) => r.article_id === id)!;
  assert.equal(row.body.length, REVIEW_CHARS);
  assert.equal(row.body_zh!.length, REVIEW_CHARS);
  assert.equal(row.cut, true);
  assert.equal(row.complete, false, "a half-translated item is still sampled, and flagged");

  const short = await reviewSample("2026-W41", 1);
  assert.equal(short.rows.length, 1, "the limit is the number of items, not of characters");
});
