// 一份报告在读者眼里的样子：story 页、演出页都用这一份投影，两个页面就不会把同一条报告说得不一样。
// 可见性只有一条规则（scope.storyReportCondition）：有公开页面的 editorial 报告，含被提到的那条。
import type { StoryReportView } from "@girlsbands/contracts/site";
import { sql } from "../db.ts";
import { REPRESENTATIVE_COLUMNS, type RepresentativeIdentity } from "./representative.ts";
import { compositeCondition, storyReportCondition } from "./scope.ts";
import { publicSourceName } from "./rules.ts";

export interface ReportRow extends RepresentativeIdentity {
  role: string;
  body_mode: "full" | "summary";
  score: number | null;
  timeline_at: Date;
  id: string;
  title: string;
  summary: string | null;
  url: string;
  selected: boolean;
  at: Date;
  source_id: string;
  source_name: string;
  first_party: boolean;
  fact_id: number;
}

export function reportView(r: ReportRow): StoryReportView {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    source: { name: publicSourceName(r.source_name), firstParty: r.first_party },
    publishedAt: r.at.toISOString(),
    selected: r.selected,
  };
}

/**
 * The reports matching `where` over `facts f`, one row per article, newest membership first. Every
 * caller passes the same visibility rule, so a withdrawn report disappears from all of them at once.
 */
export async function reportRows(where: ReturnType<typeof sql>, now: Date): Promise<ReportRow[]> {
  return sql<ReportRow[]>`
    SELECT DISTINCT ON (p.article_id) p.article_id AS id, p.title, p.summary, p.url, p.selected,
      coalesce(p.published_at, p.discovered_at) AS at, s.id AS source_id, s.name AS source_name,
      (s.tier = 'T1') AS first_party, f.id AS fact_id,
      CASE WHEN ${compositeCondition()} THEN 'mention' ELSE fa.role END AS role, p.body_mode, p.score, p.timeline_at, ${REPRESENTATIVE_COLUMNS}
    FROM facts f JOIN fact_articles fa ON fa.fact_id = f.id JOIN publications p ON p.article_id = fa.article_id
    JOIN sources s ON s.id = p.source_id
    WHERE ${where} AND ${storyReportCondition(now)}
    ORDER BY p.article_id, (fa.role = 'primary') DESC, (fa.role <> 'mention') DESC, f.id`;
}

/**
 * Every report linked to the story's facts that has a public page (rules.hasItemPage: editorial source,
 * summarised or not), mentions included (an article's other events). New grouping only links
 * pool-eligible articles; imported hot stories also carry reports the pool leaves out. hot_signal
 * material only adds heat and is not listed.
 */
export async function storyReports(storyId: number, now: Date): Promise<ReportRow[]> {
  return reportRows(sql`f.story_id = ${storyId}`, now);
}

/**
 * 一个演出名下所有 fact 的报告，投影与 story 页完全一致：演出的报告会散在几条 fact 上（公告一条、
 * 售票一条），但读者看到的是同一场演出。最新的在前。
 */
export async function liveReports(factIds: number[], now: Date): Promise<StoryReportView[]> {
  if (factIds.length === 0) return [];
  const rows = await reportRows(sql`f.id = ANY(${factIds}::bigint[])`, now);
  return rows
    .map(reportView)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
}
