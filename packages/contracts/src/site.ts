// First-party site API (/api/site/*). Not a public API: it may evolve with the website,
// but it is served from the same public read layer as v1, RSS and MCP.
import type { CategoryKey, ChannelKey } from "./taxonomy.ts";

/**
 * A mark drawn beside a topic's name: an image when the site has one for it, a monogram otherwise.
 */
export interface BrandMarkRef {
  /** Site-relative logo path, or null when only a monogram is available. */
  src: string | null;
  monogram: string;
  /** Raster marks get a light backing plate in dark mode. */
  raster: boolean;
}

export interface SourceRef {
  /** The name readers see (publication/rules.ts publicSourceName), as is every source name here. */
  name: string;
}

export interface MediaView {
  kind: "image" | "video";
  url: string;
  /** Full image for an on-demand viewer; list previews stay small. */
  fullUrl?: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  poster: string | null;
  srcSet?: string;
}

export interface XPostView {
  authorName: string;
  handle: string;
  avatarUrl: string | null;
  avatarSrcSet?: string;
  text: string;
  translation: string | null;
  /** translation: Chinese translation of the quoted post, when it is in another language. */
  quoted: { authorName: string; handle: string; text: string; url: string; translation: string | null } | null;
  media: MediaView[];
}

export interface StoryRef {
  publicId: string;
  title: string;
}

/** What every site answer about an article carries; a card and a page each add the X post in their own form. */
export interface ItemSummary {
  id: string;
  title: string;
  originalTitle: string | null;
  summary: string | null;
  reason: string | null;
  source: SourceRef;
  links: { original: string };
  publishedAt: string | null;
  discoveredAt: string;
  timelineAt: string;
  category: CategoryKey | null;
  tags: string[];
  /**
   * The bands and projects the item was filed under, as `industry/taxonomy.ts` entity ids. `tags` keeps
   * only reader-facing labels, so the entity markers are surfaced here instead — a card can then name the
   * band, and a band page can find its own reports, without the reader ever seeing `entity:` on screen.
   */
  subjects: string[];
  score: number | null;
  selected: boolean;
  channel: "news" | "x";
  story: StoryRef | null;
}

/** The fields rendered by a site feed card; full original text lives in the item detail. */
export interface FeedItemSummary extends Pick<ItemSummary, "id" | "title" | "summary" | "reason" | "source" | "publishedAt" | "timelineAt" | "category" | "tags" | "subjects" | "score" | "selected" | "channel"> {
  /** Upcoming original-stated dates, from the shared calendar read layer. */
  dates?: DeadlineView[];
  datesFrom?: string;
  x: (Pick<XPostView, "authorName" | "handle" | "avatarUrl" | "avatarSrcSet" | "media"> & {
    quoted: Omit<NonNullable<XPostView["quoted"]>, "url"> | null;
  }) | null;
  /**
   * A selected report whose fact is represented by another report (全部动态 and search): that report,
   * so the card can say "同一新闻，精选展示《…》" instead of claiming a seat of its own.
   */
  sameEvent?: { id: string; title: string } | null;
}

export interface GroupInfo {
  factId: string;
  /** Other public sources reporting this same news fact, under the current filters. */
  additionalSourceCount: number;
  /** Distinct public reports of this fact. */
  reportCount: number;
}

export interface TimelineCard {
  key: string;
  anchorAt: string;
  item: FeedItemSummary;
  group: GroupInfo | null;
  /** The highest-scoring representative of this full day, independent of pagination. */
  headliner?: boolean;
}

export interface HotStripEntry {
  rank: number;
  title: string;
  heat: number;
  trend: "up" | "down" | "flat" | "new" | "unknown";
  storyPublicId: string | null;
  itemId: string | null;
  participants: HotParticipant[];
  participantCount: number;
}

export interface TimelineFilters {
  channel: ChannelKey;
  category: CategoryKey | null;
  tag: string | null;
}

export interface TimelineResponse {
  filters: TimelineFilters;
  cards: TimelineCard[];
  nextCursor: string | null;
  hot: HotStripEntry[] | null;
  dayCounts: Record<string, number>;
}

export interface PoolResponse {
  filters: TimelineFilters & { q: string | null; tab: "time" | "relevance" };
  items: FeedItemSummary[];
  page: number;
  pageCount: number;
  total: number;
  todayCount: number;
  freshness: string;
}

export interface OutlineEntry {
  id: string;
  text: string;
  level: number;
}

/**
 * An article page (/api/site/items/:id) in one language: Chinese (the article itself or its translation)
 * unless …/original asks for the original. Only the body shown is sent, with its outline.
 */
export interface SiteItemDetail extends ItemSummary {
  dates?: DeadlineView[];
  datesFrom?: string;
  /** The post with all its media; its text is the body. */
  x: Omit<XPostView, "text" | "translation"> | null;
  /** Selected, but its fact's seat is held by this report: marked 同新闻, without a reason of its own. */
  sameEvent?: { id: string; title: string } | null;
  readingMode: "full" | "summary-only";
  author: string | null;
  /** Whitelisted HTML of the language shown; the other one is null. */
  body: { zh: string | null; original: string | null; zhKind: "translation" | "original" | null; complete: boolean } | null;
  outline: OutlineEntry[];
  relatedStories: StoryRef[];
  /** The topics the report belongs to. */
  topics: TopicLink[];
  indexable: boolean;
  markdownAvailable: boolean;
  group: GroupInfo | null;
  hasTranslation: boolean;
  bodyLanguage: "zh" | "original";
}

/** A fact's public reports under the list's filters: what "另有 N 家信源报道" opens. */
export interface GroupReport {
  id: string;
  title: string;
  source: SourceRef;
  timelineAt: string;
  originalUrl: string;
}

export interface GroupReportsResponse {
  factId: string;
  reports: GroupReport[];
}

// Hot ranking and stories

export interface HotParticipant {
  name: string;
  kind: "editorial" | "signal";
  /** The source's icon, or for an X account its latest collected avatar (proxied). */
  iconUrl: string | null;
  iconSrcSet?: string;
}


export interface HotEntryView {
  rank: number;
  story: StoryRef;
  heat: number;
  trend: "up" | "down" | "flat" | "new" | "unknown";
  trendPct: number | null;
  badges: Array<"surge" | "new" | "rising">;
  participantCount: number;
  sourceCount: number;
  sourceNames: string[];
  participants: HotParticipant[];
  /** Hourly heat over the 24 hours up to the ranking, oldest first; null where no comparable snapshot exists. */
  spark: Array<number | null>;
  /** The story's AI digest, else its fact statement. */
  summary: string | null;
  /** The latest development, one line. */
  latest: string | null;
  /** A picture from the story's public reports (the representative first), for the leading cards. */
  cover: { url: string; srcSet?: string; width: number | null; height: number | null } | null;
}

export interface HotResponse {
  computedAt: string | null;
  windowHours: number;
  entries: HotEntryView[];
}

/**
 * The clock a stated time is on. A Japanese announcement states Japan time, a mainland one Beijing
 * time; the site never converts one into the other, so a deadline that closes at 23:59 local still
 * reads as that day.
 */
export type Timezone = "Asia/Tokyo" | "Asia/Shanghai";

export const TIMEZONES: readonly Timezone[] = ["Asia/Tokyo", "Asia/Shanghai"];

/**
 * The fixed offset of each zone. Neither has observed daylight saving since 1991 and no date the site
 * carries reaches back that far, so a constant offset is exact — no timezone database is needed.
 */
export const TIMEZONE_OFFSETS: Record<Timezone, string> = { "Asia/Tokyo": "+09:00", "Asia/Shanghai": "+08:00" };

/** How a clock is named in the reader's language; printed next to every stated time. */
export const TIMEZONE_LABELS: Record<Timezone, string> = { "Asia/Tokyo": "日本时间", "Asia/Shanghai": "北京时间" };

/**
 * A dated event a report's own text states, for the deadline radar. `day` and `localTime` are the
 * announcement's own wall clock — the wording it gave, never converted to the reader's calendar.
 */
/**
 * Every kind of dated point the site carries, in the order the radar lists them. This array is the one
 * definition: the type, the extraction's schema, the radar's filter and the labels below all derive from
 * it, because the four drifted apart once and silently filed two kinds under 「其他」.
 */
export const DEADLINE_KINDS = [
  "lottery_start", "lottery_end", "sale_start", "sale_end", "event", "stream_end", "result", "release_start", "merch_start",
  "payment_deadline", "other",
] as const;

export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

/**
 * How a dated point is worded. The wording stays on the action ("受理截止", "开卖") rather than on the
 * announcement, because a date is only shown when it is something to do or to wait for. The website
 * and the reminder emails both read this, so the two can never call the same deadline different things.
 */
export const DEADLINE_LABELS: Record<DeadlineKind, { label: string; hint: string }> = {
  lottery_end: { label: "受理截止", hint: "抽选 / 先行受理的最后一天" },
  lottery_start: { label: "受理开始", hint: "抽选 / 先行受理开始" },
  sale_start: { label: "一般发售", hint: "一般发售开卖" },
  sale_end: { label: "贩售截止", hint: "一般发售或当日券卖完的那一天" },
  event: { label: "演出当天", hint: "Live / 活动当天" },
  stream_end: { label: "配信截止", hint: "配信或回看的观看期限" },
  result: { label: "结果公布", hint: "抽选结果或名单公布" },
  release_start: { label: "发售日", hint: "CD / Blu-ray / 数字发行的发行日" },
  merch_start: { label: "周边开订", hint: "周边开始接受订购或预约的日子" },
  payment_deadline: { label: "缴款截止", hint: "当落发表后付款的最后一天" },
  other: { label: "其他", hint: "其他有明确日期的节点" },
};

export interface DeadlineView {
  /**
   * `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when the original stated a time. Kept for readers that only
   * want one string; `day`, `localTime` and `timezone` carry the same thing, split.
   */
  at: string;
  /** The `YYYY-MM-DD` half of `at`, on the announcement's own calendar; buckets the radar's days. */
  day: string;
  /** The `HH:mm` half of `at`, on the announcement's own clock; null when it stated only a day. */
  localTime: string | null;
  /** The clock `localTime` is on: Japan for a Japanese source, Beijing for a mainland one. */
  timezone: Timezone;
  kind: DeadlineKind;
  /** The short label the extraction gave it ("FC先行", "二次先行", "一般発売"), else null. */
  note: string | null;
  /** The report this deadline was stated in; the reader opens it for the original wording. */
  itemId: string;
  title: string;
  url: string;
  category: CategoryKey | null;
  subjects: string[];
  source: SourceRef;
  /** When the report carrying this date was published; null on a publication that carries none. */
  publishedAt: string | null;
  /** The report cleared the editorial selection bar; the radar keeps unselected pool items too. */
  selected: boolean;
  /** Falls within 48 hours of `computedAt`: the radar's action rows. */
  soon: boolean;
}

export interface DeadlinesResponse {
  computedAt: string;
  /** The JST day the window opens on, and the last day it covers. */
  from: string;
  to: string;
  /** Only the days that have something due, oldest first. */
  days: Array<{ date: string; items: DeadlineView[] }>;
  total: number;
}

/**
 * One JST month of dated events for a subject (a band, a project, or the whole site). It is the same
 * rows the radar reads — the dates laid out on a grid instead of a countdown — so a date never shows
 * up in one and not the other. `at` stays Japan wall-clock, exactly as on the radar.
 */
export interface CalendarResponse {
  computedAt: string;
  /** The entity id this calendar is for: a project or a band, whose series' dates come along. */
  subject: string;
  /** The JST month it covers, `YYYY-MM`. */
  month: string;
  /** Only the days of that month that have something, oldest first. */
  days: Array<{ date: string; items: DeadlineView[] }>;
  /** The months that have a date near this one, oldest first — the calendar's jump list. */
  months: string[];
  total: number;
}

/** What the subscribe form posts. */
export interface SubscribeRequest {
  email: string;
  /** Band entity ids; an empty list means "every band" and is the default. */
  bands: string[];
  wantsDeadlines: boolean;
  wantsDigest: boolean;
}

/**
 * The answer is deliberately one shape and one word: an unauthenticated POST must not be usable to
 * probe whether somebody else's address is already on the list. The page tells the reader to go and
 * find the confirmation letter, which is also the truth when they were already subscribed.
 */
export interface SubscribeResponse {
  ok: true;
}

/** The state behind /subscribe/manage. Only reachable with the token from the letter. */
export interface SubscriptionState {
  email: string;
  bands: string[];
  wantsDeadlines: boolean;
  wantsDigest: boolean;
  confirmed: boolean;
}

/** Preference changes and unsubscribing both need the token; nothing here works without it. */
export interface SubscriptionUpdateRequest {
  token: string;
  bands: string[];
  wantsDeadlines: boolean;
  wantsDigest: boolean;
  /** Read as "退订" instead of "保存". */
  unsubscribe?: boolean;
}

export interface HeatPoint {
  hour: string;
  heat: number;
  participants: number;
}

export interface StoryReportView {
  id: string;
  title: string;
  summary: string | null;
  source: SourceRef & { firstParty: boolean };
  publishedAt: string;
  selected: boolean;
}

export interface StoryFactView {
  factId: string;
  title: string;
  firstReportAt: string;
  reportCount: number;
  representative: StoryReportView;
}

export interface StoryDetail {
  publicId: string;
  title: string;
  status: "active" | "watching" | "settled";
  reportCount: number;
  sourceCount: number;
  firstReportAt: string | null;
  latestAt: string | null;
  digest: string | null;
  digestUpdatedAt: string | null;
  /** The story's own factual summary, when it has one. */
  summary: string | null;
  /** Without a digest or summary: the summary of the report the story started from. */
  excerpt: { text: string; sourceName: string } | null;
  latest: string | null;
  /** The current public report supplying latest; never inferred from an independently generated digest. */
  latestReport: { id: string } | null;
  whyHot: {
    participants48h: number;
    newParticipants6h: number;
    recentReports24h: number;
    observationComplete: boolean;
    rank: number | null;
  };
  developments: StoryFactView[];
  /** The dated points this event's own reports state, from today forward — the same entries the radar reads. */
  dates: DeadlineView[];
  officialReports: StoryReportView[];
  timeline: StoryReportView[];
  heat: HeatPoint[];
  related: Array<StoryRef & { relation: "storyline" | "related" }>;
  /** The topics its reports belong to, most reports first. */
  topics: TopicLink[];
  /** The live this event is about, when the facts behind it carry one (see the Live section below). */
  live: LiveRef | null;
}

// Reports (daily / weekly / monthly)

export type ReportKind = "daily" | "weekly" | "monthly";

export interface ReportCitation {
  itemId: string | null;
  title: string;
  summary: string | null;
  sourceName: string;
  sourceUrl: string;
  sourceIconUrl: string | null;
  sourceIconSrcSet?: string;
  firstParty: boolean;
  /** When the cited report was published, if it is still in the database. */
  publishedAt: string | null;
  /** False once the item was withdrawn; the citation then shows as removed. */
  available: boolean;
  /** A daily entry: other sources that reported the event by the issue's cutoff. */
  otherSources?: number;
  /** A daily entry's other developments of the event, or reports of the launch merged into it (titles only). */
  related?: ReportCitation[];
  /** A daily entry whose event an earlier daily covered: that issue's date. */
  followUp?: string;
}

export interface ReportDetail {
  kind: ReportKind;
  key: string;
  /** The issue's place among the existing issues of its kind, oldest first ("第 N 期"). */
  issueNumber: number;
  title: string;
  generatedAt: string;
  lead: { title: string; leadParagraph: string } | null;
  /** The still-public item the front page leads with (its headline links there). */
  leadItemId: string | null;
  overview: string | null;
  highlights: ReportCitation[];
  /** As edited: daily categories, weekly and monthly themes. */
  sections: Array<{ label: string; summary: string | null; items: ReportCitation[] }>;
  flashes: ReportCitation[];
  /**
   * The front page's picture: from the lead item (a daily's lead, a weekly or monthly's first highlight),
   * else from another public report of that event. Captioned with the story when it is not the lead's own.
   */
  cover: { url: string; srcSet?: string; width: number | null; height: number | null; caption: string | null } | null;
  metrics: Record<string, number>;
  readingMinutes: number;
  prev: string | null;
  next: string | null;
}

export interface ReportIndexEntry {
  key: string;
  issueNumber: number;
  title: string | null;
  count: number;
}

export interface ReportIndexResponse {
  kind: ReportKind;
  items: ReportIndexEntry[];
}

/** The latest report page: its archive selector and the report in one request. */
export interface ReportLatestPage {
  index: ReportNavigationEntry[];
  report: ReportDetail | null;
}

/** A report's archive selector, or one month of the daily archive. */
export interface ReportNavigationResponse {
  items: ReportNavigationEntry[];
}

/** Site-wide facts for the web shell: the changelog red-dot anchor. */
export interface SiteMeta {
  changelogVersion: string;
}

/** One entry of industry/changelog.json, newest first. */
export interface ChangelogRelease {
  date: string;
  time: string;
  kind: "更新" | "优化" | "公告" | "下线";
  title: string;
  body: string[];
  /** A notice readers must act on: drawn in the warning red so it cannot be skimmed past. */
  urgent?: true;
}

export interface ChangelogResponse {
  latestVersion: string;
  releases: ChangelogRelease[];
}

/**
 * The about page's contact codes (uploaded in the admin or shipped in the industry pack; null when there is
 * none) and the maker's avatar through the image proxy.
 */
export interface SiteContact {
  wechatQr: string | null;
  feishuQr: string | null;
  makerAvatar: string | null;
}

/** Figures and samples for the about page (site-only; not part of v1). */
export interface SiteStats {
  /** Sources collected from now. */
  sources: number;
  /** Enabled sources by kind: x_search, rss, web_list, mp_account, json_list. */
  sourceKinds: Record<string, number>;
  /** Everything collected and not withdrawn, heat-only sources included. */
  items: number;
  selected: number;
  dailies: number;
  /** The last 24 hours: items found (heat-only sources included), and items that made 精选 (by their place on the timeline). */
  day: { collected: number; selected: number };
  /** Enabled sources in a daily shuffle, for the about page's river: one line per source. */
  sampleSources: Array<{ name: string; kind: string; heatOnly: boolean }>;
  /** The latest 精选, newest first. */
  latest: Array<{ id: string; title: string; source: string }>;
}

export interface StoryFollowup {
  factId: string;
  representative: { id: string; title: string; source: { name: string }; timelineAt: string };
}
export interface StoryFollowupsResponse { items: StoryFollowup[]; more: boolean }

/**
 * A starred item as the site can show it now (/api/site/items/availability, keyed by id). Stars keep the
 * source name of the day they were saved; a public item also brings the name shown today.
 */
export interface ItemAvailability {
  status: "public" | "summary-only" | "unavailable";
  sourceName?: string;
}

/** All issue keys, with their issue numbers, keep calendars stable; closed daily months omit their titles. */
export interface ReportNavigationEntry { key: string; issueNumber?: number; title?: string | null; count?: number }

// Topics

export type TopicGroupKey = "band" | "company" | "field" | "genre";

/**
 * A topic that tracks one subject (a band, a project, a company) rather than a direction or a content
 * form. Subjects get the chronicle band with curated history and take only their own news; the pages
 * render them differently.
 */
export const tracksAsSubject = (group: TopicGroupKey) => group === "company" || group === "band";

export interface TopicGroup {
  key: TopicGroupKey;
  name: string;
  blurb: string;
}

export interface TopicLink {
  slug: string;
  name: string;
}

export interface TopicSummary extends TopicLink {
  group: TopicGroupKey;
  definition: string;
  /** Companies: the company's own mark, else its initial. */
  brand: BrandMarkRef | null;
  /** Selected reports, one per fact (as v1 and RSS count the selected set). */
  total: number;
  /** Of those, in the last 30 days. */
  recent: number;
  /** Enough content to be listed and indexed. */
  indexable: boolean;
  /** The newest selected report. */
  latest: { title: string; at: string } | null;
}

export interface TopicsResponse {
  groups: TopicGroup[];
  topics: TopicSummary[];
}

/**
 * What a milestone is: a key of the industry pack's kinds (industry/chronicle.ts). In the AI demo pack a
 * model release, a product launch, research, a company's own news (its topic page) or industry news.
 */
export type TopicMilestoneKind = string;

/** How the pages show one kind of milestone. */
export interface TopicKind {
  label: string;
  /** Its track lies above the axis, with the strongest mark (AI pack: models). */
  above: boolean;
  /** What a topic launches itself, with the accent mark (AI pack: models and products). */
  launch: boolean;
}

/** One event of a topic's chronicle, from the report that heads it. */
export interface TopicEvent {
  id: string;
  /** The report's headline. */
  title: string;
  /** The event's name in the chronicle: "Claude Opus 5.5 发布". */
  label: string;
  at: string;
  kind: TopicMilestoneKind;
  /** Its event page when it belongs to a public story, else the article page. */
  href: string;
}

export interface TopicMonth {
  /** Beijing calendar month, YYYY-MM. */
  month: string;
  events: TopicEvent[];
}

/** A milestone on a company's chronicle band: its curated history, then what the site picked up since. */
export interface TopicMilestone {
  /** "2022", "2022-11" or "2022-11-30", Beijing calendar. */
  date: string;
  kind: TopicMilestoneKind;
  /** Its name in the chronicle: as curated, or the label of what the site picked up. */
  title: string;
  /** The headline of the report the site picked it up from; null for curated history. */
  headline: string | null;
  summary: string | null;
  /** Its event page, its article page or (curated history) the original; null when it has none. */
  href: string | null;
  external: boolean;
  /** A defining event of the curated history, its title set in bold; never set on what the site picked up. */
  major: boolean;
}

export interface TopicPage {
  topic: TopicSummary & { groupName: string; /** Every listed report, selected or not. */ poolTotal: number };
  /** Every kind of milestone by key. */
  kinds: Record<TopicMilestoneKind, TopicKind>;
  /** Which view the page shows: the editorial picks, or everything the topic has. */
  scope: TopicScope;
  /** The rest is for the first page only. A direction's months, newest first — subjects use `milestones`. */
  chronicle: TopicMonth[];
  /** A company's chronicle band, oldest first. */
  milestones: TopicMilestone[];
  /** The most important events of the last 30 days. */
  highlights: TopicEvent[];
  /** This subject's live events, soonest first — the same rows its Live section and calendar show. */
  lives: LiveEventSummary[];
  items: FeedItemSummary[];
  page: number;
  pageCount: number;
  pageSize: number;
}

/**
 * A topic page's two views. `picked` is the editorial selection — what the site judged worth reading;
 * `all` is everything the site has on the topic, the same pool the pool total counts. They share the
 * topic's membership rule, so the wider one is never a different topic, only a wider cut of it.
 */
export type TopicScope = "picked" | "all";

/** Site homepage figures, aggregated by the public read layer, independent of feed filters. */
export interface HomeResponse {
  computedAt: string;
  today: string;
  stats: { today: number; soon: number; weekDeadlines: number; monthDates: number; bands: number; sources: number };
  bandWeek: Record<string, number>;
  bandMonthDeadlines: Record<string, number>;
  trackCounts: Record<string, number>;
  projects: Record<string, { latest: { id: string; title: string } | null; today: number; deadlines: number }>;
  deadlines: DeadlinesResponse;
}

// Live events (一场演出的身份)
//
// A live is not a report and not a story: reports get merged and stories get redirected, while the
// question "这场 Live 现在走到哪一步" has to keep one answer. `live_events` holds the identity, and the
// stage below is derived at read time from the dates and the reports — never stored, so it cannot go
// stale. Everything here is on the announcement's own calendar and clock (the W7 rule).

/** Where the run-up to a live stands. Derived at read time; what happened to the status stays separate. */
export type LiveStage = "announced" | "ticketing" | "on_sale" | "live_day" | "finished" | "cancelled" | "postponed";

/** The status the announcement itself stated. The reader-facing stage is derived around it. */
export type LiveStatus = "scheduled" | "cancelled" | "postponed";

/** The minimum a list needs to show one live: a subject page's Live section, a story's link to it. */
export interface LiveRef {
  publicId: string;
  title: string;
  /** The entity id of the band or project the live belongs to; its topic page is `/topics/<subject>`. */
  subject: string;
  subjectName: string;
  venue: string | null;
  timezone: Timezone;
  /** `YYYY-MM-DD` on the announcement's own calendar. */
  startsOn: string;
  startsTime: string | null;
  stage: LiveStage;
}

export interface LiveEventSummary extends LiveRef {
  /** The last day of a multi-day run; null for a single performance. */
  endsOn: string | null;
  /** Days from today to `startsOn` on the event's own calendar; negative once past. */
  daysLeft: number | null;
  reportCount: number;
}

export interface LiveEventView extends LiveEventSummary {
  status: LiveStatus;
  /** When the site first saw this live, and when it was last written. */
  firstSeenAt: string;
  updatedAt: string;
  /** Its own reports, listed ones only, newest first — the same gate the rest of the site uses. */
  reports: StoryReportView[];
  /** The dated points its reports state, from today forward — the same rows the radar reads. */
  dates: DeadlineView[];
  /** The acceptance windows its reports state, earliest first — where the ticket dates now come from. */
  rounds: TicketRoundView[];
  /** The event page its reports are grouped under, when they are grouped under one. */
  story: { publicId: string; title: string } | null;
}

// Ticket rounds (一场演出的一条受理)
//
// A live is announced once and applied for several times: FC 先行, then 官方先行, then 一般贩售, maybe
// 追加席 or 当日券. Each window is a round with its own dates, and `ticket_rounds` is the authority for
// the ticket dates the radar, the calendar and the .ics export show: the structure step's own
// `lottery_*` / `sale_*` / `result` rows step aside for a live that has rounds, so one deadline never
// shows up twice. The status is derived at read time from the dates and the observed timeline, never
// stored, so it cannot go stale. What the site deliberately does not know: whether *you* won or paid —
// there are no accounts here, and the original only ever states the announcement's own dates.

export const TICKET_ROUND_KINDS = [
  "fc", "official", "cd_serial", "playguide", "general", "additional_seat", "day_of", "resale", "streaming",
] as const;

export type TicketRoundKind = (typeof TICKET_ROUND_KINDS)[number];

/** How a round is named in the reader's language. The label says who may apply, not which platform. */
export const TICKET_ROUND_LABELS: Record<TicketRoundKind, string> = {
  fc: "FC 先行",
  official: "官方先行",
  cd_serial: "CD 序列号先行",
  playguide: "售票平台先行",
  general: "一般贩售",
  additional_seat: "追加席",
  day_of: "当日券",
  resale: "转售",
  streaming: "配信票",
};

/** A lottery to apply for, rather than a sale to buy: only these open with 受理 and close with 截止. */
export const LOTTERY_ROUND_KINDS: ReadonlySet<TicketRoundKind> = new Set<TicketRoundKind>(["fc", "official", "cd_serial", "playguide"]);

/**
 * Where a round stands: `announced` before applications open, `open` while they do, `awaiting_result`
 * between the deadline and the result, `result_out` once it is out, `payment_open` until the payment
 * deadline, and `closed` once every date it knows has passed.
 */
export type TicketRoundStatus = "announced" | "open" | "awaiting_result" | "result_out" | "payment_open" | "closed";

/** One dated point of a round. Both halves are on the announcement's own clock, like every other date. */
export interface TicketRoundDate {
  at: string;
  day: string;
  localTime: string | null;
}

export interface TicketRoundView {
  publicId: string;
  kind: TicketRoundKind;
  /** The platform the original named, in the glossary's own writing; null when it named none. */
  platform: string | null;
  timezone: Timezone;
  status: TicketRoundStatus;
  applyStart: TicketRoundDate | null;
  applyEnd: TicketRoundDate | null;
  resultOn: TicketRoundDate | null;
  paymentDueOn: TicketRoundDate | null;
  /** The report that first stated this round, when it still has a public page: where the date came from. */
  itemId: string | null;
  title: string | null;
  firstSeenAt: string;
}
