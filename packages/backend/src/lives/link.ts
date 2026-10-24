// Live 身份的推导：一场演出得有一个不会随报告合并、story 跳转而变动的地址。
//
// facts 挂 story_id，而 story 会被合并、会 308 跳转，所以「哪一场演出」这件事没地方算；`live_events` 就是
// 这个身份，键是推导出来的 `(主体, 会场, 开演日, 开演时刻)`，不靠模型记忆。
//
// 三个调用方，同一套规则：
//   阶段 A（实时链路） events/group.ts 写完 fact 就调 linkLiveEvent()，键完全由确定性规则推出；
//   阶段 B（模型）     editorial/analyze.ts 的 runLiveTicket 把结果写进 analyses.output.live，推导优先用它
//                      （会场、开演时刻、最后一天、公告自己说的状态），没有才退回正文；
//   回填（老数据）     scripts/backfill-live-events.ts 对已经入库的 fact 重跑同一个推导。
//
// 推不出主体或日期就不建实体：一场演出宁可没有页面，也不能把两场演出并成一个。会场只认「恰好一个」
// 命中 —— 巡演公告里同时写着几个会场时留 null，让键退化成 `(主体, 开演日, 开演时刻)`。
//
// 反过来，同一场演出也不能被拆成两页：两家分别报道时，一家可能把主体标成企划、会场又写成另一种写法，
// 键就错开了（香港 2026-10-02 的 `girls-band-cry` / `togenashi-togeari` 两页）。所以新建之前先按
// `sameShow()` 找一遍同一天同一开演时刻、演出名一致、会场对得上的行 —— 有就补空，不新建。
//
// 「有日期的活动」不等于演出：生放送（`stream`）、展览与快闪店（`collab`）也会被 structure 抽成
// `kind='event'` 的日期。所以一条事实底下至少得有一个 `publications.category` 是 `live` 或 `ticket` 的
// 条目，才认它是演出（dev 库实测：6 个候选里 `stream`/`collab` 三条是误建）。同一事实可能同时挂着
// `notice` 与 `ticket` 两篇，所以判据是「有」，不是「那一条」。
import type { LiveStatus, Timezone } from "@girlsbands/contracts/site";
import { glossaryHits, venueTimezone } from "@girlsbands/industry/glossary";
import { ENTITIES, LIVE_CATEGORIES } from "@girlsbands/industry/taxonomy";
import type { Db } from "../db.ts";
import { newShortId } from "../lib/ids.ts";
import { isTimezone, splitDeadlineAt, timezoneOf } from "../sources/timezone.ts";

export interface LiveKey {
  subjectEntity: string;
  venue: string | null;
  /**
   * The clock of the place the show is held in: the venue's (glossary), else the place the live step
   * read out of the text, else the source's own clock. `zoneStated` says whether it came from the show
   * itself rather than the source — only then may it replace a zone already stored.
   */
  timezone: Timezone;
  zoneStated: boolean;
  /** `YYYY-MM-DD` on the announcement's own calendar. */
  startsOn: string;
  startsTime: string | null;
  /** Last day of a run; null for a single performance. */
  endsOn: string | null;
  status: LiveStatus;
}

/** 一条 fact 能提供的素材：structure 抽出的 subjects 与 deadlines、模型的 live 读取、正文。 */
export interface LiveMaterial {
  subjects: readonly string[];
  deadlines: readonly { kind?: string | null; at?: string | null }[] | null | undefined;
  live: Record<string, unknown> | null | undefined;
  title: string;
  text: string;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const clock = (value: unknown): string | null => {
  const v = text(value);
  return v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
};
const date = (value: unknown): string | null => {
  const v = text(value);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const isStatus = (value: unknown): value is LiveStatus =>
  value === "scheduled" || value === "cancelled" || value === "postponed";

/** 词表里那一个写法（`forms[0]` 是本站倾向写法），没有就 null。 */
function knownVenue(value: string): string | null {
  const hit = glossaryHits(value, ["venue"])[0];
  return hit?.forms[0] ?? null;
}

/**
 * 这段文字里出现过的会场：恰好命中一条才作数。同一个演出的两份公告可能一份写成 `Zepp Osaka Bayside`、
 * 一份写成 `Zepp Osaka Bayside（OSAKA）`，词表把它们归成同一条，键才对得上。
 */
export function venueOf(text: string): string | null {
  const hits = glossaryHits(text, ["venue"]);
  return hits.length === 1 ? (hits[0]!.forms[0] ?? null) : null;
}

/**
 * 比较用的形态：全半角、大小写、空白与标点都抹掉。`“凛音の理”` 与 `「凛音の理」`、`AsiaWorld-Summit`
 * 与 `asiaworldsummit` 都是同一串字。
 */
function comparable(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}

/** 会场名去掉括号里的补充（`Hall 2`、`2号館` 这类）：同一座场馆的两种写法要对得上。 */
function venueShape(venue: string | null): string {
  return comparable((venue ?? "").replace(/[（(\[【][^)）\]】]*[)）\]】]/g, ""));
}

/**
 * 同一场演出：同一天、同一开演时刻、演出名一致、会场对得上（去掉括号补充后相等，或者一侧没写）。
 * 同一场演出被两家分别报道时，一家可能把主体标成企划、会场也写成另一种写法 —— 那种情况下键会推成
 * 两行，页面就拆成两页了（香港 2026-10-02 就是这么裂成 `girls-band-cry` 与 `togenashi-togeari` 两页的）。
 */
function sameShow(row: { title: string; venue: string | null }, key: LiveKey, title: string): boolean {
  if (!key.startsTime || comparable(row.title) !== comparable(title)) return false;
  const a = venueShape(row.venue);
  const b = venueShape(key.venue);
  return a === "" || b === "" || a === b;
}

export function deriveLiveKey(material: LiveMaterial, timezone: Timezone): LiveKey | null {
  const subjectEntity = material.subjects.find((s) => s in ENTITIES);
  if (!subjectEntity) return null;
  const event = (material.deadlines ?? []).find((d) => d?.kind === "event");
  const split = event?.at ? splitDeadlineAt(event.at) : null;
  if (!split) return null;
  const live = material.live ?? {};
  // 模型读到的会场先过一遍词表：同一场演出在不同公告里的写法要落成一个键。
  const stated = text(live.venue);
  const venue = (stated ? (knownVenue(stated) ?? stated) : null) ?? venueOf(`${material.title}\n${material.text}`);
  // 演出所在地的钟：词表里的会场最可靠，其次是模型从原文里读到的地点（analyze.ts 已验过地点在原文里）。
  const byVenue = venue ? venueTimezone(venue) : null;
  const shown = isTimezone(byVenue) ? byVenue : isTimezone(live.timezone) ? live.timezone : null;
  return {
    subjectEntity,
    venue,
    timezone: shown ?? timezone,
    zoneStated: shown !== null,
    startsOn: split.day,
    startsTime: clock(live.startsTime) ?? split.localTime,
    endsOn: date(live.endsOn),
    status: isStatus(live.status) ? live.status : "scheduled",
  };
}

const first = <T>(rows: T[]): T | undefined => rows[0];

/**
 * 找到这场演出的行，没有就建 —— 键相同即同一场。标题只取第一次写下的那个（一场演出的名字不该随报告
 * 反复改名）；公告说的状态一旦不是 `scheduled` 就固定下来，后面的报告不能把它改回去。
 */
export async function upsertLiveEvent(
  db: Db,
  key: LiveKey,
  opts: { title: string; storyId: number | null; at: Date },
): Promise<number> {
  // 先看同一场是不是已经有一行：键推成两行的时候（主体、会场写法不同），名字与开演时刻对得上就不新建。
  if (key.startsTime) {
    const twins = await db<{ id: string; title: string; venue: string | null }[]>`
      SELECT id, title, venue FROM live_events WHERE starts_on = ${key.startsOn} AND starts_time = ${key.startsTime}`;
    const twin = twins.find((row) => sameShow(row, key, opts.title));
    if (twin) {
      await patchLiveEvent(db, Number(twin.id), key, opts.at, null, opts.storyId);
      return Number(twin.id);
    }
  }
  const rows = await db<{ id: string }[]>`
    INSERT INTO live_events (public_id, title, subject_entity, venue, timezone, starts_on, ends_on, starts_time, status, story_id, first_seen_at, updated_at)
    VALUES (
      ${`l${newShortId(8)}`}, ${opts.title.slice(0, 120)}, ${key.subjectEntity}, ${key.venue}, ${key.timezone},
      ${key.startsOn}, ${key.endsOn}, ${key.startsTime}, ${key.status}, ${opts.storyId}, ${opts.at}, ${opts.at}
    )
    ON CONFLICT (subject_entity, COALESCE(venue, ''), starts_on, COALESCE(starts_time, '')) DO UPDATE SET
      updated_at = EXCLUDED.updated_at,
      -- 演出自己说了在哪里办才改钟；只有来源那一地的钟时不动已经存下的。
      timezone = CASE WHEN ${key.zoneStated} THEN EXCLUDED.timezone ELSE live_events.timezone END,
      ends_on = COALESCE(live_events.ends_on, EXCLUDED.ends_on),
      story_id = COALESCE(live_events.story_id, EXCLUDED.story_id),
      status = CASE WHEN live_events.status = 'scheduled' THEN EXCLUDED.status ELSE live_events.status END
    RETURNING id`;
  return Number(first(rows)!.id);
}

/**
 * 已经挂好身份的 fact 再来一条报告：只补空，不覆盖。开演时刻与会场可能撞上另一行已经占住的同一个键
 * （唯一索引），那时保持原样 —— 补不上空比丢掉一条已经挂上的事实轻。
 *
 * `modelTitle` 是阶段 B 给的演出名：它比阶段 A 的临时标题（站内中文标题）准，来了就换掉。
 * `storyId` 只在原来没挂事件时补上（一场演出被两条事件分别报道时，页面至少指得回一条）。
 */
export async function patchLiveEvent(
  db: Db,
  id: number,
  key: LiveKey,
  at: Date,
  modelTitle: string | null = null,
  storyId: number | null = null,
): Promise<void> {
  try {
    await db`
      UPDATE live_events SET
        title = COALESCE(${modelTitle}, live_events.title),
        venue = COALESCE(live_events.venue, ${key.venue}),
        timezone = CASE WHEN ${key.zoneStated} THEN ${key.timezone} ELSE live_events.timezone END,
        starts_time = COALESCE(live_events.starts_time, ${key.startsTime}),
        ends_on = COALESCE(live_events.ends_on, ${key.endsOn}),
        story_id = COALESCE(live_events.story_id, ${storyId}),
        status = CASE WHEN live_events.status = 'scheduled' THEN ${key.status} ELSE live_events.status END,
        updated_at = ${at}
      WHERE id = ${id}`;
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
  }
}

interface FactRow {
  id: string;
  title: string;
  story_id: string | null;
  live_event_id: string | null;
}

interface MaterialRow {
  article_id: string;
  /** 文章原标题（日文），会场的写法要在它和正文里找。 */
  title: string;
  /** 站内中文标题：阶段 A 没有模型给的演出名时，先拿它当页面标题。 */
  publication_title: string | null;
  category: string | null;
  body_text: string | null;
  excerpt: string | null;
  config: Record<string, unknown> | null;
  subjects: string[] | null;
  output: {
    fact?: { deadlines?: { kind?: string; at?: string }[] } | null;
    live?: { title?: string; venue?: string; startsTime?: string; endsOn?: string; status?: string; place?: string; timezone?: string } | null;
  } | null;
}

/**
 * 把一条事实挂到它的演出上，返回 `live_events.id`（没推出来就 null）。**只读这里的两张表、不写 facts**
 * —— facts 的属主是 events/（tests/architecture.test.ts 的表属主规则），写回那一句在 events/live.ts。
 */
export async function linkFactLiveEvent(db: Db, factId: number, articleId: string): Promise<number | null> {
  const fact = first(await db<FactRow[]>`SELECT id, title, story_id, live_event_id FROM facts WHERE id = ${factId}`);
  if (!fact) return null;
  // 这条事实底下所有条目，演出类排前面：键与标题各取最合适的一篇（写日期的那篇不一定叫得出演出名）。
  // `an` 挂 `p.analysis_id` 而不是最新一条分析 —— 日历与截止雷达读的就是这一条（publication/deadlines.ts:73），
  // 演出页面上的日期必须和日历上的是同一天。
  const rows = await db<MaterialRow[]>`
    SELECT a.id AS article_id, a.title, a.body_text, a.excerpt, s.config, p.category, p.title AS publication_title,
           an.subjects, an.output
    FROM fact_articles fa
    JOIN articles a ON a.id = fa.article_id
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN publications p ON p.article_id = a.id
    LEFT JOIN analyses an ON an.id = p.analysis_id
    WHERE fa.fact_id = ${factId}
    ORDER BY (p.category = 'live') DESC, (p.category = 'ticket') DESC,
             (a.id = ${articleId}) DESC, p.published_at DESC NULLS LAST`;
  const liveRows = rows.filter((r) => r.category !== null && LIVE_CATEGORIES.has(r.category));
  const keys = keysOf(rows);
  if (fact.live_event_id !== null) {
    // 已经挂上了：这一条只是又一份报告，补空不覆盖 —— 而且只补同一场（主体与开演日一致）的，
    // 免得把另一天的会场写进这一场。
    const liveId = Number(fact.live_event_id);
    const [current] = await db<{ subject_entity: string; starts_on: string }[]>`
      SELECT subject_entity, starts_on::text AS starts_on FROM live_events WHERE id = ${liveId}`;
    const same = current ? keys.filter((k) => k.subjectEntity === current.subject_entity && k.startsOn === current.starts_on) : [];
    if (same.length > 0) await patchLiveEvent(db, liveId, mergeKeys(same), new Date(), modelTitleOf(rows), fact.story_id === null ? null : Number(fact.story_id));
    return liveId;
  }
  if (liveRows.length === 0) return null;
  const anchor = keys[0];
  if (!anchor) return null;
  return await upsertLiveEvent(db, mergeKeys(keys.filter((k) => k.subjectEntity === anchor.subjectEntity && k.startsOn === anchor.startsOn)), {
    title: titleOf(liveRows, fact),
    storyId: fact.story_id === null ? null : Number(fact.story_id),
    at: new Date(),
  });
}

/** 一条 fact 底下所有推得出身份的条目，按上面排好的顺序：写日期的那篇才作数。 */
function keysOf(rows: MaterialRow[]): LiveKey[] {
  const keys: LiveKey[] = [];
  for (const row of rows) {
    const key = deriveLiveKey(materialOf(row), timezoneOf(row.config));
    if (key) keys.push(key);
  }
  return keys;
}

/** 同一场的几篇报告里信息最全的那篇说了算：会场、开演时刻、最后一天。 */
const richness = (key: LiveKey) => (key.venue ? 1 : 0) + (key.startsTime ? 1 : 0) + (key.endsOn ? 1 : 0);

/** 同一场（主体与开演日一致）的几篇报告合成一条键；状态取最严重的那条公告，钟取说了演出在哪里的那篇。 */
function mergeKeys(same: LiveKey[]): LiveKey {
  const best = same.reduce((a, b) => (richness(b) > richness(a) ? b : a));
  const status = same.find((k) => k.status !== "scheduled")?.status ?? best.status;
  const zone = best.zoneStated ? best : (same.find((k) => k.zoneStated) ?? best);
  return { ...best, status, timezone: zone.timezone, zoneStated: zone.zoneStated };
}

/** 阶段 B 写的演出名；没有就 null。 */
function modelTitleOf(rows: MaterialRow[]): string | null {
  for (const row of rows) {
    const title = text(row.output?.live?.title);
    if (title) return title.slice(0, 120);
  }
  return null;
}

/** 页面标题：模型给的演出名 > 演出类条目的站内中文标题 > fact 的标题（日文，最后兜底）。 */
function titleOf(liveRows: MaterialRow[], fact: FactRow): string {
  return (modelTitleOf(liveRows) ?? text(liveRows[0]?.publication_title) ?? fact.title).slice(0, 120);
}

/** 推导要的素材：structure 抽出的 subjects 与 deadlines 在 `analyses.output` 里，正文在 articles 上。 */
export function materialOf(row: MaterialRow): LiveMaterial {
  return {
    subjects: row.subjects ?? [],
    deadlines: row.output?.fact?.deadlines ?? [],
    live: row.output?.live ?? null,
    title: row.title,
    text: row.body_text ?? row.excerpt ?? "",
  };
}
