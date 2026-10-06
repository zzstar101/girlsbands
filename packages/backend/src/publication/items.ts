// Public read layer, item level. Every exit (site API, v1, RSS, MCP, sitemap) reads
// items through these columns and views; which rows are public is decided by scope.ts.
import type { CategoryKey, ChannelKey } from "@girlsbands/contracts/taxonomy";
import type { FeedItemSummary, ItemSummary, MediaView, XPostView } from "@girlsbands/contracts/site";
import { sql, type Db } from "../db.ts";
import { looksChinese } from "../lib/text.ts";
import { proxiedImage, proxiedImageSet } from "../media/imgproxy.ts";
import { coverOfMedia } from "./covers.ts";
import { displayTags, entityIds, entityTags, organizerColumn, organizerOf, publicSourceName } from "./rules.ts";
import { seatedCondition } from "./scope.ts";

export interface ItemRow {
  id: string;
  title: string;
  original_title: string | null;
  summary: string | null;
  reason: string | null;
  category: string | null;
  tags: string[];
  /** 谁办的活动：`official` / `fan` / null。来源身份与抽取判定合成一列（rules.ts 的 organizerColumn）。 */
  organizer: string | null;
  score: number | null;
  selected: boolean;
  channel: "news" | "x";
  url: string;
  published_at: Date | null;
  discovered_at: Date;
  timeline_at: Date;
  /** Holds its fact's selected seat (publish.ts settleSeats). */
  seat: boolean;
  visibility: string;
  body_mode: "full" | "summary";
  indexable: boolean;
  fact_id: number | null;
  source_name: string;
  /** Participation mode of the source now (editorial, hot_signal, isolated). */
  source_mode: string;
  x_post: Record<string, any> | null;
  author: string | null;
  language: string | null;
  /** 公告自己带的图；列表卡片左侧的小图从它里面挑（covers.ts 的 pickPicture）。 */
  media: unknown;
  story_public_id: string | null;
  story_title: string | null;
  zh_text: string | null;
  /** Chinese translation of the post an X post quotes. */
  quoted_zh: string | null;
  /** Cached name/avatar of the post's account: a mirror's retweet carries only a handle. */
  x_profile_name?: string | null;
  x_profile_avatar?: string | null;
  /** Cached name/avatar of the account an X post quotes. */
  x_quoted_name?: string | null;
  x_quoted_avatar?: string | null;
}

/** Columns every item listing selects. Internal judgement details never leave this layer. */
export const ITEM_COLUMNS = sql`
  p.article_id AS id, p.title, p.original_title, p.summary, p.reason, p.category, p.tags, p.score,
  p.selected, p.seat, p.channel, p.url, p.published_at, p.discovered_at, p.timeline_at, p.visibility,
  p.body_mode, p.indexable, p.fact_id, ${organizerColumn()} AS organizer,
  s.name AS source_name, s.participation_mode AS source_mode,
  a.x_post, a.author, a.language, a.media,
  xp.author_name AS x_profile_name, xp.avatar_url AS x_profile_avatar,
  xq.author_name AS x_quoted_name, xq.avatar_url AS x_quoted_avatar,
  st.public_id::text AS story_public_id, st.title AS story_title,
  CASE WHEN p.channel = 'x' THEN tr.body_text END AS zh_text, qt.text_zh AS quoted_zh`;

/** Public API listings never render article bodies, X media or story metadata. */
export type ApiItemRow = Pick<ItemRow, "id" | "title" | "original_title" | "summary" | "source_name" | "url" | "published_at" | "discovered_at" | "category" | "score" | "selected" | "reason">;
/** `selected` is the machine meaning: the report holds its fact's selected seat (scope.ts seatedCondition). */
export const API_ITEM_COLUMNS = sql`
  p.article_id AS id, p.title, p.original_title, p.summary, s.name AS source_name, p.url,
  p.published_at, p.discovered_at, p.category, p.score, (p.selected AND p.seat) AS selected, p.reason`;
export const API_ITEM_FROM = sql`FROM publications p JOIN sources s ON s.id = p.source_id`;

/** A translation of an older revision is left out: the original changed after it (the worker translates it again). */
export const ITEM_FROM = sql`
  FROM publications p
  JOIN sources s ON s.id = p.source_id
  JOIN articles a ON a.id = p.article_id
  LEFT JOIN analyses an ON an.id = p.analysis_id
  LEFT JOIN stories st ON st.id = p.story_id AND st.merged_into IS NULL
  LEFT JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh' AND tr.revision >= a.revision
  LEFT JOIN quote_translations qt ON p.channel = 'x' AND qt.tweet_id = substring(a.x_post->'quoted'->>'url' from '/status/([0-9]+)')
  /* 镜像的转推只给了 handle；名字和头像从缓存补，读路径因此不联网。handle 小写匹配（x-profiles 小写入库）。 */
  LEFT JOIN LATERAL (SELECT author_name, avatar_url FROM x_profiles WHERE handle = lower(a.x_post->>'handle')) xp ON true
  LEFT JOIN LATERAL (SELECT author_name, avatar_url FROM x_profiles WHERE handle = lower(a.x_post->'quoted'->>'handle')) xq ON true`;

export function channelCondition(channel: ChannelKey | null | undefined) {
  if (!channel || channel === "all") return sql``;
  if (channel === "firstParty") return sql`AND p.source_id IN (SELECT id FROM sources WHERE tier = 'T1')`;
  return sql`AND p.channel = ${channel}`;
}

export function categoryCondition(category: CategoryKey | null | undefined) {
  if (!category) return sql``;
  return sql`AND p.category = ${category}`;
}

export function tagCondition(tag: string | null | undefined) {
  if (!tag) return sql``;
  return sql`AND p.tags @> ${[tag]}::text[]`;
}

/**
 * 「只看关注」：每个主体展开成自己加上同系列的主体（企划＝整个系列，rules.ts entityTags），
 * 命中任意一个就算 —— 和主题页、截止雷达读同一批标签，语义不会两处不一样。
 * 一个都不剩（读者没关注任何主体）时不加条件：宁可显示全站，也不给出一页空白。
 */
export function subjectCondition(subjects: readonly string[] | null | undefined) {
  const tags = [...new Set((subjects ?? []).flatMap((id) => entityTags(id)))];
  if (tags.length === 0) return sql``;
  return sql`AND p.tags && ${tags}::text[]`;
}

/** 缓存键与游标绑定里的主体集合：去重排序，勾选顺序不同的地址共用同一份结果。 */
export function subjectKey(subjects: readonly string[] | null | undefined): string {
  return [...new Set(subjects ?? [])].sort().join(",");
}

function mediaView(m: Record<string, any>, mode: "card" | "thumb" | "full" = "thumb", responsive = false): MediaView | null {
  const url = proxiedImage(m.url, mode);
  if (!url) return null;
  const srcSet = responsive ? proxiedImageSet(m.poster ?? m.url, mode === "full" ? "body" : "card") : null;
  return {
    kind: m.kind === "video" ? "video" : "image",
    url,
    ...(responsive && mode !== "full" ? { fullUrl: proxiedImage(m.url, "full")! } : {}),
    ...(srcSet ? { srcSet } : {}),
    width: typeof m.width === "number" ? m.width : null,
    height: typeof m.height === "number" ? m.height : null,
    alt: m.alt ?? null,
    poster: m.poster ? proxiedImage(m.poster, mode === "card" ? "card" : "thumb") : null,
  };
}

export function xView(row: Pick<ItemRow, "x_post" | "zh_text"> & Partial<Pick<ItemRow, "quoted_zh" | "x_profile_name" | "x_profile_avatar" | "x_quoted_name" | "x_quoted_avatar">>, compact = false, responsive = compact): XPostView | null {
  const x = row.x_post;
  if (!x) return null;
  // rss.ts 给转推/引用作者写的是 handle 占位；缓存里查到真名再显示真名。
  // 每个作者跟自己的 handle 比：占位就是「名字栏里只有 handle」。
  const nameOf = (stored: string, ownHandle: string, cached?: string | null) => {
    const name = stored.trim();
    if (name && name !== ownHandle) return name;
    return cached?.trim() || ownHandle;
  };
  const handle = String(x.handle ?? "");
  const authorName = nameOf(String(x.authorName ?? ""), handle, row.x_profile_name);
  const quoted = x.quoted && typeof x.quoted === "object"
    ? {
      authorName: nameOf(String(x.quoted.authorName ?? ""), String(x.quoted.handle ?? ""), row.x_quoted_name),
      handle: String(x.quoted.handle ?? ""), text: String(x.quoted.text ?? ""), url: String(x.quoted.url ?? ""),
      translation: row.quoted_zh && row.quoted_zh.trim() !== String(x.quoted.text ?? "").trim() ? row.quoted_zh : null,
    }
    : null;
  const media = ((x.media ?? []) as Array<Record<string, any>>)
    .map((raw) => ({ raw, view: mediaView(raw, compact || !responsive ? "thumb" : "full", responsive) }))
    .filter((entry): entry is { raw: Record<string, any>; view: MediaView } => entry.view !== null);
  const quotedMedia = ((x.quoted?.media ?? []) as Array<Record<string, any>>)
    .map((raw) => mediaView(raw, "thumb", false))
    .filter((view): view is MediaView => view !== null);
  const quotedAvatar = x.quoted ? proxiedImage(x.quoted.avatarUrl ?? row.x_quoted_avatar, "avatar") : null;
  const quotedAvatarSrcSet = responsive && x.quoted ? proxiedImageSet(x.quoted.avatarUrl ?? row.x_quoted_avatar, "avatar") : null;
  const avatarSrcSet = responsive ? proxiedImageSet(x.avatarUrl ?? row.x_profile_avatar, "avatar") : null;
  return {
    authorName,
    handle,
    avatarUrl: proxiedImage(x.avatarUrl ?? row.x_profile_avatar, "avatar"),
    ...(avatarSrcSet ? { avatarSrcSet } : {}),
    text: String(x.text ?? ""),
    translation: row.zh_text && row.zh_text.trim() !== String(x.text ?? "").trim() ? row.zh_text : null,
    quoted: quoted ? {
      ...quoted,
      ...(quotedAvatar ? { avatarUrl: quotedAvatar } : {}),
      ...(quotedAvatarSrcSet ? { avatarSrcSet: quotedAvatarSrcSet } : {}),
      ...(quotedMedia.length ? { media: quotedMedia } : {}),
    } : null,
    retweetedBy: x.retweetedBy && typeof x.retweetedBy === "object" && String(x.retweetedBy.handle ?? "")
      ? { handle: String(x.retweetedBy.handle), authorName: x.retweetedBy.authorName ? String(x.retweetedBy.authorName) : null }
      : null,
    replyTo: x.replyTo ? String(x.replyTo) : null,
    // A multi-image list grid is 112 CSS px wide; one image can be 240 px. Keep 3x pixels for both.
    // Detail retains full media for the lightbox; srcSet bounds the displayed image.
    media: media.map(({ raw, view }) => compact && media.length > 1 ? mediaView(raw, "card", responsive)! : view),
  };
}

/** The shared public article; its X post is added as each answer shows it. */
export function toItemSummary(row: ItemRow): ItemSummary {
  return {
    id: row.id,
    title: row.title,
    originalTitle: row.original_title,
    summary: row.summary,
    reason: row.selected ? row.reason : null,
    source: { name: publicSourceName(row.source_name) },
    links: { original: row.url },
    publishedAt: row.published_at?.toISOString() ?? null,
    discoveredAt: row.discovered_at.toISOString(),
    timelineAt: row.timeline_at.toISOString(),
    category: (row.category as CategoryKey | null) ?? null,
    tags: displayTags(row.tags),
    subjects: entityIds(row.tags),
    organizer: organizerOf(row.organizer),
    score: row.score === null ? null : Math.round(Number(row.score)),
    selected: row.selected,
    channel: row.channel,
    story: row.story_public_id ? { publicId: row.story_public_id, title: row.story_title ?? "" } : null,
  };
}

/** Project the shared public article into the exact fields a site card renders. */
export function toFeedItemSummary(row: ItemRow): FeedItemSummary {
  const item = toItemSummary(row);
  // An X post's own text and media are its body: shown only where the source allows full text.
  const x = row.channel === "x" && row.body_mode === "full" ? xView(row, true) : null;
  return {
    id: item.id, title: item.title, summary: item.summary, reason: item.reason,
    source: item.source, publishedAt: item.publishedAt, timelineAt: item.timelineAt,
    category: item.category, tags: item.tags, subjects: item.subjects, organizer: item.organizer, score: item.score, selected: item.selected, channel: item.channel,
    // 列表里的小图（336 档）。X 帖在自己的 `x.media` 里带图，卡片不会用这一张。
    cover: coverOfMedia(row.media, "card"),
    x: x ? {
      authorName: x.authorName, handle: x.handle, avatarUrl: x.avatarUrl,
      ...(x.avatarSrcSet ? { avatarSrcSet: x.avatarSrcSet } : {}), media: x.media,
      quoted: x.quoted ? { authorName: x.quoted.authorName, handle: x.quoted.handle, text: x.quoted.text, translation: x.quoted.translation } : null,
    } : null,
  };
}

/**
 * An article written in Chinese: its language says so, or its text opens in Chinese without kana and it
 * is not marked English (the translator's rule, editorial/translate.ts; lib/text.ts `looksChinese`).
 * Every exit shows such a body as it is. Japanese shares the Han characters, so kana is what tells the
 * two apart and keeps a Japanese body from being served untranslated.
 */
export function isChineseBody(a: { language?: string | null; body_text?: string | null }): boolean {
  return a.language === "zh" || (looksChinese(a.body_text?.slice(0, 400) ?? "") && a.language !== "en");
}

/** The complete Chinese translation an export (Markdown, full RSS) carries; a page also shows a partial one. */
export function exportTranslation(a: { language?: string | null; body_text?: string | null; tr_html?: string | null; tr_complete?: boolean | null }): string | null {
  return !isChineseBody(a) && a.tr_html && a.tr_complete ? a.tr_html : null;
}

/**
 * For listed rows that are selected but yield their fact's seat: the report holding it, by row id.
 * (The home timeline folds these into reading groups; flat lists say which report stands for them.)
 */
export async function seatHolders(rows: ItemRow[], now: Date, db: Db = sql): Promise<Map<string, { id: string; title: string }>> {
  const yielding = rows.filter((r) => r.selected && !r.seat && r.fact_id !== null);
  if (!yielding.length) return new Map();
  const holders = await db<{ fact_id: number; id: string; title: string }[]>`
    SELECT p.fact_id, p.article_id AS id, p.title FROM publications p
    WHERE p.fact_id IN ${db([...new Set(yielding.map((r) => r.fact_id!))])} AND ${seatedCondition(now)}`;
  const byFact = new Map(holders.map((h) => [Number(h.fact_id), { id: h.id, title: h.title }]));
  return new Map(yielding.flatMap((r) => (byFact.has(Number(r.fact_id)) ? [[r.id, byFact.get(Number(r.fact_id))!] as const] : [])));
}
