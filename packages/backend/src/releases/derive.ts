// 一张碟的推导：把「CD → 序列号 → 抽选 → Live」这条链写成行。
//
// 为什么要有这个模块：分类与标签早就把「新作发售 / 初回限定盘 / 店铺特典 / 序列号 / 受注生产」记下来了，
// 但彼此不相连 —— 一张碟有几个版本、哪个版本带序列号、序列号能换哪场演出、哪家店送什么，任何出口都读
// 不出来。`releases` 那一族表就是这条链，写入只发生在这里（表属主规则，tests/architecture.test.ts）。
//
// 两个来源，同一个函数：
//   阶段 A（零模型成本）从已经在库里的东西推：分类与标签定 `kind`，structure 抽出的 `release_start` /
//                      `merch_start` 日期就是发售日，subjects 就是归属主体。造得出一行碟，造不出版本与特典。
//   阶段 B（模型）      editorial/analyze.ts 的 runRelease 把结果写进 `analyses.output.release`，这里
//                      优先读它：碟名、版本、店铺特典、序列号，每个叶子字段都已经过 grounded（引文必须
//                      真在正文里），所以这里不再复核出处，只做形状与范围的收敛。
//
// 日期不在这里存第三份：能出现在雷达、日历、.ics 与提醒信里的日期只有 `deadlines` 一份真源（序列号
// 的应募期间属于它指向的那场演出的轮次）。`release_on` 是「哪天发售」这一个属性，没有就留 null ——
// 原文只写「今冬発売」时，页面上就只写今冬，不推算；唯一的例外是原文自己写了「リリース前日 X 月 Y 日」，
// 那就是在说发售日是 Y+1 日。
//
// 推不出主体就不建：`subject_entity` 是这条链的锚，一张没有归属的碟在任何页面上都无处安放。
import { timezoneDate } from "@girlsbands/contracts/time";
import type { ReleaseEditionKind, ReleaseKind, ReleaseSerialKind, Timezone } from "@girlsbands/contracts/site";
import { ENTITIES, MERCH_TAGS, RELEASE_TAGS } from "@girlsbands/industry/taxonomy";
import type { Db } from "../db.ts";
import { newShortId } from "../lib/ids.ts";

const EDITION_KINDS: ReadonlySet<string> = new Set<ReleaseEditionKind>(["regular", "limited", "first_press", "other"]);
const SERIAL_KINDS: ReadonlySet<string> = new Set<ReleaseSerialKind>(["lottery", "preorder", "streaming", "other"]);
const RELEASE_KINDS: ReadonlySet<string> = new Set<ReleaseKind>(["single", "album", "ep", "bluray", "dvd", "digital", "merch", "other"]);

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const date = (value: unknown): string | null => {
  const v = text(value);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const dayOf = (at: unknown): string | null => {
  const v = text(at);
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
};
const yen = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(n) && n >= 100 && n <= 10_000_000 ? n : null;
};

/** 一条 fact 能给这张碟的素材：结构步骤的 subjects 与 deadlines，模型的 release 读取，页面标题。 */
export interface ReleaseMaterial {
  articleId: string;
  factId: number | null;
  storyId: number | null;
  /** 站内标题（中文优先）：模型没给碟名时用它。 */
  title: string;
  category: string | null;
  tags: readonly string[];
  subjects: readonly string[];
  timezone: Timezone;
  publishedAt: Date | null;
  output: {
    fact?: { deadlines?: readonly { kind?: string | null; at?: string | null; note?: string | null; quote?: string | null }[] | null } | null;
    release?: Record<string, unknown> | null;
  } | null;
}

/** 这批资料说的是哪一种发布；不是发布或周边就返回 null（不建行）。 */
export function releaseKindOf(m: Pick<ReleaseMaterial, "category" | "tags" | "title">): ReleaseKind | null {
  const tags = new Set(m.tags);
  const release = m.category === "release" || m.tags.some((t) => RELEASE_TAGS.has(t));
  const merch = m.category === "merch" || m.tags.some((t) => MERCH_TAGS.has(t));
  if (!release && !merch) return null;
  if (tags.has("数字发行")) return "digital";
  // 一张碟同时写明 Blu-ray 与 DVD 时以 Blu-ray 为准（通常是同一个包装里两张）。
  if (tags.has("Blu-ray/DVD") || tags.has("Blu-ray")) return /dvd|DVD/.test(m.title) && !/blu-?ray|\bBD\b/i.test(m.title) ? "dvd" : "bluray";
  if (tags.has("Single")) return "single";
  if (tags.has("Album") || tags.has("Live 专辑")) return "album";
  if (tags.has("EP")) return "ep";
  if (merch) return "merch";
  return "other";
}

/** 这条资料值不值得为发售链多花一次模型调用：分类或分类标签命中「音像作品」与「商品特典」那两类。 */
export function readsRelease(category: string | null, tags: readonly string[]): boolean {
  return category === "release" || category === "merch" || tags.some((t) => RELEASE_TAGS.has(t) || MERCH_TAGS.has(t));
}

/** 归属主体：优先乐队（碟是乐队发的），没有乐队才落到企划；不在词表里就不建。 */
export function releaseSubjectOf(subjects: readonly string[]): string | null {
  const known = subjects.filter((s) => !!ENTITIES[s]);
  return known.find((s) => ENTITIES[s]!.kind === "band") ?? known[0] ?? null;
}

/** 原文写的是「リリース前日 / 発売前日 2026年9月29日」：那一天的后一天就是发售日（原文明说的，不是推算）。 */
const EVE = /(?:リリース|発売|配信)前日\s*[（(]?\s*(\d{4})\s*[年/.]\s*(\d{1,2})\s*[月/.]\s*(\d{1,2})/;

export function releaseDayFromEve(quote: string | null | undefined): string | null {
  const hit = quote ? EVE.exec(quote) : null;
  if (!hit) return null;
  const d = new Date(Date.UTC(Number(hit[1]), Number(hit[2]) - 1, Number(hit[3]) + 1));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** 发售日：模型给的（已 grounded）优先，其次 structure 抽出的发售日期，再其次原文的「発売前日 X」，最后留 null。 */
function releaseDayOf(m: ReleaseMaterial, kind: ReleaseKind, modelDay: string | null): string | null {
  if (modelDay) return modelDay;
  const wanted = kind === "merch" ? ["merch_start", "release_start"] : ["release_start", "merch_start"];
  const deadlines = m.output?.fact?.deadlines ?? [];
  for (const want of wanted) {
    const hit = deadlines.find((d) => d?.kind === want && dayOf(d?.at));
    if (hit) return dayOf(hit.at);
  }
  for (const d of deadlines) {
    const day = releaseDayFromEve(d?.quote) ?? releaseDayFromEve(d?.note);
    if (day) return day;
  }
  return null;
}

/**
 * 认同一张碟用的名字：标题里第一对「」里的作品名（没有就是整个标题），去空白、小写。
 * 「millsage 1st Single「鳴らす」」和「millsage「鳴らす」配信開始」是同一张。
 */
const norm = (v: string) => v.normalize("NFKC").replace(/[\s「」『』]+/g, "").toLowerCase();
/** 括号里写的是企划/乐队名（『ガールズバンドクライ』）就不是作品名，不能拿来认碟。 */
const ENTITY_NAMES: ReadonlySet<string> = new Set(
  Object.values(ENTITIES).flatMap((e) => [e.name, ...e.aliases, ...(e.otherNames ?? [])]).map(norm),
);

export function releaseNameKey(title: string): string {
  // 作品名常套在 「」『』 里，演出名还会再套一层 “” 或 ""：取最短的那段（最里层的名字），
  // 企划/乐队名不算。都没有就用整个标题，去掉结尾的载体字样（Blu-ray & DVD 之类）。
  const t = title.normalize("NFKC");
  const names = [/[「『]([^」』]+)[」』]/g, /[“”]([^“”]+)[“”]/g, /"([^"]+)"/g]
    .flatMap((re) => [...t.matchAll(re)].map((hit) => norm(hit[1]!)))
    .filter((inner) => inner && !ENTITY_NAMES.has(inner))
    .sort((x, y) => x.length - y.length);
  return names[0] ?? norm(title).replace(/(blu-?ray|dvd|bd|[&/・＆化])+$/g, "");
}

/** 发售那天的出处：原文里写发售日的那句话（结构步骤给过 note 就用它）。 */
function releaseQuoteOf(m: ReleaseMaterial, kind: ReleaseKind): string | null {
  const wanted = kind === "merch" ? ["merch_start", "release_start"] : ["release_start", "merch_start"];
  const deadlines = m.output?.fact?.deadlines ?? [];
  for (const want of wanted) {
    const hit = deadlines.find((d) => d?.kind === want);
    const note = text(hit?.note);
    if (note) return note.slice(0, 600);
  }
  return null;
}

interface ReleaseRead {
  title: string | null;
  /** 阶段 B 读到的形态：只在标签只推出 `other` 时才用来细化行上的 `kind`。 */
  kind: ReleaseKind;
  releaseOn: string | null;
  announcedOn: string | null;
  quote: string | null;
  editions: Array<{ name: string; kind: ReleaseEditionKind; includesBluray: boolean; includesSerial: boolean; priceYen: number | null; sku: string | null; quote: string | null }>;
  bonuses: Array<{ retailer: string; bonus: string; firstPress: boolean; editionName: string | null; url: string | null; quote: string | null }>;
  serials: Array<{ kind: ReleaseSerialKind; liveTitle: string | null; url: string | null; quote: string | null }>;
}

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

const url = (value: unknown): string | null => {
  const v = text(value);
  return v && /^https?:\/\//.test(v) ? v.slice(0, 500) : null;
};

/** 阶段 B 写下的那一块。字段少一个、写错一个都不算错：缺的退回阶段 A。 */
function releaseReadOf(raw: Record<string, unknown> | null | undefined): ReleaseRead {
  const stated = text(raw?.kind);
  return {
    title: text(raw?.title),
    kind: stated && RELEASE_KINDS.has(stated) ? (stated as ReleaseKind) : "other",
    releaseOn: date(raw?.releaseOn),
    announcedOn: date(raw?.announcedOn),
    quote: text(raw?.quote)?.slice(0, 600) ?? null,
    editions: list(raw?.editions).flatMap((e) => {
      const name = text(e.name);
      if (!name) return [];
      const kind = text(e.kind);
      return [{
        name: name.slice(0, 80),
        kind: kind && EDITION_KINDS.has(kind) ? (kind as ReleaseEditionKind) : "other",
        includesBluray: e.includesBluray === true,
        includesSerial: e.includesSerial === true,
        priceYen: yen(e.priceYen),
        sku: text(e.sku)?.slice(0, 60) ?? null,
        quote: text(e.quote)?.slice(0, 600) ?? null,
      }];
    }),
    bonuses: list(raw?.bonuses).flatMap((b) => {
      const retailer = text(b.retailer);
      const bonus = text(b.bonus);
      if (!retailer || !bonus) return [];
      return [{
        retailer: retailer.slice(0, 60), bonus: bonus.slice(0, 160), firstPress: b.firstPress === true,
        editionName: text(b.editionName)?.slice(0, 80) ?? null, url: url(b.url), quote: text(b.quote)?.slice(0, 600) ?? null,
      }];
    }),
    serials: list(raw?.serials).flatMap((s) => {
      const kind = text(s.kind);
      const liveTitle = text(s.liveTitle);
      if (!kind && !liveTitle) return [];
      return [{
        kind: kind && SERIAL_KINDS.has(kind) ? (kind as ReleaseSerialKind) : "other",
        liveTitle: liveTitle?.slice(0, 120) ?? null, url: url(s.url), quote: text(s.quote)?.slice(0, 600) ?? null,
      }];
    }),
  };
}

/** 「这件事的归属」：公告的发布日期就是公布日（那一地的日历）。 */
const announcedDayOf = (m: ReleaseMaterial) => (m.publishedAt ? timezoneDate(m.timezone, m.publishedAt) : null);

/**
 * 写一行碟（以及阶段 B 给的版本、特典、序列号）。同一张碟再来一条公告只补空、不覆盖：唯一索引是
 * `(主体, 碟名, 发售日)`，公告被下架时靠 first_article_id 一起消失（与 live_events 同一条规则）。
 * 返回 `releases.id`，不是发布或推不出主体时返回 null。
 */
export async function deriveReleases(db: Db, m: ReleaseMaterial): Promise<number | null> {
  const tagKind = releaseKindOf(m);
  if (!tagKind) return null;
  const subject = releaseSubjectOf(m.subjects);
  if (!subject) return null;
  const read = releaseReadOf(m.output?.release);
  // 标签是免费的、确定的；只有标签只说得出「其他」时，才让模型读到的形态细化它。
  const kind = tagKind === "other" && read.kind !== "other" ? read.kind : tagKind;
  const title = (read.title ?? m.title).replace(/\s+/g, " ").trim().slice(0, 160);
  if (!title) return null;
  const releaseOn = releaseDayOf(m, kind, read.releaseOn);
  const announcedOn = read.announcedOn ?? announcedDayOf(m);
  const quote = read.quote ?? releaseQuoteOf(m, kind);

  // 同一乐队、同一个作品名、同一类（或一边是「其他」）、日期不冲突：是同一张碟的又一条公告，
  // 补上那一行缺的发售日，而不是因为标题措辞或日期从无到有就另起一行。
  const key = releaseNameKey(title);
  const candidates = await db<{ id: string; title: string; kind: string; release_on: string | null }[]>`
    SELECT id, title, kind, release_on FROM releases
    WHERE subject_entity = ${subject}
      AND (kind = ${kind}::text OR kind = 'other' OR ${kind}::text = 'other' OR (kind IN ('single','digital') AND ${kind}::text IN ('single','digital')))
      AND (release_on IS NULL OR ${releaseOn}::text IS NULL OR release_on = ${releaseOn}::text)
    ORDER BY (release_on IS NOT NULL) DESC, id`;
  const same = candidates.find((c) => releaseNameKey(c.title) === key);
  if (same) {
    await db`
      UPDATE releases SET
        release_on = COALESCE(release_on, ${releaseOn}::text),
        kind = CASE WHEN kind = 'other' THEN ${kind}::text ELSE kind END,
        announced_on = COALESCE(announced_on, ${announcedOn}::text),
        story_id = COALESCE(story_id, ${m.storyId}),
        first_fact_id = COALESCE(first_fact_id, ${m.factId}),
        quote = COALESCE(quote, ${quote}),
        updated_at = now()
      WHERE id = ${same.id}`;
  }

  const [row] = same ? [{ id: same.id }] : await db<{ id: string }[]>`
    INSERT INTO releases (public_id, subject_entity, title, kind, release_on, announced_on, timezone,
                          story_id, first_fact_id, first_article_id, quote)
    VALUES (${`r${newShortId(8)}`}, ${subject}, ${title}, ${kind}, ${releaseOn}, ${announcedOn}, ${m.timezone},
            ${m.storyId}, ${m.factId}, ${m.articleId}, ${quote})
    ON CONFLICT (subject_entity, title, COALESCE(release_on, '')) DO UPDATE SET
      announced_on = COALESCE(releases.announced_on, EXCLUDED.announced_on),
      story_id = COALESCE(releases.story_id, EXCLUDED.story_id),
      first_fact_id = COALESCE(releases.first_fact_id, EXCLUDED.first_fact_id),
      quote = COALESCE(releases.quote, EXCLUDED.quote),
      updated_at = now()
    RETURNING id`;
  const releaseId = Number(row!.id);

  for (const edition of read.editions) {
    await db`
      INSERT INTO release_editions (release_id, name, kind, includes_bluray, includes_serial, price_yen, sku, quote)
      VALUES (${releaseId}, ${edition.name}, ${edition.kind}, ${edition.includesBluray}, ${edition.includesSerial},
              ${edition.priceYen}, ${edition.sku}, ${edition.quote})
      ON CONFLICT (release_id, name) DO UPDATE SET
        kind = CASE WHEN release_editions.kind = 'other' THEN EXCLUDED.kind ELSE release_editions.kind END,
        includes_bluray = release_editions.includes_bluray OR EXCLUDED.includes_bluray,
        includes_serial = release_editions.includes_serial OR EXCLUDED.includes_serial,
        price_yen = COALESCE(release_editions.price_yen, EXCLUDED.price_yen),
        sku = COALESCE(release_editions.sku, EXCLUDED.sku),
        quote = COALESCE(release_editions.quote, EXCLUDED.quote),
        updated_at = now()`;
  }

  for (const bonus of read.bonuses) {
    const [edition] = bonus.editionName
      ? await db<{ id: string }[]>`SELECT id FROM release_editions WHERE release_id = ${releaseId} AND name = ${bonus.editionName}`
      : [];
    await db`
      INSERT INTO release_bonuses (release_id, edition_id, retailer, bonus, first_press, url, quote)
      VALUES (${releaseId}, ${edition?.id ?? null}, ${bonus.retailer}, ${bonus.bonus}, ${bonus.firstPress}, ${bonus.url}, ${bonus.quote})
      ON CONFLICT (release_id, COALESCE(edition_id, 0), retailer, bonus) DO UPDATE SET
        first_press = release_bonuses.first_press OR EXCLUDED.first_press,
        url = COALESCE(release_bonuses.url, EXCLUDED.url),
        quote = COALESCE(release_bonuses.quote, EXCLUDED.quote),
        updated_at = now()`;
  }

  for (const serial of read.serials) {
    const live = await liveFor(db, serial.liveTitle);
    await db`
      INSERT INTO release_serials (release_id, kind, live_event_id, live_title, url, quote)
      VALUES (${releaseId}, ${serial.kind}, ${live}, ${serial.liveTitle}, ${serial.url}, ${serial.quote})
      ON CONFLICT (release_id, kind, COALESCE(live_event_id, 0), COALESCE(live_title, '')) DO UPDATE SET
        url = COALESCE(release_serials.url, EXCLUDED.url),
        quote = COALESCE(release_serials.quote, EXCLUDED.quote),
        updated_at = now()`;
  }

  return releaseId;
}

/**
 * 序列号指向的那场演出。演出名是公告自己写的，页面上可能带「全国ツアー」这类后缀，所以按去掉空白与
 * 大小写后的整名比一次；比不中（或站里还没有那场演出）就只留下原文里的演出名，页面上仍然读得懂。
 */
async function liveFor(db: Db, title: string | null): Promise<number | null> {
  if (!title) return null;
  const key = title.replace(/\s+/g, "").toLowerCase();
  if (!key) return null;
  const [row] = await db<{ id: string }[]>`
    SELECT id FROM live_events
    WHERE regexp_replace(lower(title), '\\s+', '', 'g') = ${key}
    ORDER BY starts_on DESC LIMIT 1`;
  return row ? Number(row.id) : null;
}
