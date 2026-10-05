// 详情页的主视觉：公告自己带的图，走站内图片代理（签名 + 多尺寸），跟正文里的图共用同一份缓存。
//
// 选图规则只有一处 —— lib/image-url.ts 的 pickPicture：跳过追踪像素、站外 favicon 与已知太窄的
// 缩略图，取第一张真插画。这里的 SQL 只负责排序：代表性公告优先（第一方、已选中、分数高的在前），
// 与热榜封面同一套可见性条件，所以下架的报告不会把图留在页面上。
import type { CoverView } from "@girlsbands/contracts/site";
import { sql } from "../db.ts";
import { firstPicture, pickPicture, type Picture } from "../lib/image-url.ts";
import { proxiedImage, proxiedImageSet, type ProxyMode } from "../media/imgproxy.ts";
import type { ResponsiveImageKind } from "../media/renditions.ts";
import { storyReportCondition } from "./scope.ts";

/** 一场活动最多看几条公告的图，再没有就不放图。 */
const MAX_CANDIDATES = 12;

/**
 * 图用在哪：`detail` 是页面主视觉（1200 那档 + hero，720/1200/1600），`card` 是列表里的小图
 * （336 那档 + card，336/720，调用方必须给 `sizes`，否则浏览器会按 100vw 挑最大的那张）。
 */
export type CoverSize = "detail" | "card";

const COVER_MODES: Record<CoverSize, { mode: ProxyMode; kind: ResponsiveImageKind }> = {
  detail: { mode: "image-1200", kind: "hero" },
  card: { mode: "image-336", kind: "card" },
};

/** 主视觉：src 走这个尺寸的主档，srcSet 走它那一套；没有图就是 null。 */
export function coverView(picture: Picture | null, size: CoverSize = "detail"): CoverView | null {
  if (picture === null) return null;
  const spec = COVER_MODES[size];
  const url = proxiedImage(picture.url, spec.mode);
  if (url === null) return null;
  const srcSet = proxiedImageSet(picture.url, spec.kind);
  return { url, ...(srcSet ? { srcSet } : {}), width: picture.width, height: picture.height };
}

/** 一条公告自己的图（条目页手里已经有它的 media，碟页读它第一条公告）。 */
export function coverOfMedia(media: unknown, size: CoverSize = "detail"): CoverView | null {
  return coverView(pickPicture(media), size);
}

/** 一条 story 的封面：它自己公开报告里第一张能用的图。 */
export async function coverOfStory(storyId: number, now: Date): Promise<CoverView | null> {
  const rows = await sql<{ media: unknown }[]>`
    SELECT a.media
    FROM publications p JOIN articles a ON a.id = p.article_id JOIN sources s ON s.id = p.source_id
    WHERE p.story_id = ${storyId} AND ${storyReportCondition(now)}
    ORDER BY p.first_party DESC, p.selected DESC, coalesce(p.score, 0) DESC, p.article_id DESC
    LIMIT ${MAX_CANDIDATES}`;
  return coverView(firstPicture(rows.map((row) => row.media)));
}

/** 一场演出 / 一张碟的封面：它名下那些公告里第一张能用的图（演出拿报告 id，碟拿第一条公告）。 */
export async function coverOfItems(itemIds: string[], now: Date, size: CoverSize = "detail"): Promise<CoverView | null> {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return null;
  const rows = await sql<{ media: unknown }[]>`
    SELECT a.media
    FROM publications p JOIN articles a ON a.id = p.article_id JOIN sources s ON s.id = p.source_id
    WHERE p.article_id = ANY(${ids}::text[]) AND ${storyReportCondition(now)}
    ORDER BY p.first_party DESC, p.selected DESC, coalesce(p.score, 0) DESC, p.article_id DESC
    LIMIT ${MAX_CANDIDATES}`;
  return coverView(firstPicture(rows.map((row) => row.media)), size);
}

/**
 * 一批公告各自的封面，一次查询按公告 id 归位（列表里一场演出 / 一张碟各查一次就太吵了）。
 * 只有查到图的条目才在 Map 里；同一篇公告投了多份（不同来源）时，排序最前的那一行说了算。
 */
export async function coversOfItems(itemIds: string[], now: Date, size: CoverSize = "card"): Promise<Map<string, CoverView>> {
  const ids = [...new Set(itemIds.filter((id) => !!id))];
  const out = new Map<string, CoverView>();
  if (ids.length === 0) return out;
  const rows = await sql<{ id: string; media: unknown }[]>`
    SELECT p.article_id AS id, a.media
    FROM publications p JOIN articles a ON a.id = p.article_id JOIN sources s ON s.id = p.source_id
    WHERE p.article_id = ANY(${ids}::text[]) AND ${storyReportCondition(now)}
    ORDER BY p.first_party DESC, p.selected DESC, coalesce(p.score, 0) DESC, p.article_id DESC`;
  for (const row of rows) {
    if (out.has(row.id)) continue;
    const cover = coverOfMedia(row.media, size);
    if (cover) out.set(row.id, cover);
  }
  return out;
}
