// 把库里的东西拼成三封信要的数据。这里只做选择和措辞，不碰 HTML——长什么样由 industry/email/styles/ 决定，
// 怎么发出去由 send.ts 决定。
//
// 收件人的乐队过滤在这里做：截止雷达和精选摘要各算一次全量，再按每个人的乐队名单筛。
// 没勾任何乐队的人拿全部（见 store.ts 的说明）。
import { CATEGORY_LABELS } from "@girlsbands/contracts/taxonomy";
import { DEADLINE_LABELS, TIMEZONE_LABELS, type DeadlineKind, type DeadlineView } from "@girlsbands/contracts/site";
import { beijingDate, beijingTime } from "@girlsbands/contracts/time";
import { ENTITIES, isBand, seriesOf } from "@girlsbands/industry/taxonomy";
import { heroHandle, normalizeHero, type HeroHandle, type HeroSpec } from "@girlsbands/industry/email/hero";
import { EMAIL_THEME } from "@girlsbands/industry/email/theme";
import type { ConfirmData, DeadlineData, DeadlineDay, DeadlineEntry, DigestData, DigestItem, EmailSite } from "@girlsbands/industry/email/types";
import { SITE, withSubject } from "@girlsbands/industry/site";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { itemUrl, siteUrl } from "../publication/links.ts";
import { entityIds, publicSourceName } from "../publication/rules.ts";
import { selectedCondition } from "../publication/scope.ts";
import { upcomingDeadlines } from "../publication/deadlines.ts";
import type { Recipient } from "./store.ts";

/** 提醒信正文覆盖的天数。 */
export const DEADLINE_HORIZON_DAYS = 14;
/** 只有出现这个窗口内的节点才发提醒：没有要紧事就不发信。 */
export const URGENT_HOURS = 48;
/** 摘要信回看多久的精选。 */
export const DIGEST_WINDOW_HOURS = 24;
export const DIGEST_LIMIT = 12;

export function emailSite(): EmailSite {
  return {
    name: SITE.name,
    subject: SITE.subject,
    tagline: SITE.tagline,
    url: config.siteUrl,
    footerNote: SITE.footerNote ?? "",
    // 图标用站点根目录下那张 192 的 PNG（apps/api/src/routes/static.ts 提供的静态资源）。
    logoUrl: siteUrl("/icon-192.png"),
    ...EMAIL_THEME,
  };
}

// 信里的管理入口用短链 /subscriptions/<token>，由网页转发到 /subscribe/manage?token=…：邮件里那一行
// 短一些，也少一个容易被截断的问号。早先发出去的 /subscribe/manage?token=… 仍然可用。
const manageUrl = (token: string, action?: string) =>
  `${siteUrl("/subscriptions")}/${encodeURIComponent(token)}${action ? `?action=${action}` : ""}`;

/**
 * 头图：每封邮件顶上那张通栏图（API 现画，见 industry/email/hero.ts）。
 * 色一律用这一封的**主角乐队**的应援色——头图是读者在收件箱里唯一先看到的东西，
 * 用谁的色就代表这封信是给谁看的。没有乐队就退品牌金。
 * `logo` 是主角乐队的 **id**（不是图片地址）：头图拿它去 assets/band-logos/ 取那支乐队的官方 logo
 * 当主视觉，渲染时不出网；没有对应 logo 就退回满版应援色海报。
 * `date` 是 YYYY-MM-DD：它同时喂给右上角的鬼影日号和右下角的 `MM / DD · JST`。
 * 没有日期的信（确认信）传空串，那两处就不画——空着比编一个日期强。
 */
function heroOf(input: { accent?: string | null; star: string; date: string; logo?: string | null }): HeroHandle {
  const spec: HeroSpec = normalizeHero({
    accent: input.accent ?? EMAIL_THEME.accentBright,
    ink: EMAIL_THEME.ink,
    surface: EMAIL_THEME.surface,
    star: input.star,
    date: input.date,
    logo: input.logo ?? null,
  });
  return heroHandle(spec, config.siteUrl);
}

export async function confirmData(
  input: { email: string; token: string; confirmToken: string; bands: string[]; wantsDeadlines: boolean; wantsDigest: boolean },
  // 头图改用乐队 id 之后这一层不再查库，第二个参数只是给预览脚本留的位置（不再参与选图）。
  _now = new Date(),
): Promise<ConfirmData> {
  const names = bandNames(input.bands);
  // 确认信的主角：先挑第一支**乐队**，只订了企划时才用那个企划——头图、名字、logo 必须是同一个主体。
  const firstId = input.bands.find((id) => isBand(id)) ?? input.bands.find((id) => id in ENTITIES);
  const first = firstId ? ENTITIES[firstId as keyof typeof ENTITIES] : undefined;
  return {
    kind: "confirm",
    site: emailSite(),
    email: input.email,
    confirmUrl: `${siteUrl("/api/site/subscribe/confirm")}?token=${encodeURIComponent(input.confirmToken)}`,
    bands: names,
    wantsDeadlines: input.wantsDeadlines,
    wantsDigest: input.wantsDigest,
    hero: heroOf({
      accent: first?.accent ?? null,
      star: first?.name ?? SITE.name,
      // 确认信还没有「哪一天」这件事：不编日期，头图只画 logo 与乐队名。
      date: "",
      // 确认信是唯一一封「还没读之前」的信：拿订阅的第一支乐队的官方 logo 当主视觉，读者一眼知道订了谁。
      logo: firstId ?? null,
    }),
  };
}

/** 乐队 id → 页面上的名字，顺序按传入的顺序，去重。 */
export function bandNames(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const entity = ENTITIES[id as keyof typeof ENTITIES];
    if (!entity || seen.has(entity.name)) continue;
    seen.add(entity.name);
    out.push(entity.name);
  }
  return out;
}

function bandOf(subjects: readonly string[]): { id: string; name: string; accent: string | null } | null {
  const known = subjects.filter((id) => ENTITIES[id as keyof typeof ENTITIES]);
  // 先乐队、后企划：一条消息常同时挂着企划和乐队（BanG Dream! 里的 MyGO!!!!!），头图该挂那支乐队的
  // logo，而不是整个企划的字标。只有这条确实只讲企划时才用企划的 logo。
  const id = known.find(isBand) ?? known[0];
  if (!id) return null;
  const entity = ENTITIES[id as keyof typeof ENTITIES]!;
  return { id, name: entity.name, accent: entity.accent ?? null };
}

/**
 * 这条节点和这个收件人有关吗：没勾就是全部，勾了就要求至少命中一个。
 * 勾的是企划（系列 id）时，它旗下乐队的情报也算命中——只订「BanG Dream!」的人该收到 Roselia 的消息。
 * 归属关系只有一份，在 industry/taxonomy.ts 的 seriesOf 里，这里不另抄一张表：它认系列 id 才展开，
 * 所以勾乐队时不会把同系列其它乐队串进来（和企划页、日历是同一套语义）。
 * 同时勾了企划和它旗下的乐队时，展开后是同一个集合，两种勾法的结果完全一样。
 */
export function matches(picks: readonly string[], subjects: readonly string[]): boolean {
  if (picks.length === 0) return true;
  const wanted = new Set<string>();
  for (const id of picks) for (const member of seriesOf(id)) wanted.add(member);
  return subjects.some((s) => wanted.has(s));
}

function toEntry(view: DeadlineView): DeadlineEntry {
  const band = bandOf(view.subjects);
  return {
    at: view.at,
    time: view.localTime,
    zone: view.localTime ? TIMEZONE_LABELS[view.timezone] : null,
    label: DEADLINE_LABELS[view.kind].label,
    note: view.note,
    title: view.title,
    url: itemUrl(view.itemId),
    band: band?.name ?? null,
    accent: band?.accent ?? null,
    source: view.source.name,
    soon: view.soon,
  };
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 北京时间某天是星期几；只用于邮件里那行小字。 */
function weekdayOf(day: string): string {
  return WEEKDAYS[new Date(`${day}T00:00:00+08:00`).getUTCDay()!] ?? "";
}

/**
 * 一个收件人的截止提醒。返回 null 表示这次不发：没有他关心的节点，或者没有 48 小时内到期的。
 * 「没有要紧事就不发信」是有意的——提醒信只有在能救下一场抽选的时候才有价值。
 */
/**
 * 提醒信只说票和货（站主 2026-10-07）：抽选、先行、开卖、截止、结果、缴款、发售日、周边开订。
 * 演出当天、开播、MV 首播、配信期限这类在雷达页照常列出，但不为它们发提醒信。
 */
export const REMINDED_KINDS: ReadonlySet<string> = new Set([
  "lottery_start", "lottery_end", "sale_start", "sale_end", "result", "payment_deadline", "release_start", "merch_start",
]);

export async function deadlineData(recipient: Recipient, now = new Date()): Promise<DeadlineData | null> {
  const radar = await upcomingDeadlines(now, { horizonDays: DEADLINE_HORIZON_DAYS, limit: 400 });
  const picked: { date: string; views: DeadlineView[] }[] = [];
  for (const day of radar.days) {
    const views = day.items.filter((i) => REMINDED_KINDS.has(i.kind) && matches(recipient.bands, i.subjects));
    if (views.length === 0) continue;
    picked.push({ date: day.date, views });
  }
  if (picked.length === 0) return null;
  const allViews = picked.flatMap((d) => d.views);
  const urgentViews = allViews.filter((v) => v.soon);
  if (urgentViews.length === 0) return null;
  // 头图说的是「最要紧的那支乐队」：读者在收件箱里一眼先看到的就是它，图也从这条情报自己身上取。
  const starView = urgentViews.find((v) => bandOf(v.subjects)) ?? allViews.find((v) => bandOf(v.subjects)) ?? urgentViews[0]!;
  const star = bandOf(starView.subjects);
  const first = picked[0]!;
  const days: DeadlineDay[] = picked.map((d) => ({
    date: d.date,
    label: `${d.date.slice(5, 7)}/${d.date.slice(8, 10)}`,
    weekday: weekdayOf(d.date),
    items: d.views.map(toEntry),
  }));
  return {
    kind: "deadline",
    site: emailSite(),
    email: recipient.email,
    days,
    unsubscribeUrl: manageUrl(recipient.token, "unsubscribe"),
    preferencesUrl: manageUrl(recipient.token),
    hero: heroOf({
      accent: star?.accent ?? null,
      star: star?.name ?? SITE.name,
      // 日子取最近的那一天：头图右上的鬼影日号与右下的日期行都是它。
      date: first.date,
      logo: star?.id ?? null,
    }),
  };
}

interface DigestRow {
  article_id: string;
  title: string;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  first_party: boolean;
  timeline_at: Date;
  source_name: string;
  story_id: number | null;
  score: number | null;
}

/** 同一个故事里哪条更值得占掉那唯一一格：分高的优先，同分取最早那条（先到的那篇通常信息最全）。 */
function betterRow(a: DigestRow, b: DigestRow): boolean {
  const sa = a.score ?? -Infinity;
  const sb = b.score ?? -Infinity;
  if (sa !== sb) return sa > sb;
  const ta = a.timeline_at.getTime();
  const tb = b.timeline_at.getTime();
  if (ta !== tb) return ta < tb;
  return a.article_id < b.article_id;
}

/**
 * 一个收件人的精选摘要。返回 null 表示这个窗口里没有他关心的内容——不发空邮件。
 */
export async function digestData(recipient: Recipient, now = new Date()): Promise<DigestData | null> {
  const since = new Date(now.getTime() - DIGEST_WINDOW_HOURS * 3600_000);
  const rows = await sql<DigestRow[]>`
    SELECT p.article_id, p.title, p.summary, p.category, p.tags, p.first_party, p.timeline_at, s.name AS source_name,
           p.story_id, p.score
    FROM publications p
    JOIN sources s ON s.id = p.source_id
    WHERE ${selectedCondition(now)}
      AND p.timeline_at >= ${since} AND p.timeline_at < ${now}
    ORDER BY p.timeline_at DESC
    LIMIT 200`;

  // 先按收件人筛一遍，再在同一个故事里挑一条：几条不同来源的报道讲的是同一件事时，读者不需要看两遍。
  // 没归组（story_id 为空）的条目不参与去重，各自都算一条。
  const candidates: DigestRow[] = [];
  const bestOfStory = new Map<number, DigestRow>();
  for (const r of rows) {
    const subjects = entityIds(r.tags ?? []);
    if (!matches(recipient.bands, subjects)) continue;
    candidates.push(r);
    if (r.story_id === null) continue;
    const current = bestOfStory.get(r.story_id);
    if (!current || betterRow(r, current)) bestOfStory.set(r.story_id, r);
  }

  const items: DigestItem[] = [];
  const bandCounts = new Map<string, { id: string; name: string; accent: string | null; n: number }>();
  for (const r of candidates) {
    if (r.story_id !== null && bestOfStory.get(r.story_id) !== r) continue;
    const subjects = entityIds(r.tags ?? []);
    const bands = bandNames(subjects);
    for (const id of subjects) {
      const entity = ENTITIES[id as keyof typeof ENTITIES];
      if (!entity) continue;
      const cur = bandCounts.get(id) ?? { id, name: entity.name, accent: entity.accent ?? null, n: 0 };
      cur.n += 1;
      bandCounts.set(id, cur);
    }
    items.push({
      title: r.title,
      summary: r.summary ?? "",
      url: itemUrl(r.article_id),
      category: r.category ? CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS] ?? "" : "",
      bands,
      accents: subjects.map((id) => ENTITIES[id as keyof typeof ENTITIES]?.accent).filter((a): a is string => Boolean(a)),
      source: publicSourceName(r.source_name),
      // 契约里写的是 `10/04 12:00`——看板右栏直接印这一串，不能是 ISO 原文。
      time: `${beijingDate(r.timeline_at).slice(5).replace("-", "/")} ${beijingTime(r.timeline_at)}`,
      official: r.first_party,
      selected: true,
    });
    if (items.length >= DIGEST_LIMIT) break;
  }
  if (items.length === 0) return null;

  const day = beijingDate(now);
  // 头图主角 = 这一期出现最多的那支乐队（并列时取名字在前的那支，保证同一批内容永远同一张图）。
  const top = [...bandCounts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))[0];
  return {
    kind: "digest",
    site: emailSite(),
    email: recipient.email,
    heading: `${withSubject("日报")} · ${day.slice(5, 7)}/${day.slice(8, 10)}`,
    lead: `过去 ${DIGEST_WINDOW_HOURS} 小时里，${recipient.bands.length === 0 ? "全站" : "你订阅的乐队"}值得一看的 ${items.length} 条。`,
    items,
    unsubscribeUrl: manageUrl(recipient.token, "unsubscribe"),
    preferencesUrl: manageUrl(recipient.token),
    hero: heroOf({
      accent: top?.accent ?? null,
      star: top?.name ?? SITE.name,
      date: day,
      logo: top?.id ?? null,
    }),
  };
}

/** 确认信头图上那行「你订了什么」：乐队按支、企划按个，混着订就都写出来；一个都没勾就是全部。 */
export function bandCountLine(ids: readonly string[]): string {
  const known = ids.filter((id) => id in ENTITIES);
  if (known.length === 0) return "全部乐队与企划";
  const bands = known.filter(isBand).length;
  const projects = known.length - bands;
  const parts: string[] = [];
  if (bands > 0) parts.push(`${bands} 支乐队`);
  if (projects > 0) parts.push(`${projects} 个企划`);
  return parts.join(" + ");
}

/** 确认信里「你订了哪些乐队」那行；空名单写「全部乐队与企划」。 */
export function bandsSentence(bands: readonly string[]): string {
  const names = bandNames(bands);
  return names.length === 0 ? "全部乐队与企划" : names.join("、");
}

export type { DeadlineKind };
