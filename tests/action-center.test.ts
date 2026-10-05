// The action center is the radar's own rows, split by what the reader can still do about them. Written
// from the ways that goes wrong: a row landing in two buckets (or none), a show counted as "today" on
// Tokyo's calendar while its own clock still says yesterday, a window that quietly stops matching the
// radar's, and the API filters drifting away from the page's.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { DeadlineView } from "@girlsbands/contracts/site";
import { addDays, timezoneDate } from "@girlsbands/contracts/time";
import { closeDb, sql } from "@girlsbands/backend/db";
import { actionCenter, upcomingDeadlines } from "@girlsbands/backend/publication/deadlines";
import { buildApp } from "../apps/api/src/app.ts";

process.env.FEISHU_INTERNAL_ENABLED = "false";
const app = await buildApp();
after(async () => {
  await app.close();
  await closeDb();
});

/** 12:00 in Tokyo, 11:00 on the mainland, on 2026-10-01. */
const NOW = new Date("2026-10-01T03:00:00Z");
/** 00:30 in Tokyo on the 2nd, but only 23:30 on the 1st in Beijing — the two calendars disagree. */
const MIDNIGHT = new Date("2026-10-01T15:30:00Z");
const T = `act-${tag()}`;

let n = 0;
/** One dated report, read back through the radar exactly like a stored one (mirrors tests/deadlines-time.test.ts). */
async function report(kind: string, at: string, opts: { timezone?: "Asia/Shanghai"; subject?: string } = {}) {
  n += 1;
  const id = `${T}-a${n}`;
  const sourceId = `${T}-s${n}`;
  const created = new Date("2026-09-30T00:00:00Z");
  const subject = opts.subject ?? "kessoku-band";
  const config = opts.timezone ? { timezone: opts.timezone } : {};
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, config, created_at, next_fetch_at)
            VALUES (${sourceId}, ${`媒体 ${n}`}, 'rss', 'T1', 'editorial', ${sql.json(config as never)}, ${created}, '2100-01-01')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
            VALUES (${id}, ${sourceId}, ${id}, ${`https://example.org/${id}`}, ${`公告 ${n}`}, ${created}, ${created})`;
  const [analysis] = await sql`INSERT INTO analyses (article_id, input_revision, origin, output)
    VALUES (${id}, 1, 'model', ${sql.json({ scope: "single", fact: { deadlines: [{ kind, at, note: null, text: at, quote: at }] } } as never)}) RETURNING id`;
  await sql`INSERT INTO publications (article_id, analysis_id, revision, visibility, eligible, selected, title, source_id, channel, first_party, url, published_at, visible_after, discovered_at, timeline_at, body_mode, sort_at, tags)
    VALUES (${id}, ${analysis!.id}, 1, 'public', true, false, ${`公告 ${n}`}, ${sourceId}, 'news', false, ${`https://example.org/${id}`}, ${created}, ${created}, ${created}, ${created}, 'summary', ${created}, ${[`entity:${subject}`]}::text[])`;
  return id;
}

/** Only this file's rows: the clone also holds whatever previous tests left behind. */
const mine = (rows: DeadlineView[]) => rows.filter((r) => r.itemId.startsWith(T));
const ids = (rows: DeadlineView[]) => new Set(mine(rows).map((r) => r.itemId));

test("every dated row lands in exactly one bucket, and the buckets add up to the window", async () => {
  const live = await report("event", "2026-10-01T18:00");
  const due = await report("lottery_end", "2026-10-01T23:59");
  const payment = await report("payment_deadline", "2026-10-01T23:59", { timezone: "Asia/Shanghai" });
  const sale = await report("sale_start", "2026-10-06");
  const release = await report("release_start", "2026-10-07");
  const merch = await report("merch_start", "2026-10-08");
  const later = await report("event", "2026-10-09");
  const result = await report("result", "2026-10-04");
  const opens = await report("lottery_start", "2026-10-05");

  const center = await actionCenter(NOW);
  assert.deepEqual([...ids(center.liveToday)].sort(), [live].sort(), "a show whose own day is today");
  assert.deepEqual([...ids(center.dueToday)].sort(), [due, payment].sort(), "closing today: a lottery, a payment");
  assert.deepEqual([...ids(center.onSale)].sort(), [sale, release, merch].sort(), "opening soon: sales, releases, merch");
  assert.deepEqual([...ids(center.upcoming)].sort(), [later, result, opens].sort(), "everything else, soonest first");

  const all = [...center.liveToday, ...center.dueToday, ...center.onSale, ...center.upcoming];
  assert.equal(new Set(all.map((r) => r.itemId)).size, all.length, "no row appears twice");
  assert.equal(mine(all).length, 9);
  assert.equal(center.total, all.length, "the total counts what the window found, not just one bucket");
  assert.equal(center.from, "2026-10-01");
  assert.equal(center.to, "2026-10-15", "fourteen days by default");
  // Ordering inside a bucket is the radar's own: earliest first.
  assert.deepEqual(mine(center.onSale).map((r) => r.day), ["2026-10-06", "2026-10-07", "2026-10-08"]);
});

test("the action center is a short view of the radar, never a second set of dates", async () => {
  const soon = await report("sale_start", "2026-10-05");
  const far = await report("event", "2026-10-20");

  const center = await actionCenter(NOW);
  const radar = await upcomingDeadlines(NOW, { horizonDays: 14 });
  const radarIds = new Set(radar.days.flatMap((d) => d.items).filter((r) => r.itemId.startsWith(T)).map((r) => `${r.itemId}|${r.at}`));
  const centerIds = [...center.liveToday, ...center.dueToday, ...center.onSale, ...center.upcoming].filter((r) => r.itemId.startsWith(T)).map((r) => `${r.itemId}|${r.at}`);
  for (const key of centerIds) assert.ok(radarIds.has(key), `${key} is in the radar's own window`);
  assert.deepEqual([...new Set(centerIds)].sort(), [...radarIds].sort(), "same rows, same window");

  const short = await actionCenter(NOW, { horizonDays: 7 });
  assert.equal(short.to, "2026-10-08");
  assert.ok(ids(short.onSale).has(soon), "a sale five days out is inside a week");
  assert.equal(ids(short.upcoming).has(far), false, "twenty days out is not");
  assert.equal(ids(center.upcoming).has(far), false, "and not in the default fourteen either");
  const long = await actionCenter(NOW, { horizonDays: 30 });
  assert.equal(ids(long.upcoming).has(far), true, "the full horizon still finds it");
});

test("「今天」 is the show's own calendar, not Tokyo's", async () => {
  // At this instant Tokyo is already on the 2nd while Beijing is still on the 1st, so the same day field
  // means different things: the Tokyo show is today, the mainland one is tomorrow by its own clock.
  const tokyo = await report("event", "2026-10-02T19:00");
  const mainland = await report("event", "2026-10-02T19:00", { timezone: "Asia/Shanghai" });
  // A mainland show still running today (23:30 Beijing) is behind the shared window, which opens on the
  // Japan day: the radar, the calendar and the export all read that one window, so this keeps them equal.
  const yesterday = await report("event", "2026-10-01T23:30", { timezone: "Asia/Shanghai" });

  const center = await actionCenter(MIDNIGHT);
  assert.equal(ids(center.liveToday).has(tokyo), true, "19:00 in Tokyo on the 2nd is today there");
  assert.equal(ids(center.liveToday).has(mainland), false, "19:00 in Beijing on the 2nd is still tomorrow at midnight");
  assert.equal(ids(center.upcoming).has(mainland), true);
  const all = [...center.liveToday, ...center.dueToday, ...center.onSale, ...center.upcoming];
  assert.equal(ids(all).has(yesterday), false, "the window opens on the Japan day, as the radar's does");
});

test("one subject narrows the center to that band's own series", async () => {
  const gbc = await report("event", "2026-10-06", { subject: "girls-band-cry" });
  const mygo = await report("lottery_end", "2026-10-01", { subject: "mygo" });

  const center = await actionCenter(NOW, { subject: "girls-band-cry" });
  const all = [...center.liveToday, ...center.dueToday, ...center.onSale, ...center.upcoming];
  assert.equal(ids(all).has(gbc), true);
  assert.equal(ids(all).has(mygo), false, "another franchise's dates are not this page's");
});

test("the radar can be narrowed to a kind without changing its window", async () => {
  const sale = await report("sale_start", "2026-10-11");
  const event = await report("event", "2026-10-12");

  const all = await upcomingDeadlines(NOW, { horizonDays: 14 });
  const only = await upcomingDeadlines(NOW, { horizonDays: 14, kinds: ["sale_start"] });
  assert.equal(only.from, all.from);
  assert.equal(only.to, all.to);
  const shown = only.days.flatMap((d) => d.items).filter((r) => r.itemId.startsWith(T));
  assert.ok(shown.some((r) => r.itemId === sale), "the sale is in the filtered window");
  assert.deepEqual([...new Set(shown.map((r) => r.kind))], ["sale_start"], "and nothing else is");
  assert.equal(ids(all.days.flatMap((d) => d.items)).has(event), true, "the unfiltered window still has both");
  assert.equal(only.total, shown.length, "the total follows the filter");
  // A filter that names nothing the extraction can emit matches nothing rather than everything.
  const none = await upcomingDeadlines(NOW, { horizonDays: 14, kinds: [] });
  assert.equal(none.days.length, 0);
  assert.equal(none.total, 0);
});

test("the api answers both shapes, and a horizon-only call is unchanged", async () => {
  // The API reads the real clock, so this row is dated by the real clock: always inside the window.
  const today = timezoneDate("Asia/Tokyo", new Date());
  const sale = await report("sale_start", today, { subject: "girls-band-cry" });

  const get = (url: string) => app.inject({ method: "GET", url });
  const center = await get("/api/site/actions?horizon=14");
  assert.equal(center.statusCode, 200, center.body);
  assert.match(String(center.headers["cache-control"]), /^public/);
  const body = JSON.parse(center.body) as { from: string; to: string; liveToday: DeadlineView[]; dueToday: DeadlineView[]; onSale: DeadlineView[]; upcoming: DeadlineView[]; total: number };
  assert.equal(body.from, today);
  assert.equal(body.to, addDays(today, 14));
  for (const key of ["liveToday", "dueToday", "onSale", "upcoming"] as const) assert.ok(Array.isArray(body[key]), key);
  assert.ok(body.onSale.some((r) => r.itemId === sale), "a sale opening today is in the action center");
  assert.equal(JSON.parse((await get("/api/site/actions?horizon=7")).body).to, addDays(today, 7));

  const filtered = await get("/api/site/deadlines?horizon=14&kinds=sale_start");
  assert.equal(filtered.statusCode, 200, filtered.body);
  const rows = (JSON.parse(filtered.body).days as Array<{ items: DeadlineView[] }>).flatMap((d) => d.items);
  assert.ok(rows.some((r) => r.itemId === sale));
  assert.deepEqual([...new Set(rows.map((r) => r.kind))], ["sale_start"]);
  const scoped = await get("/api/site/deadlines?horizon=14&subject=girls-band-cry");
  const scopedRows = (JSON.parse(scoped.body).days as Array<{ items: DeadlineView[] }>).flatMap((d) => d.items);
  assert.ok(scopedRows.every((r) => r.subjects.includes("girls-band-cry")));
  const unknown = await get("/api/site/deadlines?horizon=14&kinds=not_a_kind");
  assert.equal(JSON.parse(unknown.body).total, 0, "an unknown name matches nothing");

  // The call the page has always made: same window, same rows as the reader function behind it.
  const plain = JSON.parse((await get("/api/site/deadlines?horizon=14")).body) as { from: string; to: string; total: number };
  const expected = await upcomingDeadlines(new Date(), { horizonDays: 14 });
  assert.equal(plain.from, expected.from);
  assert.equal(plain.to, expected.to);
  assert.equal(plain.total, expected.total);
});
