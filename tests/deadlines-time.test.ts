// Every stated time belongs to a clock, and the site never converts one into another: 15:30 on a
// Japanese announcement is 15:30 in Japan, 15:30 on a mainland one is 15:30 in Beijing. Written from the
// ways that goes wrong — a mainland show that starts at 23:30 being filed on the next day, a 21:00
// closing being counted an hour early, the .ics file carrying a local time with no zone (so every client
// invents its own), and the four places that name a kind of dated point drifting apart again.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  DEADLINE_KINDS,
  DEADLINE_LABELS,
  TIMEZONE_OFFSETS,
  TIMEZONES,
  type DeadlineKind,
} from "@girlsbands/contracts/site";
import { timezoneDate } from "@girlsbands/contracts/time";
import { closeDb, sql } from "@girlsbands/backend/db";
import { config } from "@girlsbands/backend/config";
import { calendarIcs } from "@girlsbands/backend/publication/calendar";
import { upcomingDeadlines } from "@girlsbands/backend/publication/deadlines";
import { DEFAULT_TIMEZONE, deadlineInstant, isTimezone, splitDeadlineAt, timezoneOf } from "@girlsbands/backend/sources/timezone";

const NOW = new Date("2026-10-01T03:00:00Z");
const T = `dlt-${tag()}`;

after(closeDb);

test("a stored date splits into the day and the clock the announcement gave", () => {
  assert.deepEqual(splitDeadlineAt("2026-10-11"), { day: "2026-10-11", localTime: null });
  assert.deepEqual(splitDeadlineAt("2026-10-11T15:30"), { day: "2026-10-11", localTime: "15:30" });
  assert.deepEqual(splitDeadlineAt("2026-10-11T09:05"), { day: "2026-10-11", localTime: "09:05" });
  // Only the two shapes the extraction emits reach a reader; anything else is dropped rather than guessed.
  for (const bad of ["10/11", "2026-10-11T5:30", "2026-10-11 15:30", "2026-10-11T15:30:00", "2026/10/11", "", "2026-10"]) {
    assert.equal(splitDeadlineAt(bad), null, `${bad} is not a date the extraction emits`);
  }
});

test("the same wall clock is a different instant in Japan and on the mainland", () => {
  assert.equal(Date.parse("2026-10-11T15:30:00+09:00"), deadlineInstant("2026-10-11", "15:30", "Asia/Tokyo"));
  assert.equal(Date.parse("2026-10-11T15:30:00+08:00"), deadlineInstant("2026-10-11", "15:30", "Asia/Shanghai"));
  assert.equal(
    deadlineInstant("2026-10-11", "15:30", "Asia/Shanghai") - deadlineInstant("2026-10-11", "15:30", "Asia/Tokyo"),
    3600_000,
    "Beijing is an hour behind Tokyo, and an hour is the difference between acting today and missing it",
  );
  // A day with no stated time is that zone's midnight — what the 48-hour flag measures from.
  assert.equal(deadlineInstant("2026-10-11", null, "Asia/Tokyo"), Date.parse("2026-10-11T00:00:00+09:00"));
  assert.equal(deadlineInstant("2026-10-11", null, "Asia/Shanghai"), Date.parse("2026-10-11T00:00:00+08:00"));
});

test("a show belongs to the day its own clock says", () => {
  // 23:30 in Beijing is already the next day in Tokyo: the day a live is filed under is its own, so a
  // reader in Shanghai sees 「10月11日 23:30 北京时间」 and a Tokyo show at the same instant is the 12th.
  const late = new Date("2026-10-11T15:30:00Z");
  assert.equal(timezoneDate("Asia/Shanghai", late), "2026-10-11");
  assert.equal(timezoneDate("Asia/Tokyo", late), "2026-10-12");
  // 23:59 and 00:01 in Tokyo: one minute decides which day the live belongs to.
  assert.equal(timezoneDate("Asia/Tokyo", new Date("2026-10-11T14:59:00Z")), "2026-10-11");
  assert.equal(timezoneDate("Asia/Tokyo", new Date("2026-10-11T15:01:00Z")), "2026-10-12");
  assert.equal(timezoneDate("Asia/Shanghai", "2026-12-31T16:00:00Z"), "2027-01-01", "and the year turns with it");
});

test("a source's clock comes from its config and defaults to Japan", () => {
  assert.equal(DEFAULT_TIMEZONE, "Asia/Tokyo");
  assert.equal(timezoneOf({ timezone: "Asia/Shanghai" }), "Asia/Shanghai");
  assert.equal(timezoneOf({ timezone: "Asia/Tokyo" }), "Asia/Tokyo");
  for (const absent of [null, undefined, {}, { timezone: null }, { timezone: 8 }, { timezone: "Asia/Seoul" }, { timezone: "asia/shanghai" }]) {
    assert.equal(timezoneOf(absent), "Asia/Tokyo", `${JSON.stringify(absent)} is not a zone we know`);
  }
  assert.equal(isTimezone("Asia/Shanghai"), true);
  assert.equal(isTimezone("Asia/Seoul"), false);
  assert.deepEqual([...TIMEZONES], ["Asia/Tokyo", "Asia/Shanghai"]);
  assert.deepEqual(TIMEZONE_OFFSETS, { "Asia/Tokyo": "+09:00", "Asia/Shanghai": "+08:00" });
});

test("the four places that name a kind of dated point read one list", () => {
  assert.equal(DEADLINE_KINDS.length, 11, "eleven kinds, no duplicates");
  assert.equal(new Set<string>(DEADLINE_KINDS).size, DEADLINE_KINDS.length);
  assert.deepEqual([...DEADLINE_KINDS].sort(), Object.keys(DEADLINE_LABELS).sort(), "every kind is worded, and nothing else is");
  // These two were missing from the extraction's list once, so both were silently filed under 「其他」.
  // The last two came with ticket rounds, whose windows close on a sale or a payment, not a lottery.
  for (const kind of ["release_start", "merch_start", "sale_end", "payment_deadline"] satisfies DeadlineKind[]) {
    assert.ok(DEADLINE_KINDS.includes(kind), `${kind} must be extractable`);
  }
});

/** One dated report from a source whose config names the zone. Mirrors tests/calendar.test.ts. */
let n = 0;
async function report(at: string, timezone: string | null, kind = "event") {
  n += 1;
  const id = `${T}-a${n}`;
  const sourceId = `${T}-s${n}`;
  const created = new Date("2026-09-30T00:00:00Z");
  const config = timezone === null ? {} : { timezone };
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, config, created_at, next_fetch_at)
            VALUES (${sourceId}, ${`媒体 ${n}`}, 'rss', 'T1', 'editorial', ${sql.json(config as never)}, ${created}, '2100-01-01')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
            VALUES (${id}, ${sourceId}, ${id}, ${`https://example.org/${id}`}, ${`公告 ${n}`}, ${created}, ${created})`;
  const [analysis] = await sql`INSERT INTO analyses (article_id, input_revision, origin, output)
    VALUES (${id}, 1, 'model', ${sql.json({ scope: "single", fact: { deadlines: [{ kind, at, note: null, text: at, quote: at }] } } as never)}) RETURNING id`;
  await sql`INSERT INTO publications (article_id, analysis_id, revision, visibility, eligible, selected, title, source_id, channel, first_party, url, published_at, visible_after, discovered_at, timeline_at, body_mode, sort_at, tags)
    VALUES (${id}, ${analysis!.id}, 1, 'public', true, false, ${`公告 ${n}`}, ${sourceId}, 'news', false, ${`https://example.org/${id}`}, ${created}, ${created}, ${created}, ${created}, 'summary', ${created}, ARRAY['entity:kessoku-band'])`;
  return id;
}

test("a mainland show at 23:30 stays on its own day, and its clock is Beijing's", async () => {
  const late = await report("2026-10-20T23:30", "Asia/Shanghai");
  const japan = await report("2026-10-20T23:30", null);

  const radar = await upcomingDeadlines(NOW, { horizonDays: 30 });
  const found = radar.days.flatMap((d) => d.items);
  const mine = found.find((v) => v.itemId === late);
  assert.ok(mine, "the mainland date reaches the radar");
  assert.equal(mine.day, "2026-10-20", "23:30 Beijing is still the 20th where the event happens");
  assert.equal(mine.localTime, "23:30");
  assert.equal(mine.timezone, "Asia/Shanghai");
  assert.deepEqual(radar.days.find((d) => d.items.some((i) => i.itemId === late))?.date, "2026-10-20");
  assert.deepEqual(radar.days.find((d) => d.items.some((i) => i.itemId === japan))?.date, "2026-10-20");
  assert.equal(found.find((v) => v.itemId === japan)?.timezone, "Asia/Tokyo");
});

test("the 48-hour flag counts the announcement's own clock, not Japan's", async () => {
  // 2026-10-03T11:30 in Beijing is 03:30Z, 48.5 hours after NOW — it is not inside the 48-hour window.
  // Read as Japan time it would be 02:30Z, 47.5 hours out, and the reader would be told to hurry.
  const mainland = await report("2026-10-03T11:30", "Asia/Shanghai");
  const japanese = await report("2026-10-03T11:30", null);

  const radar = await upcomingDeadlines(NOW, { horizonDays: 30 });
  const found = radar.days.flatMap((d) => d.items);
  assert.equal(found.find((v) => v.itemId === mainland)?.soon, false);
  assert.equal(found.find((v) => v.itemId === japanese)?.soon, true, "the same wording on a Japanese source is inside it");
});

test("the export names each event's own zone instead of leaving the time floating", async () => {
  const mainland = await report("2026-10-20T23:30", "Asia/Shanghai");
  const japanese = await report("2026-10-21T15:30", null);
  const allDay = await report("2026-10-22", "Asia/Shanghai");

  const text = await calendarIcs(NOW);
  assert.equal(/[^\r]\n/.test(text), false, "every line ends CRLF");
  const lines = text.split("\r\n").reduce<string[]>((out, line) => {
    if (line.startsWith(" ")) out[out.length - 1] += line.slice(1);
    else out.push(line);
    return out;
  }, []);

  assert.ok(lines.includes(`DTSTART;TZID=Asia/Shanghai:20261020T233000`), "the mainland show keeps its own clock and says so");
  assert.ok(lines.includes(`DTSTART;TZID=Asia/Tokyo:20261021T153000`));
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261022"), "a date with no stated time is an all-day event");
  assert.ok(lines.includes("DTEND;VALUE=DATE:20261023"));
  assert.deepEqual(
    lines.filter((l) => l.startsWith("DTSTART:")),
    ["DTSTART:19700101T000000", "DTSTART:19700101T000000"],
    "the only bare DTSTART lines are the two zone definitions — no event floats on the reader's clock",
  );
  assert.equal(lines.some((l) => l.startsWith("DTEND") && l.includes("20261020")), false, "a timed event gets no end");

  // Both zones the file uses are written out, so a client without the IANA database still reads them.
  assert.ok(lines.includes("BEGIN:VTIMEZONE"));
  assert.ok(lines.includes("TZID:Asia/Shanghai"));
  assert.ok(lines.includes("TZID:Asia/Tokyo"));
  assert.ok(lines.includes("TZOFFSETTO:+0800"));
  assert.ok(lines.includes("TZOFFSETTO:+0900"));
  assert.ok(lines.includes("X-WR-TIMEZONE:Asia/Tokyo"), "the site's own baseline is unchanged");
  const host = new URL(config.siteUrl).host;
  assert.ok(lines.includes(`UID:${mainland}-event-20261020T2330@${host}`), "the uid carries the announced clock, so the reader's own calendar keeps it");
  assert.ok(lines.some((l) => l.includes(`/items/${japanese}`)));
  assert.ok(lines.some((l) => l.includes(`/items/${allDay}`)));
});
