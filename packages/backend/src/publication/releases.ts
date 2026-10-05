// 一张碟的公开读取：碟页、主体页上那一栏列表、story 页上那一行。
//
// 可见性跟其它公开出口一套：公告被下架或还没到发布时间，这张碟的页面跟着 404（与 live_events 同一条
// 规则）。日期也不在这里造第三份 —— 发售日就是行上的 `release_on`（原文那一地的日历），序列号的应募
// 期间属于它指向的那场演出的轮次，这里只把那个轮次的入口给出去。
import type { ReleaseBonusView, ReleaseEditionView, ReleaseKind, ReleaseSerialView, ReleaseSummary, ReleaseView, Timezone } from "@girlsbands/contracts/site";
import { timezoneDate } from "@girlsbands/contracts/time";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { sql } from "../db.ts";
import { liveRefs } from "./lives.ts";
import { storyReportCondition } from "./scope.ts";

const MAX_SUBJECT_RELEASES = 40;

interface ReleaseRow {
  id: number;
  public_id: string;
  subject_entity: string;
  title: string;
  kind: ReleaseKind;
  release_on: string | null;
  announced_on: string | null;
  timezone: Timezone;
  story_public_id: string | null;
  story_title: string | null;
  first_seen_at: Date;
  updated_at: Date;
}

/** 公告还在公开出口上：撤稿、下架或还没到发布时间，这张碟就不该被读到。 */
const visibleCondition = (now: Date) => sql`
  EXISTS (
    SELECT 1 FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE p.article_id = r.first_article_id AND ${storyReportCondition(now)}
  )`;

/** story_id 会被合并：读的时候跟到还活着的那一条，公开 id 才跟着 308 走。 */
const RELEASE_COLUMNS = sql`
  r.id, r.public_id::text AS public_id, r.subject_entity, r.title, r.kind,
  r.release_on::text AS release_on, r.announced_on::text AS announced_on, r.timezone,
  st.public_id::text AS story_public_id, st.title AS story_title,
  r.first_seen_at, r.updated_at`;
const RELEASE_FROM = sql`
  FROM releases r
  LEFT JOIN stories st0 ON st0.id = r.story_id
  LEFT JOIN stories st ON st.id = COALESCE(st0.merged_into, st0.id)`;
/** 列表行额外带的两个数：有几个版本、有没有序列号（页面自己不去数第二遍）。 */
const RELEASE_COUNTS = sql`
  (SELECT count(*)::int FROM release_editions e WHERE e.release_id = r.id) AS edition_count,
  EXISTS (SELECT 1 FROM release_serials sr WHERE sr.release_id = r.id) AS has_serial`;

/** 发售日按它自己那一地的钟算还有几天：过了就是负数，只写「今冬」的没有这一行。 */
function daysLeftOf(row: Pick<ReleaseRow, "release_on" | "timezone">, now: Date): number | null {
  if (row.release_on === null) return null;
  return Math.round((Date.parse(row.release_on) - Date.parse(timezoneDate(row.timezone, now))) / 86400000);
}

function summaryOf(row: ReleaseRow & { edition_count: number; has_serial: boolean }, now: Date): ReleaseSummary {
  return {
    publicId: row.public_id,
    subject: row.subject_entity,
    subjectName: ENTITIES[row.subject_entity]?.name ?? row.subject_entity,
    title: row.title,
    kind: row.kind,
    releaseOn: row.release_on,
    daysLeft: daysLeftOf(row, now),
    editionCount: row.edition_count,
    hasSerial: row.has_serial,
  };
}

/** 一个主体的碟：最近的发售在前，还没定发售日的排在最后。 */
export async function releasesForSubject(subject: string, now: Date, limit = 12): Promise<ReleaseSummary[]> {
  const rows = await sql<Array<ReleaseRow & { edition_count: number; has_serial: boolean }>>`
    SELECT ${RELEASE_COLUMNS}, ${RELEASE_COUNTS}
    ${RELEASE_FROM}
    WHERE r.subject_entity = ${subject} AND ${visibleCondition(now)}
    ORDER BY r.release_on DESC NULLS LAST, r.announced_on DESC NULLS LAST, r.id DESC
    LIMIT ${MAX_SUBJECT_RELEASES}`;
  return rows.slice(0, limit).map((row) => summaryOf(row, now));
}

/** 这一条 story 讲的是哪张碟（它自己的页面上那一行「这张碟」）。 */
export async function releaseOfStory(storyId: number, now: Date): Promise<ReleaseSummary | null> {
  const rows = await sql<Array<ReleaseRow & { edition_count: number; has_serial: boolean }>>`
    SELECT ${RELEASE_COLUMNS}, ${RELEASE_COUNTS}
    ${RELEASE_FROM}
    WHERE (st0.id = ${storyId} OR st0.merged_into = ${storyId}) AND ${visibleCondition(now)}
    ORDER BY r.release_on DESC NULLS LAST, r.id DESC
    LIMIT 1`;
  const [row] = rows;
  if (!row) return null;
  return summaryOf(row, now);
}

/** 一张碟的页面：版本、店铺特典、序列号指向哪场演出。公告不公开了就是 404。 */
export async function loadRelease(publicId: string, now = new Date()): Promise<ReleaseView | null> {
  const rows = await sql<ReleaseRow[]>`SELECT ${RELEASE_COLUMNS} ${RELEASE_FROM} WHERE r.public_id = ${publicId} AND ${visibleCondition(now)}`;
  const [row] = rows;
  if (!row) return null;
  const [editions, bonuses, serials] = await Promise.all([
    sql<{ name: string; kind: ReleaseEditionView["kind"]; includes_bluray: boolean; includes_serial: boolean; price_yen: number | null; sku: string | null; quote: string | null }[]>`
      SELECT name, kind, includes_bluray, includes_serial, price_yen, sku, quote
      FROM release_editions WHERE release_id = ${row.id} ORDER BY id`,
    sql<{ retailer: string; bonus: string; first_press: boolean; edition_name: string | null; url: string | null; quote: string | null }[]>`
      SELECT b.retailer, b.bonus, b.first_press, e.name AS edition_name, b.url, b.quote
      FROM release_bonuses b LEFT JOIN release_editions e ON e.id = b.edition_id
      WHERE b.release_id = ${row.id} ORDER BY b.id`,
    sql<{ kind: ReleaseSerialView["kind"]; live_event_id: number | null; live_title: string | null; url: string | null; quote: string | null }[]>`
      SELECT kind, live_event_id, live_title, url, quote
      FROM release_serials WHERE release_id = ${row.id} ORDER BY id`,
  ]);
  // 序列号能指到一场有页面的演出时给出那一行；指不到就只留原文写的名字。
  const refs = await liveRefs(serials.flatMap((s) => (s.live_event_id === null ? [] : [s.live_event_id])), now);
  return {
    publicId: row.public_id,
    subject: row.subject_entity,
    subjectName: ENTITIES[row.subject_entity]?.name ?? row.subject_entity,
    title: row.title,
    kind: row.kind,
    releaseOn: row.release_on,
    announcedOn: row.announced_on,
    timezone: row.timezone,
    daysLeft: daysLeftOf(row, now),
    editions: editions.map((e) => ({
      name: e.name, kind: e.kind, includesBluray: e.includes_bluray, includesSerial: e.includes_serial,
      priceYen: e.price_yen, sku: e.sku, quote: e.quote,
    })),
    bonuses: bonuses.map((b): ReleaseBonusView => ({
      retailer: b.retailer, bonus: b.bonus, firstPress: b.first_press, editionName: b.edition_name,
      url: b.url, quote: b.quote,
    })),
    serials: serials.map((s): ReleaseSerialView => ({
      kind: s.kind,
      live: s.live_event_id === null ? null : refs.get(s.live_event_id) ?? null,
      liveTitle: s.live_title,
      url: s.url,
      quote: s.quote,
    })),
    story: row.story_public_id === null ? null : { publicId: row.story_public_id, title: row.story_title ?? row.title },
    firstSeenAt: (row.first_seen_at ?? now).toISOString(),
    updatedAt: (row.updated_at ?? now).toISOString(),
  };
}

/** 进 sitemap 的碟页：跟别的入口一样，只有公告还在公开出口上的那些。 */
export async function releaseSitemapEntries(now: Date, limit: number): Promise<Array<{ publicId: string; lastmod: Date }>> {
  return await sql<{ publicId: string; lastmod: Date }[]>`
    SELECT r.public_id::text AS "publicId", r.updated_at AS lastmod
    FROM releases r
    WHERE ${visibleCondition(now)}
    ORDER BY r.updated_at DESC
    LIMIT ${limit}`;
}
