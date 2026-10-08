// 声优日常（/seiyuu）的读取层：成员个人账号发的、站里已经收下的帖子，按时间倒序铺成一条时间线，
// 像在 X 上关注了她们。
//
// 范围只有一处——scope.ts 的 seiyuuCondition：收录进池子的（listedCondition）和日常 lane
// （dailyCondition）都算，下架的、整源撤参会的、BLOCK 掉的都不算。
//
// 排序和游标沿用 /all 的（timeline_at DESC, article_id DESC + 不透明游标），但这里按条数翻页，
// 给无限滚动用。账号字段（handle、头像）得从信源里认：生产上的成员账号是 Nitter 镜像的 RSS，
// 分析出的帖子带着 x_post；本地旧数据是 channel=news、没有 x_post，只能从原帖地址和信源地址反推。
import type { SeiyuuAccount, SeiyuuPost, SeiyuuResponse, XPostView } from "@girlsbands/contracts/site";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { sql } from "../db.ts";
import { decodeCursor, encodeCursor, InvalidCursorError, queryBinding } from "../lib/cursor.ts";
import { proxiedImage } from "../media/imgproxy.ts";
import { ITEM_COLUMNS, ITEM_FROM, toItemSummary, xView, type ItemRow } from "./items.ts";
import { publicSourceName } from "./rules.ts";
import { memberSourceCondition, seiyuuCondition } from "./scope.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 40;

export interface SeiyuuQuery {
  band?: string | null;
  account?: string | null;
  cursor?: string | null;
  limit?: number;
  now?: Date;
}

/** 帖子行 = 列表列 + 账号所属乐队、来源 id、来源配置（handle 需要读它）。 */
type SeiyuuRow = ItemRow & { source_id: string; band: string; source_config: unknown; posted_at: Date };

type AccountSource = { id: string; name: string; band: string };

/** 原帖地址里的账号段：https://x.com/<handle>/status/… ；Nitter 镜像的路径也是 /<handle>/…。 */
const HANDLE_URL = /^https?:\/\/(?:x\.com|twitter\.com|nitter\.[^/]+)\/([A-Za-z0-9_]{1,15})(?:\/|$)/;
/** x.com 上不是账号的段。 */
const NOT_A_HANDLE = ["i", "search", "hashtag", "home", "explore", "messages", "notifications", "settings"];

/** 信源地址：作者主页（x_search）的 url，rss 信源的 feedUrl。 */
function sourceUrl(config: unknown): string {
  const urls = (config ?? {}) as Record<string, unknown>;
  return String(urls.url ?? urls.feedUrl ?? "");
}

/**
 * 账号 handle：账号是信源本身，所以先看信源地址；转推的 x_post 和原帖地址指向的是原作者，
 * 只在信源地址认不出时才用。认不出来就是 null。
 */
function handleOf(post: { x_post?: Record<string, any> | null; url?: string | null }, config: unknown): string | null {
  const fromSource = HANDLE_URL.exec(sourceUrl(config));
  if (fromSource && !NOT_A_HANDLE.includes(fromSource[1]!)) return fromSource[1]!;
  const own = String(post.x_post?.retweetedBy?.handle ?? post.x_post?.handle ?? "").trim();
  if (own) return own;
  for (const url of [post.url]) {
    const found = url ? HANDLE_URL.exec(url) : null;
    if (found && !NOT_A_HANDLE.includes(found[1]!)) return found[1]!;
  }
  return null;
}

/** 头像缓存按 handle 补（0069_x_profiles.sql）：读路径不联网，认不出 handle 就只能是 null。表里 handle 一律小写，查询也跟着小写。 */
async function cachedAvatars(handles: readonly string[]): Promise<Map<string, string>> {
  if (!handles.length) return new Map();
  const wanted = [...new Set(handles.map((h) => h.toLowerCase()))];
  const rows = await sql<{ handle: string; avatar_url: string | null }[]>`SELECT handle, avatar_url FROM x_profiles WHERE handle = ANY(${wanted}::text[])`;
  return new Map(rows.flatMap((r) => (r.avatar_url ? [[r.handle, r.avatar_url] as const] : [])));
}

/**
 * 时间线的时间：帖子在 X 上发出的时间，像 X 一样按它从近到远排（站主 2026-10-08：按入库时间排时，镜像每小时
 * 一批进来，同一批里新旧帖子会错开）。转推按转推的时刻算——镜像不给转推时间，用入库时间代替（最多晚一个
 * 抓取周期）；原帖时间早于它的转推不能沉到底下去。发帖时间晚于入库时间（时钟不准）时取入库时间。
 */
const POSTED_AT = sql`(CASE WHEN jsonb_typeof(a.x_post->'retweetedBy') = 'object' THEN p.timeline_at
  ELSE least(coalesce(p.published_at, p.timeline_at), p.timeline_at) END)`;

export async function loadSeiyuu(query: SeiyuuQuery): Promise<SeiyuuResponse> {
  const now = query.now ?? new Date();
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const band = query.band?.trim() || null;
  const account = query.account?.trim() || null;
  // 游标绑住这一套筛选：换了乐队或账号就从第一页重新开始，不接着别人的尾巴。
  const bind = queryBinding({ band, account });
  let after: { t: Date; id: string } | null = null;
  if (query.cursor) {
    const c = decodeCursor<{ t: string; id: string; b: string }>("sy", query.cursor);
    const at = Date.parse(c.t);
    if (c.b !== bind || typeof c.id !== "string" || !c.t || Number.isNaN(at)) throw new InvalidCursorError("cursor does not match this query");
    after = { t: new Date(at), id: c.id };
  }
  const scope = seiyuuCondition(now);
  const filters = sql`${band ? sql`AND s.owner_entity_id = ${band}` : sql``} ${account ? sql`AND s.id = ${account}` : sql``}`;
  const [rows, bandIds, sources] = await Promise.all([
    sql<SeiyuuRow[]>`
      SELECT ${ITEM_COLUMNS}, s.id AS source_id, s.owner_entity_id AS band, s.config AS source_config, ${POSTED_AT} AS posted_at ${ITEM_FROM}
      WHERE ${scope} ${filters} ${after ? sql`AND (${POSTED_AT}, p.article_id) < (${after.t}, ${after.id})` : sql``}
      ORDER BY ${POSTED_AT} DESC, p.article_id DESC LIMIT ${limit + 1}`,
    // 顶部的乐队筛选框：有帖子的乐队，按 taxonomy 的顺序。（各筛选下都一样，换乐队时别让它跳。）
    sql<{ id: string }[]>`SELECT s.owner_entity_id AS id FROM publications p JOIN sources s ON s.id = p.source_id
      WHERE ${scope} GROUP BY s.owner_entity_id`,
    // 页头的账号卡片：点开单个账号时放它。筛选框里的账号不是成员账号、乐队也对不上时是 null，列表自然也是空的。
    account ? sql<{ id: string; name: string; owner_entity_id: string; config: unknown }[]>`
        SELECT s.id, s.name, s.owner_entity_id, s.config FROM sources s
        WHERE s.id = ${account} AND ${memberSourceCondition()} ${band ? sql`AND s.owner_entity_id = ${band}` : sql``}`
      : Promise.resolve([]),
  ]);
  const page = rows.slice(0, limit);
  const accountSource: AccountSource | undefined = sources[0]
    ? { id: sources[0]!.id, name: sources[0]!.name, band: sources[0]!.owner_entity_id }
    : undefined;
  // 页头账号的 handle 只能从信源地址认（点开单个账号时的那条帖子可能一页之外）。
  const accountHandle = handleOf({}, sources[0]?.config ?? null);
  const projected = page.map((row) => ({ row, x: row.channel === "x" && row.body_mode === "full" ? xView(row, true) : null, handle: handleOf(row, row.source_config) }));
  // 没有 x_post 的旧数据匹配不上 ITEM_FROM 里按帖子 handle 认的那条头像缓存 JOIN：按账号 handle 补一次，
  // 页头那个账号也一起，省一趟查询。
  const cached = await cachedAvatars([
    ...new Set([accountHandle, ...projected.filter((p) => p.x?.avatarUrl == null || p.x.retweetedBy).map((p) => p.handle)]
      .filter((h): h is string => h !== null)),
  ]);
  const accountOf = (source: AccountSource, x: XPostView | null, handle: string | null): SeiyuuAccount => ({
    id: source.id,
    name: publicSourceName(source.name),
    band: source.band,
    handle,
    // 帖子带头像（x_post 的名字和头像）就用它，否则退回缓存里那个账号的头像。转推的头像是原作者的，不算。
    // 缓存按小写 handle 存（0069_x_profiles.sql）。
    avatarUrl: (x && !x.retweetedBy ? x.avatarUrl : null) ?? proxiedImage(handle ? cached.get(handle.toLowerCase()) ?? null : null, "avatar"),
  });
  const posts: SeiyuuPost[] = projected.map((p) => {
    const item = toItemSummary(p.row);
    const account = accountOf({ id: p.row.source_id, name: p.row.source_name, band: p.row.band }, p.x, p.handle);
    return {
      id: item.id,
      title: item.title,
      summary: item.summary,
      url: item.links.original,
      timelineAt: item.timelineAt,
      publishedAt: item.publishedAt,
      postedAt: p.row.posted_at.toISOString(),
      category: item.category,
      band: p.row.band,
      account,
      x: p.x,
    };
  });
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeCursor("sy", { t: last.posted_at.toISOString(), id: last.id, b: bind }) : null;
  const order = new Map(Object.keys(ENTITIES).map((id, i) => [id, i] as const));
  const bands = [...new Set(bandIds.map((r) => r.id))]
    .filter((id) => order.has(id))
    .sort((a, b) => order.get(a)! - order.get(b)!)
    .map((id) => ({ id, name: ENTITIES[id]!.displayTag ?? ENTITIES[id]!.name }));
  return {
    filters: { band, account },
    posts,
    nextCursor,
    bands,
    accountInfo: accountSource ? accountOf(accountSource, null, accountHandle) : null,
  };
}
