// The month calendar and the .ics export read the same dated rows as the radar, so the radar, a subject's
// month and a reader's own calendar can never disagree about a date. Written from the ways they can go
// wrong: a band's calendar taking its series' other bands (or a project's dropping its bands), a direction
// getting a calendar of its own, a month outside the strip being a page, an all-day date losing its day,
// a timed one moving off the reader's clock, and an export that is not a readable iCalendar file.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { config } from "@girlsbands/backend/config";
import { calendarIcs, calendarPage, calendarSubject } from "@girlsbands/backend/publication/calendar";

const T = `cal-${tag()}`;
// JST 2026-10-01 12:00, so the current month is 2026-10 and today is 2026-10-01.
const NOW = new Date("2026-10-01T03:00:00Z");

after(closeDb);

let n = 0;
async function report(opts: { deadlines: unknown; tags?: string[]; title: string; selected?: boolean }) {
  n += 1;
  const id = `${T}-a${n}`;
  const sourceId = `${T}-s${n}`;
  const at = new Date("2026-09-30T00:00:00Z");
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, created_at, next_fetch_at)
            VALUES (${sourceId}, ${`媒体 ${n}`}, 'rss', 'T1', 'editorial', ${at}, '2100-01-01')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
            VALUES (${id}, ${sourceId}, ${id}, ${`https://example.org/${id}`}, ${opts.title}, ${at}, ${at})`;
  const [analysis] = await sql`INSERT INTO analyses (article_id, input_revision, origin, output)
    VALUES (${id}, 1, 'model', ${sql.json({ scope: "single", fact: { deadlines: opts.deadlines } } as never)}) RETURNING id`;
  await sql`INSERT INTO publications (article_id, analysis_id, revision, visibility, eligible, selected, title, source_id, channel, first_party, url, published_at, visible_after, discovered_at, timeline_at, body_mode, sort_at, tags)
    VALUES (${id}, ${analysis!.id}, 1, 'public', true, ${opts.selected ?? false}, ${opts.title}, ${sourceId}, 'news', false, ${`https://example.org/${id}`}, ${at}, ${at}, ${at}, ${at}, 'summary', ${at}, ${opts.tags ?? []})`;
  return id;
}

const quote = (text: string) => ({ text, quote: text });

/** RFC 5545 folds long lines; assertions are written against the unfolded file. */
function unfold(ics: string): string[] {
  return ics.split("\r\n").reduce<string[]>((lines, line) => {
    if (line.startsWith(" ")) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
    return lines;
  }, []);
}

test("a project's calendar carries its whole series; a band's carries only itself", async () => {
  const roselia = await report({ tags: ["entity:roselia"], title: `Roselia Live ${T}`, deadlines: [{ kind: "event", at: "2026-10-10", note: "ロゼリア", ...quote("10月10日") }] });
  const mygo = await report({ tags: ["entity:mygo"], title: `MyGO!!!!! Live ${T}`, deadlines: [{ kind: "release_start", at: "2026-10-11", note: null, ...quote("10月11日") }] });

  const bang = await calendarPage(NOW, null, "bang-dream");
  assert.ok(bang);
  assert.equal(bang.month, "2026-10");
  assert.equal(bang.subject, "bang-dream");
  assert.deepEqual(bang.days.map((d) => [d.date, d.items.map((i) => i.itemId)]), [
    ["2026-10-10", [roselia]],
    ["2026-10-11", [mygo]],
  ]);
  assert.equal(bang.total, 2, "both bands of the series are on the project's calendar");

  const only = await calendarPage(NOW, "2026-10", "roselia");
  assert.ok(only);
  assert.deepEqual(only.days.map((d) => d.items.map((i) => i.itemId)), [[roselia]], "a band's calendar does not take its label mates");
  assert.deepEqual(only.days[0]!.items[0]!.subjects, ["roselia"]);

  const other = await calendarPage(NOW, "2026-10", "girls-band-cry");
  assert.ok(other);
  assert.equal(other.total, 0, "another project never sees them");
});

test("a direction has no calendar of its own; a month outside the strip is not a page", async () => {
  assert.equal(calendarSubject("roselia")?.id, "roselia");
  assert.equal(calendarSubject("bang-dream")?.id, "bang-dream");
  assert.equal(calendarSubject("live"), null, "a direction's dates are everyone's");
  assert.equal(calendarSubject("one-man"), null, "a content form has no page at all");
  assert.equal(calendarSubject("not-a-topic"), null);

  const now = await report({ tags: ["entity:kuzumimizuku"], title: `近月 Live ${T}`, deadlines: [{ kind: "event", at: "2026-10-20", note: null, ...quote("10月20日") }] });
  const near = await report({ tags: ["entity:kuzumimizuku"], title: `明年 Live ${T}`, deadlines: [{ kind: "event", at: "2027-05-20", note: null, ...quote("5月20日") }] });
  const far = await report({ tags: ["entity:kuzumimizuku"], title: `后年 Live ${T}`, deadlines: [{ kind: "event", at: "2028-05-20", note: null, ...quote("5月20日") }] });
  const old = await report({ tags: ["entity:kuzumimizuku"], title: `去年 Live ${T}`, deadlines: [{ kind: "event", at: "2026-05-05", note: null, ...quote("5月5日") }] });

  const may = await calendarPage(NOW, "2027-05", "kuzumimizuku");
  assert.ok(may, "a month within the strip that has a date is a page");
  assert.deepEqual(may.days.map((d) => d.items.map((i) => i.itemId)), [[near]]);
  assert.equal(await calendarPage(NOW, "2028-05", "kuzumimizuku"), null, "past the strip's end");
  assert.equal(await calendarPage(NOW, "2026-05", "kuzumimizuku"), null, "before the strip's start");
  assert.equal(await calendarPage(NOW, "2026-13", "kuzumimizuku"), null, "not a month");
  assert.equal(await calendarPage(NOW, "not-a-month", "kuzumimizuku"), null);

  const strip = await calendarPage(NOW, null, "kuzumimizuku");
  assert.ok(strip);
  assert.deepEqual(strip.months, ["2026-10", "2027-05"], "this month plus every month that has a date, oldest first");
  const shown = strip.days.flatMap((d) => d.items.map((i) => i.itemId));
  assert.deepEqual(shown, [now], "only the current month's date is inside the window");
  assert.equal([far, old].some((id) => shown.includes(id)), false, "the far and the old date are outside it");
});

test("the export is a readable iCalendar file: folded, escaped, on the reader's own clock", async () => {
  const timed = await report({
    tags: ["entity:kessoku-band"],
    title: "結束バンド Live, 第一部; 特別公演",
    deadlines: [{ kind: "event", at: "2026-10-10T15:30", note: "开演 15:30", ...quote("10月10日 15:30") }],
  });
  const allDay = await report({
    tags: ["entity:kessoku-band"],
    title: "結束バンド 新专辑发售",
    deadlines: [{ kind: "release_start", at: "2026-10-04", note: null, ...quote("10月4日発売") }],
  });

  const text = await calendarIcs(NOW, "kessoku-band");
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.equal(/[^\r]\n/.test(text), false, "every line ends CRLF");
  const physical = text.split("\r\n");
  for (const line of physical) assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line longer than 75 octets: ${line}`);
  assert.ok(physical.some((line) => line.startsWith(" ")), "a long line is folded, not cut off");
  assert.equal(text, await calendarIcs(NOW, "kessoku-band"), "the same minute gives the same file");

  const lines = unfold(text);
  assert.ok(lines.includes("X-WR-TIMEZONE:Asia/Tokyo"));
  assert.ok(lines.includes("X-WR-CALNAME:少女乐队's — 結束バンド 日程"));
  assert.ok(lines.includes(`UID:${timed}-event-20261010T1530@${new URL(config.siteUrl).host}`));
  // A timed date is floating local time — 15:30 on the announcement is 15:30 on the reader's clock — and
  // it gets no end. An all-day date runs to the next day so it does not vanish from a day view.
  assert.ok(lines.includes("DTSTART:20261010T153000"));
  assert.equal(lines.some((l) => l.startsWith("DTEND") && l.includes("20261010")), false);
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261004"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20261005"));
  // RFC 5545 escaping: a comma, a semicolon and a line break are not literal.
  assert.ok(lines.includes("SUMMARY:結束バンド Live\\, 第一部\\; 特別公演"));
  const descriptions = lines.filter((l) => l.startsWith("DESCRIPTION:"));
  assert.equal(descriptions.length, 2);
  const timedDescription = descriptions.find((l) => l.includes(`/items/${timed}`))!;
  assert.ok(timedDescription.includes("开演 15:30"), timedDescription);
  assert.ok(timedDescription.includes("\\n"), "the note, the source and the reading link are separate lines");
  assert.ok(timedDescription.includes("来源：媒体"), timedDescription);
  assert.ok(lines.includes("CATEGORIES:release_start"));
  assert.deepEqual(lines.filter((l) => l === "BEGIN:VEVENT").length, 2);
  assert.deepEqual(lines.filter((l) => l === "END:VEVENT").length, 2);
  assert.ok(lines.includes(`UID:${allDay}-release_start-20261004@${new URL(config.siteUrl).host}`));
});

test("the export covers a month back and a year ahead, and one subject's is not the whole site's", async () => {
  const recent = await report({ tags: ["entity:mugendai-mewtype"], title: "上个月的 Live", deadlines: [{ kind: "event", at: "2026-09-15", note: null, ...quote("9月15日") }] });
  const tooOld = await report({ tags: ["entity:mugendai-mewtype"], title: "两个月前的 Live", deadlines: [{ kind: "event", at: "2026-08-01", note: null, ...quote("8月1日") }] });
  const nextYear = await report({ tags: ["entity:mugendai-mewtype"], title: "一年内的 Live", deadlines: [{ kind: "event", at: "2027-09-01", note: null, ...quote("9月1日") }] });
  const tooFar = await report({ tags: ["entity:mugendai-mewtype"], title: "一年后的 Live", deadlines: [{ kind: "event", at: "2027-10-05", note: null, ...quote("10月5日") }] });

  const one = unfold(await calendarIcs(NOW, "mugendai-mewtype"));
  const summaries = one.filter((l) => l.startsWith("SUMMARY:"));
  assert.ok(summaries.includes("SUMMARY:上个月的 Live"));
  assert.ok(summaries.includes("SUMMARY:一年内的 Live"));
  assert.equal(summaries.includes("SUMMARY:两个月前的 Live"), false, "the export looks back one month");
  assert.equal(summaries.includes("SUMMARY:一年后的 Live"), false, "and ahead one year");
  assert.ok(one.some((l) => l.startsWith(`UID:${recent}-`)) && one.some((l) => l.startsWith(`UID:${nextYear}-`)));
  assert.equal(one.some((l) => l.startsWith(`UID:${tooOld}-`)) || one.some((l) => l.startsWith(`UID:${tooFar}-`)), false);
});
