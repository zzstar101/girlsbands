// The deadline radar reads dated nodes back out of the structure step, buckets them on the Japan
// calendar (a 23:59 JST cut-off is that day, not the day before), and never lets a malformed or
// undated entry reach a reader.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { upcomingDeadlines } from "@girlsbands/backend/publication/deadlines";

const T = `dl-${tag()}`;
// JST 2026-10-01 12:00, so the 30-day window is 2026-10-01 … 2026-10-31.
const NOW = new Date("2026-10-01T03:00:00Z");

after(closeDb);

let n = 0;
async function report(opts: {
  deadlines: unknown;
  mode?: string;
  eligible?: boolean;
  visibility?: string;
  selected?: boolean;
  tags?: string[];
  title?: string;
}) {
  n += 1;
  const id = `${T}-a${n}`;
  const sourceId = `${T}-s${n}`;
  const at = new Date("2026-09-30T00:00:00Z");
  const title = opts.title ?? id;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, created_at, next_fetch_at)
            VALUES (${sourceId}, ${`媒体 ${n}`}, 'rss', 'T1', ${opts.mode ?? "editorial"}, ${at}, '2100-01-01')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
            VALUES (${id}, ${sourceId}, ${id}, ${`https://example.org/${id}`}, ${title}, ${at}, ${at})`;
  const [analysis] = await sql`INSERT INTO analyses (article_id, input_revision, origin, output)
    VALUES (${id}, 1, 'model', ${sql.json({ scope: "single", fact: { deadlines: opts.deadlines } } as never)}) RETURNING id`;
  await sql`INSERT INTO publications (article_id, analysis_id, revision, visibility, eligible, selected, title, source_id, channel, first_party, url, published_at, visible_after, discovered_at, timeline_at, body_mode, sort_at, tags)
    VALUES (${id}, ${analysis!.id}, 1, ${opts.visibility ?? "public"}, ${opts.eligible ?? true}, ${opts.selected ?? false}, ${title}, ${sourceId}, 'news', false, ${`https://example.org/${id}`}, ${at}, ${at}, ${at}, ${at}, 'summary', ${at}, ${opts.tags ?? []})`;
  return id;
}

const quote = (text: string) => ({ text, quote: text });
type Radar = Awaited<ReturnType<typeof upcomingDeadlines>>;
const flat = (r: Radar) => r.days.flatMap((d) => d.items);
const mine = (r: Radar, id: string) => flat(r).filter((i) => i.itemId === id);

test("only the window is shown, bucketed on the Japan calendar", async () => {
  const a = await report({
    deadlines: [
      { kind: "lottery_end", at: "2026-10-02T23:59", note: "FC先行", quote: "受付は10月2日(金)23:59まで" },
      { kind: "event", at: "2026-10-04", note: null, quote: "10月4日(日)開催" },
      { kind: "sale_start", at: "2026-09-30", note: "一般発売", quote: "9月30日(水)一般発売" },
      { kind: "event", at: "2026-11-15", note: null, quote: "11月15日(日)開催" },
    ],
  });
  const r = await upcomingDeadlines(NOW, { horizonDays: 30 });
  assert.equal(r.from, "2026-10-01");
  assert.equal(r.to, "2026-10-31");
  assert.deepEqual(mine(r, a).map((i) => [i.day, i.kind, i.note]), [
    ["2026-10-02", "lottery_end", "FC先行"],
    ["2026-10-04", "event", null],
  ]);
  // Nothing else has been written yet: a report that stated no date contributes nothing at all.
  assert.equal(r.total, 2);
  assert.equal(mine(r, a)[0]!.source.name, "媒体 1");
  assert.equal(mine(r, a)[0]!.url, `https://example.org/${a}`);
  assert.equal(mine(r, a)[0]!.publishedAt, "2026-09-30T00:00:00.000Z");
});

test("the 48-hour flag is measured from the deadline instant in JST", async () => {
  const a = await report({
    deadlines: [
      // 2026-10-02T23:59+09:00 is 35.98 h after NOW.
      { kind: "lottery_end", at: "2026-10-02T23:59", note: null, quote: "10月2日まで" },
      // 2026-10-04T00:00+09:00 is 60 h after NOW.
      { kind: "event", at: "2026-10-04", note: null, quote: "10月4日" },
    ],
  });
  const r = await upcomingDeadlines(NOW, { horizonDays: 30 });
  assert.deepEqual(mine(r, a).map((i) => [i.at, i.soon]), [
    ["2026-10-02T23:59", true],
    ["2026-10-04", false],
  ]);
});

test("an undated or unparseable entry is dropped; an unknown kind falls back", async () => {
  const b = await report({
    deadlines: [
      { kind: "event", at: "2026-10-05 12:00", note: null, ...quote("10月5日 12:00") },
      { kind: "nonsense", at: "2026-10-06", note: null, ...quote("10月6日") },
      { kind: "event", at: null, note: null, ...quote("日程未定") },
      null,
    ],
  });
  const r = await upcomingDeadlines(NOW, { horizonDays: 30 });
  assert.deepEqual(mine(r, b).map((i) => [i.day, i.kind]), [["2026-10-06", "other"]]);
});

test("within a day the selected report comes first, and subjects come from the entity tags", async () => {
  const rows = [
    { kind: "event", at: "2026-10-10", note: null, ...quote("10月10日") },
  ];
  await report({ deadlines: rows, tags: ["新 Live", "entity:mygo"], title: "未选入" });
  await report({ deadlines: rows, tags: ["entity:togenashi-togeari"], title: "已选入", selected: true });
  const r = await upcomingDeadlines(NOW, { horizonDays: 30 });
  const day = r.days.find((d) => d.date === "2026-10-10");
  assert.ok(day);
  assert.deepEqual(day.items.map((i) => i.title), ["已选入", "未选入"]);
  assert.deepEqual(day.items.map((i) => i.subjects), [["togenashi-togeari"], ["mygo"]]);
  assert.deepEqual(day.items.map((i) => i.selected), [true, false]);
});

test("a withdrawn report and a heat-only source stay out of the radar", async () => {
  const rows = [{ kind: "event", at: "2026-10-20", note: null, ...quote("10月20日") }];
  const withdrawn = await report({ deadlines: rows, visibility: "withdrawn" });
  const heat = await report({ deadlines: rows, mode: "hot_signal", eligible: false });
  const ineligible = await report({ deadlines: rows, eligible: false });
  const r = await upcomingDeadlines(NOW, { horizonDays: 30 });
  const ids = flat(r).map((i) => i.itemId);
  assert.equal(ids.includes(withdrawn), false);
  assert.equal(ids.includes(heat), false);
  assert.equal(ids.includes(ineligible), false);
});

test("an event's page only sees the dates stated by its own reports", async () => {
  const own = await report({ deadlines: [{ kind: "event", at: "2026-10-10", note: "自家的", ...quote("10月10日") }] });
  const other = await report({ deadlines: [{ kind: "event", at: "2026-10-11", note: "隔壁的", ...quote("10月11日") }] });
  const [story] = await sql`INSERT INTO stories (public_id, title) VALUES (${randomUUID()}, '测试事件') RETURNING id`;
  await sql`UPDATE publications SET story_id = ${story!.id} WHERE article_id = ${own}`;

  // The radar still gathers every event …
  const all = await upcomingDeadlines(NOW, { horizonDays: 60 });
  assert.deepEqual(mine(all, own).map((i) => i.note), ["自家的"]);
  assert.deepEqual(mine(all, other).map((i) => i.note), ["隔壁的"]);
  // … while the event's own page is narrowed to it, over a horizon long enough for a future Live.
  const one = await upcomingDeadlines(NOW, { horizonDays: 365, storyId: story!.id });
  assert.deepEqual(flat(one).map((i) => [i.itemId, i.day, i.note]), [[own, "2026-10-10", "自家的"]]);
  assert.equal(one.total, 1);
});
