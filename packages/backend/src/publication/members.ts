// 角色页（/member/<id>）与总览（/members）的读取层。
//
// 成员不是抓取主体：名单在 industry/members.ts 里跟代码一起发布，数据库里只有一份「哪篇文章提到了谁」
// 的投影（member_mentions，见 0063_member_mentions.sql）。所以这里读的是两样东西的交叉：代码里的
// 88 个成员，和投影表里各自的那一串 article_id。没有投影行不代表这一页不存在 —— 88 个页面都能打开，
// 只是没有报道的角色页会是空列表（站主 2026-10-05 拍板：提到它的报道 >= 5 篇才进 sitemap）。
//
// 与主题页同一套缓存思路：整份索引（每条报道提到谁）一次读进内存，60 秒内复用；测试给了 now 就绕过
// 缓存，直接按那个时刻重读。
import type { CategoryKey } from "@girlsbands/contracts/taxonomy";
import type { MemberLink, MemberPage, MemberProjectGroup, MemberSummary, MembersResponse } from "@girlsbands/contracts/site";
import { usable } from "@girlsbands/industry/glossary";
import { MEMBER_ENTITIES, memberById, type MemberEntity } from "@girlsbands/industry/members";
import { ENTITIES, seriesOf } from "@girlsbands/industry/taxonomy";
import { sql } from "../db.ts";
import { cached } from "../lib/cache.ts";
import { attachFeedDates } from "./feed-dates.ts";
import { ITEM_COLUMNS, ITEM_FROM, toFeedItemSummary, type ItemRow } from "./items.ts";
import { listedCondition } from "./scope.ts";

export const MEMBER_PAGE_SIZE = 20;
const DAY = 86_400_000;
const RECENT_DAYS = 30;
/** 进 sitemap 的门槛。主题页的 50/20 是给新闻主题定的，对一个角色太严（站主拍板：5 篇）。 */
const INDEXABLE_TOTAL = 5;

interface Mention {
  id: string;
  at: Date;
  title: string;
  category: CategoryKey | null;
}

type MemberIndex = Map<string, Mention[]>;

/**
 * 每条还列得出来的报道提到了谁。与页面读的是同一批报道（listedCondition：公开、已收录、已过静默期），
 * 所以下架或撤收录的文章会同时从角色页消失，不需要第二套过滤。
 */
async function readMentions(now: Date): Promise<MemberIndex> {
  const rows = await sql<{ member_id: string; id: string; at: Date; title: string; category: string | null }[]>`
    SELECT mm.member_id, p.article_id AS id, p.timeline_at AS at, p.title, p.category
    FROM member_mentions mm
    JOIN publications p ON p.article_id = mm.article_id
    WHERE ${listedCondition(now)}
    ORDER BY p.timeline_at DESC, p.article_id DESC`;
  const index: MemberIndex = new Map(MEMBER_ENTITIES.map((m) => [m.id, []]));
  for (const row of rows) {
    index.get(row.member_id)?.push({
      id: row.id,
      at: row.at,
      title: row.title,
      category: (row.category as CategoryKey | null) ?? null,
    });
  }
  return index;
}

const indexCache = cached(() => readMentions(new Date()), { freshMs: 60_000, maxStaleMs: 10 * 60_000 });

/** 给了 now 就按那个时刻重读（测试用），否则用 60 秒的缓存。 */
const memberIndex = (now?: Date) => (now ? readMentions(now) : indexCache.get());

function bandName(id: string): string {
  return ENTITIES[id]?.name ?? id;
}

/** 成员在别处的入口形状：名字、所属乐队。 */
export function memberLink(entity: MemberEntity): MemberLink {
  return { id: entity.id, name: entity.forms[0] ?? entity.id, band: entity.band, bandName: bandName(entity.band) };
}

/** 成员页认得的所有别名写法（一个别名的多种写法平铺在一起，页面照实列）。 */
function aliasForms(entity: MemberEntity): string[] {
  return [...new Set(entity.aliases.flat())].filter(usable);
}

function summarize(entity: MemberEntity, mentions: Mention[], at: Date): MemberSummary {
  const latest = mentions[0] ?? null;
  const since = at.getTime() - RECENT_DAYS * DAY;
  return {
    ...memberLink(entity),
    role: entity.role ?? null,
    actor: { name: entity.actor.forms[0] ?? "" },
    forms: [...entity.forms],
    aliases: aliasForms(entity),
    total: mentions.length,
    recent: mentions.filter((m) => m.at.getTime() > since).length,
    indexable: mentions.length >= INDEXABLE_TOTAL,
    latest: latest ? { title: latest.title, at: latest.at.toISOString() } : null,
  };
}

/** 名下有成员的乐队：企划取整个系列，乐队取自己。没有成员的（如 our-notes）不出现。 */
function bandsWithMembers(subject: string): string[] {
  return seriesOf(subject).filter((band) => MEMBER_ENTITIES.some((m) => m.band === band));
}

/**
 * /members：按企划分组的角色目录。分组顺序照 ENTITIES（企划在前），组内照系列里的乐队顺序，
 * 乐队内照 industry/members.ts 的顺序（与 TSV 一致）。没有挂到任何企划名下的乐队兜在最后一组，
 * 免得以后加人时悄悄漏掉一整支。
 */
export async function listMembers(now?: Date): Promise<MembersResponse> {
  const at = now ?? new Date();
  const index = await memberIndex(now);
  const summarizeAll = (band: string) =>
    MEMBER_ENTITIES.filter((m) => m.band === band).map((m) => summarize(m, index.get(m.id) ?? [], at));

  const groups: MemberProjectGroup[] = [];
  const seen = new Set<string>();
  for (const [project, entity] of Object.entries(ENTITIES)) {
    if (entity.kind !== "project") continue;
    const bands = bandsWithMembers(project);
    if (bands.length === 0) continue;
    for (const band of bands) seen.add(band);
    groups.push({
      project,
      projectName: entity.name,
      bands: bands.map((band) => ({
        id: band,
        name: bandName(band),
        accent: ENTITIES[band]?.accent ?? null,
        members: summarizeAll(band),
      })),
    });
  }

  const orphans = [...new Set(MEMBER_ENTITIES.map((m) => m.band))].filter((band) => !seen.has(band));
  if (orphans.length > 0) {
    groups.push({
      project: "",
      projectName: "其它",
      bands: orphans.map((band) => ({
        id: band,
        name: bandName(band),
        accent: ENTITIES[band]?.accent ?? null,
        members: summarizeAll(band),
      })),
    });
  }

  return { groups };
}

/**
 * 一个主体（乐队或企划）名下的角色。乐队页与企划页的侧栏读它，所以给的是带 bandName 的平铺列表，
 * 页面自己按乐队分组。不需要数据库：名单在代码里。
 */
export function memberLinks(subject: string): MemberLink[] {
  const bands = bandsWithMembers(subject);
  return MEMBER_ENTITIES.filter((m) => bands.includes(m.band)).map(memberLink);
}

/**
 * 一个角色页。id 不认识、页码不是正整数、或页码超过报道的页数时返回 null（出口翻成 404）。
 * 报道按 timeline_at 倒序分页；分类计数取全部报道（不只看当页），页面头部用它说明这一页有什么。
 */
export async function loadMemberPage(id: string, page: number, now?: Date): Promise<MemberPage | null> {
  const entity = memberById(id);
  if (!entity || !Number.isInteger(page) || page < 1) return null;
  const at = now ?? new Date();
  const mentions = (await memberIndex(now)).get(id) ?? [];
  const pageCount = Math.max(1, Math.ceil(mentions.length / MEMBER_PAGE_SIZE));
  if (page > pageCount) return null;

  const counts = new Map<CategoryKey, number>();
  for (const mention of mentions) {
    if (mention.category) counts.set(mention.category, (counts.get(mention.category) ?? 0) + 1);
  }

  const ids = mentions.slice((page - 1) * MEMBER_PAGE_SIZE, page * MEMBER_PAGE_SIZE).map((m) => m.id);
  // 按索引里的 id 取当页报道；再查一次是为了让下架、更正、刚发布的内容立刻生效（与主题页同样）。
  const rows =
    ids.length === 0
      ? []
      : await sql<ItemRow[]>`SELECT ${ITEM_COLUMNS} ${ITEM_FROM}
          JOIN member_mentions mm ON mm.article_id = p.article_id AND mm.member_id = ${id}
          WHERE p.article_id = ANY(${ids}::text[]) AND ${listedCondition(at)}
          ORDER BY p.timeline_at DESC, p.article_id DESC`;
  const items = rows.map(toFeedItemSummary);
  await attachFeedDates(items, at);

  return {
    member: summarize(entity, mentions, at),
    bandmates: MEMBER_ENTITIES.filter((m) => m.band === entity.band && m.id !== entity.id).map(memberLink),
    categories: [...counts].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count })),
    items,
    page,
    pageCount,
    pageSize: MEMBER_PAGE_SIZE,
  };
}

export interface MemberSitemapEntry {
  id: string;
  indexable: boolean;
  /** 最近一篇提到它的报道的时间；一篇都没有就是 null。 */
  changedAt: Date | null;
}

/** sitemap 用：哪些角色页该收录，以及各自最后变了的时间。 */
export async function memberSitemapEntries(now?: Date): Promise<MemberSitemapEntry[]> {
  const index = await memberIndex(now);
  return MEMBER_ENTITIES.map((m) => {
    const mentions = index.get(m.id) ?? [];
    return { id: m.id, indexable: mentions.length >= INDEXABLE_TOTAL, changedAt: mentions[0]?.at ?? null };
  });
}
