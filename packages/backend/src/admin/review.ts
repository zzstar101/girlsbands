// The weekly Chinese spot check. The owner reads 20 published items a week with the original next
// to the translation, looking for a name, date or price the model got wrong. The sample is drawn
// from one ISO week (Beijing), so a problem found on Monday can be looked at again on Friday, and
// it is ordered by a hash of the item id and the week, so it does not depend on the sort order of
// anything that changes while you read. Pass a different `seed` for a fresh draw.
import type { AdminReview, AdminReviewItem, BeforeJson } from "@girlsbands/contracts/admin";
import { REVIEW_CHARS } from "@girlsbands/contracts/admin";
import { beijingDate, isoWeekLabel, isoWeekRange } from "@girlsbands/contracts/time";
import { glossaryHits } from "@girlsbands/industry/glossary";
import { sql } from "../db.ts";

interface Row {
  article_id: string;
  source: string;
  source_kind: string;
  language: string | null;
  url: string;
  selected: boolean | null;
  title: string;
  title_zh: string | null;
  body: string;
  body_zh: string | null;
  complete: boolean;
  published_at: Date | null;
  discovered_at: Date;
}

/** This week's label in Beijing time, e.g. `2026-W41`. */
export function currentWeek(at: Date = new Date()): string {
  return isoWeekLabel(beijingDate(at));
}

/**
 * The sample. Only items a reader can actually open in Chinese: published, full text, translated
 * by the model. `total` is how many there were, so a short list is never read as "the site is empty".
 */
export async function reviewSample(seed?: string, limit = 20): Promise<BeforeJson<AdminReview>> {
  const key = seed?.trim() || currentWeek();
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM publications p
    JOIN articles a ON a.id = p.article_id
    JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh'
    WHERE p.visibility = 'public' AND p.body_mode = 'full' AND tr.origin = 'model'`;
  const rows = await sql<Row[]>`
    SELECT p.article_id, s.name AS source, s.kind AS source_kind, a.language, a.url, p.selected,
           a.title, tr.title AS title_zh, coalesce(a.body_text, '') AS body, tr.body_text AS body_zh,
           tr.complete, a.published_at, a.discovered_at
    FROM publications p
    JOIN articles a ON a.id = p.article_id
    JOIN sources s ON s.id = a.source_id
    JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh'
    WHERE p.visibility = 'public' AND p.body_mode = 'full' AND tr.origin = 'model'
    ORDER BY md5(p.article_id || ${key})
    LIMIT ${limit}`;
  return {
    seed: key,
    week: isoWeekRange(key),
    total: n,
    rows: rows.map((r) => {
      const body = r.body.slice(0, REVIEW_CHARS);
      const bodyZh = r.body_zh === null ? null : r.body_zh.slice(0, REVIEW_CHARS);
      const item: BeforeJson<AdminReviewItem> = {
        article_id: r.article_id,
        source: r.source,
        source_kind: r.source_kind,
        language: r.language,
        url: r.url,
        selected: r.selected,
        title: r.title,
        title_zh: r.title_zh,
        body,
        body_zh: bodyZh,
        cut: r.body.length > body.length || (r.body_zh?.length ?? 0) > (bodyZh?.length ?? 0),
        complete: r.complete,
        published_at: r.published_at,
        discovered_at: r.discovered_at,
        // The preferred spelling of every name the original mentions: the list to check the
        // translation against. Same call the translate prompt uses, so the page and the model
        // are looking at the same names.
        names: [...new Set(glossaryHits(r.body).map((e) => e.forms[0]!))],
      };
      return item;
    }),
  };
}
