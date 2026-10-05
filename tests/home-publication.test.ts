import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { loadTimeline } from "@girlsbands/backend/publication/timeline";
import { loadHome } from "@girlsbands/backend/publication/home";

const T = `home-${tag()}`;
const NOW = new Date('2026-10-05T03:00:00Z');
after(closeDb);
let n = 0;
async function report(opts: { band?: string; visibility?: string; mode?: string; at?: Date; release?: Date; deadlines?: Array<{ kind: string; at: string }> } = {}) {
  const id = `${T}-${++n}`;
  const at = opts.at ?? NOW;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${id}, ${id}, 'rss', 'T1', ${opts.mode ?? 'editorial'}, '2100-01-01')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at) VALUES (${id}, ${id}, ${id}, ${`https://example.org/${id}`}, '消息', ${at}, ${at})`;
  const [analysis] = await sql`INSERT INTO analyses (article_id, input_revision, origin, output) VALUES (${id}, 1, 'model', ${sql.json({ fact: { deadlines: opts.deadlines ?? [] } })}) RETURNING id`;
  await sql`INSERT INTO publications (article_id, analysis_id, revision, visibility, eligible, selected, title, source_id, channel, first_party, url, visible_after, discovered_at, timeline_at, body_mode, sort_at, tags, category)
    VALUES (${id}, ${analysis!.id}, 1, ${opts.visibility ?? 'public'}, true, true, '消息', ${id}, 'news', true, ${`https://example.org/${id}`}, ${opts.release ?? at}, ${at}, ${at}, 'summary', ${at}, ${[`entity:${opts.band ?? 'mygo'}`]}, 'live')`;
  return id;
}

test('home counts only public released editorial reports, and projects expand their own series', async () => {
  await report();
  await report({ band: 'togenashi-togeari' });
  await report({ visibility: 'withdrawn' });
  await report({ mode: 'hot_signal' });
  await report({ release: new Date('2026-10-06T00:00:00Z') });
  await report({ at: new Date('2026-09-20T00:00:00Z') });
  const home = await loadHome(NOW);
  assert.equal(home.stats.today, 2);
  assert.equal(home.bandWeek.mygo, 1);
  assert.equal(home.bandWeek['togenashi-togeari'], 1);
  assert.equal(home.projects['bang-dream']?.today, 1);
  assert.equal(home.projects['girls-band-cry']?.today, 1);
  assert.equal(home.trackCounts.live, 2);
});

test('home uses calendar dates, removes passed times, and urgency counts closing dates only', async () => {
  const id = await report({ deadlines: [
    { kind: 'lottery_end', at: '2026-10-05T10:00' }, // already passed at noon JST
    { kind: 'lottery_end', at: '2026-10-06T23:59' },
    { kind: 'event', at: '2026-10-06' },
    { kind: 'lottery_end', at: '2026-10-20' },
  ] });
  const before = await loadHome(NOW);
  assert.deepEqual(before.deadlines.days.flatMap((d) => d.items).map((d) => d.at), ['2026-10-06', '2026-10-06T23:59', '2026-10-20']);
  assert.equal(before.stats.soon, 1);
  assert.equal(before.stats.monthDates, 3);
  assert.equal(before.stats.weekDeadlines, 1);
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${id}`;
  const after = await loadHome(NOW);
  assert.equal(after.stats.monthDates, 0);
  assert.equal(after.stats.soon, 0);
  assert.equal(after.projects['bang-dream']?.deadlines, 0);
});

test('one full-day headliner survives cursor paging; withdrawal removes its dates and rank', async () => {
  const high = await report({ deadlines: [{ kind: 'event', at: '2026-10-08' }] });
  const low = await report();
  await sql`UPDATE publications SET score = 95, category = 'ticket' WHERE article_id = ${high}`;
  await sql`UPDATE publications SET score = 60 WHERE article_id = ${low}`;
  const query = { channel: 'all' as const, category: null, tag: null, subjects: [], now: NOW, limit: 1 };
  const all: Array<Awaited<ReturnType<typeof loadTimeline>>['cards'][number]> = [];
  let cursor: string | null = null;
  do {
    const page = await loadTimeline({ ...query, cursor });
    all.push(...page.cards); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(all.filter((c) => c.headliner).map((c) => c.item.id), [high]);
  assert.equal(all.find((c) => c.item.id === high)?.item.dates?.[0]?.at, '2026-10-08');
  const filtered = await loadTimeline({ ...query, category: 'live', limit: 40 });
  assert.equal(filtered.cards.some((c) => c.headliner), false);
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${high}`;
  const after = await loadTimeline({ ...query, limit: 40 });
  assert.equal(after.cards.some((c) => c.item.id === high), false);
  assert.equal(after.cards.filter((c) => c.headliner).length, 1);
});
