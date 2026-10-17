// Public scope at read time. Every query that decides whether a report is public now,
// listed, selected, or evidence of its fact uses these predicates over `publications p` (and, for
// evidence, `fact_articles fa`); no other module spells visibility, the release time or the composite
// rule in SQL, and grouping takes the composite rule from here too. What a publication holds is
// derived once, at publish time, by publish.ts and rules.ts.
import { sql } from "../db.ts";

/**
 * Only confirmed news enters p.selected (publish.ts). The release timestamp also supports
 * historical imports and ensures every outlet uses the same actual publication time.
 */
export function releasedCondition(now: Date) {
  return sql`(NOT p.selected OR p.visible_after <= ${now})`;
}

/** Old/manual projections can retain eligible/selected flags after being filed as daily. */
function newsLaneCondition() {
  return sql`p.category IS DISTINCT FROM 'daily'`;
}

/** Listed on public surfaces at `now`: public, pool eligible, and released by then. */
export function listedCondition(now: Date) {
  return sql`p.visibility = 'public' AND p.eligible AND ${newsLaneCondition()} AND ${releasedCondition(now)}`;
}

/**
 * The members' daily lane (category `daily`, industry/taxonomy.ts): public posts with Chinese copy,
 * never pool eligible, so no news list, report or push meets them. Only the seiyuu timeline reads
 * this lane (seiyuuCondition below); /all no longer has a daily query bypass.
 */
export function dailyCondition() {
  return sql`p.visibility = 'public' AND p.category = 'daily' AND p.title IS NOT NULL AND p.summary IS NOT NULL`;
}

/**
 * 成员个人账号：`s` = sources，带 `成员` 标签、挂了主体（owner_entity_id）、editorial 参与。和
 * editorial/analyze.ts 的 isMemberAccount、rules.ts 的 hasItemPage 判同一件事。
 */
export function memberSourceCondition() {
  return sql`'成员' = ANY(s.tags) AND s.owner_entity_id IS NOT NULL AND s.participation_mode = 'editorial'`;
}

/**
 * 声优日常（/seiyuu）：只读成员个人账号的 daily lane，与消息池互斥。
 * 工作公告留在消息侧；没有个人表达的纯转帖即使被旧分析标成 daily，也不在日常显示。
 *
 * 只读成员账号（memberSourceCondition）：和 hasItemPage 同一道门，单条下架（visibility）和整源撤参会
 * 同时让帖子从这里消失。乐队/账号筛选、游标与分页在 publication/seiyuu.ts。
 *
 * 只放有 X 原帖、能全文显示的（channel x + body_mode full）：这一页照 X 卡片画原帖和译文，没有原帖的
 * 旧数据（上线前抓的、fxtwitter 也补不回来的）只剩 AI 写的摘要，站主 2026-10-08 定了不放进来。旧帖
 * 用 scripts/refresh-x-posts.ts xpost 补原帖。
 */
export function seiyuuCondition(_now: Date) {
  return sql`${dailyCondition()} AND ${memberSourceCondition()}
    AND p.channel = 'x' AND p.body_mode = 'full'
    AND NOT EXISTS (SELECT 1 FROM articles daily_article WHERE daily_article.id = p.article_id
      AND jsonb_typeof(daily_article.x_post->'retweetedBy') = 'object')`;
}

/** Story reports include older editorial material outside the pool, but never withdrawn or not yet released content. */
export function storyReportCondition(now: Date) {
  return sql`p.visibility = 'public' AND s.participation_mode = 'editorial' AND ${releasedCondition(now)}`;
}

/** Selected set as the website shows it (home timeline, reading groups, topics): every selected report. */
export function selectedCondition(now: Date) {
  return sql`p.visibility = 'public' AND p.selected AND ${newsLaneCondition()} AND p.visible_after <= ${now}`;
}

/**
 * The selected set as machines receive it (v1, RSS, the sync ledger): one seat per fact, held by its
 * representative (publish.ts settleSeats).
 */
export function seatedCondition(now: Date) {
  return sql`p.visibility = 'public' AND p.selected AND p.seat AND ${newsLaneCondition()} AND p.visible_after <= ${now}`;
}

/** The report was published from a composite (multi-topic) analysis: it only mentions facts. */
export function compositeCondition() {
  return sql`EXISTS (SELECT 1 FROM analyses evidence_an WHERE evidence_an.id = p.analysis_id AND evidence_an.output->>'scope' = 'composite')`;
}

/**
 * The same rule over the latest analysis of report `article`, for grouping (recall, story roots,
 * consolidation) and for publish.ts when it picks a publication's fact. They decide from the newest
 * analysis, which `p.analysis_id` only points to once the publication is rebuilt from it, and recall
 * also meets reports without a publication. Missing scope is unknown, never composite.
 */
export function latestCompositeCondition(article: ReturnType<typeof sql>) {
  return sql`(SELECT x.output->>'scope' = 'composite' FROM analyses x WHERE x.article_id = ${article}
    ORDER BY x.input_revision DESC, x.id DESC LIMIT 1) IS TRUE`;
}

/** `fa` links report `p` to a fact as evidence: a primary or report membership, never a composite. */
export function evidenceCondition() {
  return sql`fa.role <> 'mention' AND NOT ${compositeCondition()}`;
}

/**
 * Report `p` is still evidence of its own fact (`publications.fact_id`, written at publish time): a
 * membership removed or turned into a mention since then no longer counts.
 */
export function ownFactEvidenceCondition() {
  return sql`EXISTS (SELECT 1 FROM fact_articles fa WHERE fa.fact_id = p.fact_id AND fa.article_id = p.article_id AND ${evidenceCondition()})`;
}
