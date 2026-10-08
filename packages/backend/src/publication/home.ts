// Homepage figures use the same public scope and date reader as the feed and calendar.
import type { HomeResponse } from "@girlsbands/contracts/site";
import { ENTITIES, FRANCHISES } from "@girlsbands/industry/taxonomy";
import { beijingDate } from "@girlsbands/contracts/time";
import { sql } from "../db.ts";
import { deadlineRange, jstDate, addDays } from "./deadlines.ts";
import { entityTags, hasItemPage } from "./rules.ts";
import { listedCondition } from "./scope.ts";

export async function loadHome(now = new Date()): Promise<HomeResponse> {
  const today = beijingDate(now);
  const from = jstDate(now);
  const [rows, sources, dates] = await Promise.all([
    sql<{ id: string; title: string; tags: string[]; category: string | null; timeline_at: Date; visibility: string; source_mode: string }[]>`
      SELECT p.article_id AS id, p.title, p.tags, p.category, p.timeline_at, p.visibility, s.participation_mode AS source_mode
      FROM publications p JOIN sources s ON s.id = p.source_id
      WHERE ${listedCondition(now)} AND s.participation_mode = 'editorial'
        AND p.timeline_at >= ${new Date(now.getTime() - 7 * 86_400_000)} AND p.timeline_at <= ${now}
      ORDER BY p.timeline_at DESC, p.article_id`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sources WHERE enabled`,
    deadlineRange(now, { from, to: addDays(from, 30) }),
  ]);
  const publicRows = rows.filter((r) => hasItemPage({ visibility: r.visibility, sourceMode: r.source_mode }));
  // Timed dates already passed today must not keep a live countdown on the homepage.
  // Bare dates remain day-level facts, never invented 23:59 deadlines.
  const upcoming = dates.filter((d) => d.at.length === 10 || Date.parse(`${d.at}:00+09:00`) >= now.getTime());
  const closing = upcoming.filter((d) => d.kind === 'lottery_end' || d.kind === 'stream_end');
  const weekEnd = addDays(from, (7 - new Date(`${from}T00:00:00Z`).getUTCDay()) % 7);
  const bandWeek = Object.fromEntries(Object.entries(ENTITIES).filter(([, e]) => e.kind === 'band').map(([id]) => [id, publicRows.filter((r) => r.tags.includes(`entity:${id}`)).length]));
  const trackCounts = Object.fromEntries(['live', 'ticket', 'release', 'notice', 'game'].map((category) => [category, publicRows.filter((r) => r.category === category).length]));
  return {
    computedAt: now.toISOString(), today,
    stats: { today: publicRows.filter((r) => beijingDate(r.timeline_at) === today).length, soon: closing.filter((d) => d.soon).length,
      weekDeadlines: closing.filter((d) => d.day <= weekEnd).length, monthDates: upcoming.length,
      bands: Object.keys(bandWeek).length, sources: sources[0]?.n ?? 0 },
    bandWeek, trackCounts,
    bandMonthDeadlines: Object.fromEntries(Object.keys(bandWeek).map((id) => [id, closing.filter((d) => d.subjects.includes(id)).length])),
    projects: Object.fromEntries(FRANCHISES.map((id) => {
      const tags = entityTags(id);
      const items = publicRows.filter((r) => r.tags.some((t) => tags.includes(t)));
      const members = new Set(tags.map((t) => t.slice(7)));
      return [id, { latest: items[0] ? { id: items[0].id, title: items[0].title } : null,
        today: items.filter((r) => beijingDate(r.timeline_at) === today).length,
        deadlines: closing.filter((d) => d.subjects.some((s) => members.has(s))).length }];
    })),
    deadlines: { computedAt: now.toISOString(), from, to: addDays(from, 30), total: upcoming.length,
      days: [...new Set(upcoming.map((d) => d.day))].map((date) => ({ date, items: upcoming.filter((d) => d.day === date) })) },
  };
}
