// Share images need public title/summary metadata plus the lead picture the announcement already
// carries. Keep the same page visibility rule without loading bodies, translations or related stories.
import type { CategoryKey } from '@girlsbands/contracts/taxonomy';
import { sql } from '../db.ts';
import { coverOfMedia } from './covers.ts';
import { hasItemPage, publicSourceName } from './rules.ts';

export async function loadItemShare(id: string) {
  const [row] = await sql<{
    id: string; title: string; summary: string | null; category: CategoryKey | null; selected: boolean;
    score: number | null; timeline_at: Date; source_name: string; source_mode: string; visibility: string;
    media: unknown; tags: string[] | null;
  }[]>`SELECT p.article_id AS id, p.title, p.summary, p.category, p.selected, p.score, p.timeline_at,
      s.name AS source_name, s.participation_mode AS source_mode, p.visibility, a.media, p.tags
    FROM publications p JOIN sources s ON s.id = p.source_id JOIN articles a ON a.id = p.article_id
    WHERE p.article_id = ${id}`;
  if (!row || !hasItemPage({ visibility: row.visibility, sourceMode: row.source_mode })) return null;
  return { id: row.id, title: row.title, summary: row.summary, category: row.category, selected: row.selected,
    score: row.score === null ? null : Math.round(Number(row.score)), timelineAt: row.timeline_at.toISOString(),
    cover: coverOfMedia(row.media), source: { name: publicSourceName(row.source_name) }, tags: row.tags ?? [] };
}
