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
 * A dated event a report's own text states, for the deadline radar. `at` is Japan wall-clock — the
 * date the announcement itself gives — never converted to the reader's calendar, so a deadline that
 * closes at 23:59 JST still reads as that day.
 */
export type DeadlineKind = "lottery_start" | "lottery_end" | "sale_start" | "event" | "stream_end" | "result" | "other";

/**
 * How a dated point is worded. The wording stays on the action ("受理截止", "开卖") rather than on the
 * announcement, because a date is only shown when it is something to do or to wait for. The website
 * and the reminder emails both read this, so the two can never call the same deadline different things.
 */
export const DEADLINE_LABELS: Record<DeadlineKind, { label: string; hint: string }> = {
  lottery_end: { label: "受理截止", hint: "抽选 / 先行受理的最后一天" },
  lottery_start: { label: "受理开始", hint: "抽选 / 先行受理开始" },
  sale_start: { label: "一般发售", hint: "一般发售开卖" },
  event: { label: "演出当天", hint: "Live / 活动当天" },
  stream_end: { label: "配信截止", hint: "配信或回看的观看期限" },
  result: { label: "结果公布", hint: "抽选结果或名单公布" },
  other: { label: "其他", hint: "其他有明确日期的节点" },
};

export interface DeadlineView {
  /** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when the original stated a time. */
  at: string;
  /** The `YYYY-MM-DD` half of `at`, which buckets the radar's days. */
  day: string;
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
  /** The rest is for the first page only. A direction's or a form's months, newest first. */
  chronicle: TopicMonth[];
  /** A company's chronicle band, oldest first. */
  milestones: TopicMilestone[];
  /** The most important events of the last 30 days. */
  highlights: TopicEvent[];
  items: FeedItemSummary[];
  page: number;
  pageCount: number;
  pageSize: number;
}
