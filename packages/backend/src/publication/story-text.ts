// What the site tells readers about an event (the hot list and the event page), by the rule the digest is
// written by (events/digest.ts): its listed evidence. A digest stands while every report it was written
// from still is; the latest development is the newest such report. 情报变更（W14）也读在这里：最新一版
// 行上的 changes 就是「上一版 → 当前」这一次的变化，和 digest 同一条时效规则（证据都还列得出来）。
import { sql } from "../db.ts";
import { CHANGE_KINDS, isLoudChange, type ChangeKind, type StoryChange, type StoryChanges } from "@girlsbands/contracts/site";
import { evidenceCondition, listedCondition } from "./scope.ts";

export interface StoryText {
  digest: string | null;
  digestUpdatedAt: Date | null;
  /** 上一版报道 → 当前的变化；没有可比的一版、或这一版没有变化时是 null。 */
  changes: StoryChanges | null;
  /** The story's own factual summary. */
  summary: string | null;
  /** Its title, link and time come from the one report. */
  latest: { id: string; title: string; at: Date } | null;
}

/** 存进 changes 的东西由我们自己写，但读回来时仍按「认不出来的就丢掉」处理，坏一行不该让整页空。 */
function changeList(value: unknown): StoryChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.kind !== "string" || !(CHANGE_KINDS as readonly string[]).includes(row.kind)) return [];
    if (typeof row.text !== "string" || row.text === "") return [];
    return [{ kind: row.kind as ChangeKind, text: row.text, itemId: typeof row.itemId === "string" ? row.itemId : null }];
  });
}

export async function storyTexts(storyIds: number[], now = new Date()): Promise<Map<number, StoryText>> {
  if (storyIds.length === 0) return new Map();
  const rows = await sql<{ id: number; digest: string | null; digest_updated_at: Date | null; current: boolean; changes: unknown; changes_at: Date | null; summary: string | null; latest_id: string | null; latest_title: string; latest_at: Date }[]>`
    SELECT st.id, st.digest, st.digest_updated_at, st.summary,
      NOT EXISTS (
        SELECT 1 FROM unnest(d.article_ids) AS input(article_id)
        WHERE NOT EXISTS (SELECT 1 FROM facts f JOIN fact_articles fa ON fa.fact_id = f.id JOIN publications p ON p.article_id = fa.article_id
          WHERE f.story_id = st.id AND p.article_id = input.article_id AND ${evidenceCondition()} AND ${listedCondition(now)})
      ) AS current,
      d.changes, d.created_at AS changes_at,
      latest.id AS latest_id, latest.title AS latest_title, latest.at AS latest_at
    FROM stories st LEFT JOIN LATERAL (
      SELECT article_ids, changes, created_at FROM story_digests WHERE story_id = st.id ORDER BY version DESC LIMIT 1
    ) d ON true LEFT JOIN LATERAL (
      SELECT p.article_id AS id, p.title, coalesce(p.published_at, p.discovered_at) AS at
      FROM facts f JOIN fact_articles fa ON fa.fact_id = f.id JOIN publications p ON p.article_id = fa.article_id
      WHERE f.story_id = st.id AND ${evidenceCondition()} AND ${listedCondition(now)}
      ORDER BY coalesce(p.published_at, p.discovered_at) DESC, p.article_id LIMIT 1
    ) latest ON true
    WHERE st.id = ANY(${storyIds}::bigint[])`;
  return new Map(rows.map((r) => {
    const items = r.current ? changeList(r.changes) : [];
    return [Number(r.id), {
      digest: r.current ? r.digest : null,
      digestUpdatedAt: r.current ? r.digest_updated_at : null,
      changes: items.length > 0 && r.changes_at ? { items, kinds: [...new Set(items.map((i) => i.kind))].filter(isLoudChange), at: r.changes_at.toISOString() } : null,
      summary: r.summary,
      latest: r.latest_id ? { id: r.latest_id, title: r.latest_title, at: r.latest_at } : null,
    }];
  }));
}
