// First-party site API (/api/site/*). Not public, not versioned, never called /api/v2.
// Reads through the same public read layer as v1; no cookies are read or set.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isCategoryKey, isChannelKey, parseSubjectIds, type CategoryKey, type ChannelKey } from "@girlsbands/contracts/taxonomy";
import { DEADLINE_KINDS, type DeadlineKind } from "@girlsbands/contracts/site";
import type { ReportIndexResponse, ReportLatestPage, ReportNavigationResponse, SiteContact, TopicScope } from "@girlsbands/contracts/site";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { InvalidCursorError } from "@girlsbands/backend/lib/cursor";
import { exportMarkdown, loadItemDetail } from "@girlsbands/backend/publication/detail";
import { loadPool, SearchBusyError } from "@girlsbands/backend/publication/pool";
import { loadSeiyuu } from "@girlsbands/backend/publication/seiyuu";
import { loadHome } from "@girlsbands/backend/publication/home";
import { loadTimeline } from "@girlsbands/backend/publication/timeline";
import { loadStoryFollowups } from "@girlsbands/backend/publication/followups";
import { loadGroupReports } from "@girlsbands/backend/publication/groups";
import { loadHotStrip } from "@girlsbands/backend/publication/hot";
import { upcomingDeadlines, actionCenter } from "@girlsbands/backend/publication/deadlines";
import { loadChangelog, siteMeta } from "@girlsbands/backend/site/meta";
import { loadContact, loadMakerAvatar } from "@girlsbands/backend/site/contact";
import { loadSiteStats } from "@girlsbands/backend/site/stats";
import { itemAvailability } from "@girlsbands/backend/publication/availability";
import { listTopicSummaries, loadTopicPage } from "@girlsbands/backend/publication/topics";
import { listMembers, loadMemberPage } from "@girlsbands/backend/publication/members";
import { calendarPage, calendarSubject } from "@girlsbands/backend/publication/calendar";
import { registerFeedback } from "./feedback.ts";
import { registerSubscribe } from "./subscribe.ts";
import { loadHot, loadStoryDetail, resolveStory } from "@girlsbands/backend/publication/stories";
import { liveCalendar, loadLive } from "@girlsbands/backend/publication/lives";
import { loadRelease } from "@girlsbands/backend/publication/releases";
import { listReports, loadReport, reportNavigation, loadReportNavigation, loadReportMonth, type ReportKind } from "@girlsbands/backend/publication/reports";
import { looseQuery, sendJsonWithEtag, sendProblem } from "../http/respond.ts";
import { recordPageView } from "@girlsbands/backend/operations/pageviews";

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

class BadRequest extends Error {}

export function siteHandler(fn: Handler): Handler {
  return async (req, reply) => {
    try {
      return await fn(req, reply);
    } catch (error) {
      if (error instanceof BadRequest) return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: error.message });
      if (error instanceof InvalidCursorError) return sendProblem(req, reply, { status: 400, code: "invalid_cursor", detail: error.message });
      if (error instanceof SearchBusyError) {
        return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "search busy", retryAfter: error.retryAfter });
      }
      req.log.error({ err: error, path: req.url.split("?")[0] }, "site api error");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "temporarily unavailable", retryAfter: 10 });
    }
  };
}

export interface FilterParams {
  channel: ChannelKey;
  category: CategoryKey | null;
  tag: string | null;
  /** 「只看关注」勾选的主体 id（乐队或企划）；空数组就是不过滤。 */
  subjects: string[];
}

export function parseFilters(q: Record<string, string>): FilterParams {
  const channel = q.channel ?? "all";
  if (!isChannelKey(channel)) throw new BadRequest("invalid channel");
  const category = q.category ?? null;
  if (category !== null && !isCategoryKey(category)) throw new BadRequest("invalid category");
  const tag = q.tag?.trim() ? q.tag.trim().slice(0, 60) : null;
  return { channel, category: category as CategoryKey | null, tag, subjects: parseSubjectIds(q.subjects) };
}

/** `?kinds=sale_start,lottery_end` — unknown names are dropped; a value with none left matches nothing. */
function kindsParam(value: string): DeadlineKind[] {
  const names = value.split(",").map((v) => v.trim()).filter(Boolean);
  return names.filter((n): n is DeadlineKind => (DEADLINE_KINDS as readonly string[]).includes(n));
}

export function registerSite(app: FastifyInstance) {
  app.post("/api/site/pv", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const ua = String(req.headers["user-agent"] ?? "");
    if (/bot|crawler|spider|slurp|headless|facebookexternalhit|preview/i.test(ua)) return reply.code(204).send();
    let data: any = req.body;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { return reply.code(204).send(); } }
    if (!data || typeof data.path !== "string" || !data.path.startsWith("/") || data.path.startsWith("//")) return reply.code(204).send();
    const ip = String(req.headers["eo-connecting-ip"] ?? req.ip ?? "").split(",")[0]!.trim();
    const uaFamily = ua.slice(0, 500);
    const device = /ipad|tablet/i.test(ua) ? "tablet" : /mobile|iphone|android/i.test(ua) ? "mobile" : "desktop";
    const country = typeof req.headers["eo-country-code"] === "string" ? req.headers["eo-country-code"] : null;
    await recordPageView({ path: data.path.slice(0, 500), referrer: typeof data.referrer === "string" ? data.referrer.slice(0, 2000) : null, ip, ua: uaFamily, device, country });
    return reply.code(204).send();
  });

  app.get("/api/site/home", siteHandler(async (req, reply) => sendJsonWithEtag(req, reply, await loadHome(), { etagPrefix: "home", cacheControl: "public, max-age=60, s-maxage=60" })));

  app.get("/api/site/meta", siteHandler(async (req, reply) => {
    return sendJsonWithEtag(req, reply, siteMeta(), { etagPrefix: "meta", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/timeline", siteHandler(async (req, reply) => {
    const q = looseQuery(req);
    const filters = parseFilters(q);
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 40);
    // 只看关注是这位读者自己带来的筛选：热榜是全站的，不跟着一起切。
    const unfiltered = filters.channel === "all" && !filters.category && !filters.tag && !filters.subjects.length && !q.cursor;
    const [data, hot] = await Promise.all([
      loadTimeline({ ...filters, cursor: q.cursor || null, limit }),
      unfiltered ? loadHotStrip() : null,
    ]);
    // Any cache in front and the home page built from this answer share one absolute deadline.
    reply.header("X-Accel-Expires", `@${Math.floor(Date.now() / 1000) + 60}`);
    return sendJsonWithEtag(req, reply, { ...data, hot }, { etagPrefix: "tl", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/pool", siteHandler(async (req, reply) => {
    const q = looseQuery(req);
    const filters = parseFilters(q);
    const page = Math.min(Math.max(Number(q.page) || 1, 1), 50);
    const search = q.q?.trim() ? q.q.trim().slice(0, 200) : null;
    const tab = q.tab === "relevance" ? "relevance" : "time";
    return sendJsonWithEtag(req, reply, await loadPool({ ...filters, q: search, tab, page }), { etagPrefix: "pool", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  // 声优日常：成员个人账号的帖子时间线。乐队筛选只认 taxonomy 里的主体，账号筛选是来源 id。
  app.get("/api/site/seiyuu", siteHandler(async (req, reply) => {
    const q = looseQuery(req);
    const band = q.band?.trim() || null;
    if (band && !Object.hasOwn(ENTITIES, band)) throw new BadRequest("unknown band");
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 40);
    return sendJsonWithEtag(req, reply, await loadSeiyuu({ band, account: q.account?.trim() || null, cursor: q.cursor || null, limit }), { etagPrefix: "seiyuu", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/items/:id", siteHandler(async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "item not found" });
    const result = await loadItemDetail(id);
    if (result.kind === "not_found") return sendProblem(req, reply, { status: 404, code: "not_found", detail: "item not found", cacheControl: "public, max-age=60" });
    return sendJsonWithEtag(req, reply, result.item, { etagPrefix: "item", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/items/:id/original", siteHandler(async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "item not found" });
    const result = await loadItemDetail(id, "original");
    if (result.kind === "not_found") return sendProblem(req, reply, { status: 404, code: "not_found", detail: "item not found", cacheControl: "public, max-age=60" });
    return sendJsonWithEtag(req, reply, result.item, { etagPrefix: "item-original", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/stories/:publicId/followups", siteHandler(async (req, reply) => {
    const result = await loadStoryFollowups((req.params as { publicId: string }).publicId);
    if (!result) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "story not found" });
    return reply.header("Cache-Control", "no-store").send(result);
  }));

  app.get("/api/site/groups/:factId/reports", siteHandler(async (req, reply) => {
    const data = await loadGroupReports({ factPublicId: (req.params as { factId: string }).factId, ...parseFilters(looseQuery(req)) });
    if (!data) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "reading group unavailable" });
    return reply.header("Cache-Control", "no-store").send(data);
  }));

  app.get("/api/site/contact", siteHandler(async (req, reply) => {
    const [contact, makerAvatar] = await Promise.all([loadContact(), loadMakerAvatar()]);
    const body: SiteContact = { ...contact, makerAvatar };
    return sendJsonWithEtag(req, reply, body, { etagPrefix: "contact", cacheControl: "public, max-age=300, s-maxage=300" });
  }));

  app.get("/api/site/stats", siteHandler(async (req, reply) => {
    return sendJsonWithEtag(req, reply, await loadSiteStats(), { etagPrefix: "stats", cacheControl: "public, max-age=300, s-maxage=300" });
  }));

  app.get("/api/site/changelog", siteHandler(async (req, reply) => {
    return sendJsonWithEtag(req, reply, loadChangelog(), { etagPrefix: "changelog", cacheControl: "public, max-age=300, s-maxage=300" });
  }));

  app.get("/api/site/items/availability", siteHandler(async (req, reply) => {
    const ids = (looseQuery(req).ids ?? "").split(",").filter(Boolean);
    reply.header("Cache-Control", "no-store");
    return reply.send(await itemAvailability(ids));
  }));

  app.get("/api/site/topics", siteHandler(async (req, reply) => {
    return sendJsonWithEtag(req, reply, await listTopicSummaries(), { etagPrefix: "topics", cacheControl: "public, max-age=300, s-maxage=300" });
  }));

  app.get("/api/site/topics/:slug", siteHandler(async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const query = looseQuery(req);
    // Anything other than the one documented value is the picked set: an unknown query never widens a page.
    const scope: TopicScope = query.scope === "all" ? "all" : "picked";
    const data = await loadTopicPage(slug, Number(query.page ?? 1), undefined, scope);
    if (!data) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "topic page not found", cacheControl: "public, max-age=60" });
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "topic", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/members", siteHandler(async (req, reply) => {
    return sendJsonWithEtag(req, reply, await listMembers(), { etagPrefix: "members", cacheControl: "public, max-age=300, s-maxage=300" });
  }));

  app.get("/api/site/members/:id", siteHandler(async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const data = await loadMemberPage(id, Number(looseQuery(req).page ?? 1));
    if (!data) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "member page not found", cacheControl: "public, max-age=60" });
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "member", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/calendar/:subject", siteHandler(async (req, reply) => {
    const subject = calendarSubject((req.params as { subject: string }).subject);
    if (!subject) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "no calendar for that subject", cacheControl: "public, max-age=60" });
    const data = await calendarPage(new Date(), looseQuery(req).month ?? null, subject.id);
    if (!data) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "no such month", cacheControl: "public, max-age=60" });
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "calendar", cacheControl: "public, max-age=300, s-maxage=300" });
  }));

  // Live 板块的演出日历：?month=YYYY-MM&band=<entity id>。
  app.get("/api/site/lives", siteHandler(async (req, reply) => {
    const q = looseQuery(req);
    const band = q.band?.trim() || null;
    if (band && !ENTITIES[band]) return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "unknown band", cacheControl: "public, max-age=60" });
    const month = q.month?.trim() || null;
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "month must be YYYY-MM", cacheControl: "public, max-age=60" });
    const data = await liveCalendar(new Date(), { month, band });
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "lives", cacheControl: "public, max-age=300, s-maxage=300" });
  }));

  registerFeedback(app);
  registerSubscribe(app);

  app.get("/api/site/hot", siteHandler(async (req, reply) => {
    const data = await loadHot();
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "hot", cacheControl: "public, max-age=30, s-maxage=30" });
  }));

  app.get("/api/site/deadlines", siteHandler(async (req, reply) => {
    const q = looseQuery(req);
    const horizon = Number(q.horizon);
    const kinds = q.kinds;
    const data = await upcomingDeadlines(new Date(), {
      horizonDays: Number.isFinite(horizon) && horizon > 0 ? horizon : undefined,
      subject: q.subject?.trim() || undefined,
      kinds: kinds ? kindsParam(kinds) : undefined,
    });
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "deadlines", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  // The home page's action center: the radar's rows for the near days, split by what to do about them.
  app.get("/api/site/actions", siteHandler(async (req, reply) => {
    const q = looseQuery(req);
    const horizon = Number(q.horizon);
    const data = await actionCenter(new Date(), {
      horizonDays: Number.isFinite(horizon) && horizon > 0 ? horizon : undefined,
      subject: q.subject?.trim() || undefined,
    });
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "actions", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/stories/:publicId", siteHandler(async (req, reply) => {
    const publicId = (req.params as { publicId: string }).publicId;
    const found = await resolveStory(publicId);
    if (found.kind === "merged") {
      return reply.code(308).header("Location", `/api/site/stories/${found.target}`).header("Cache-Control", "public, max-age=300").send({ mergedInto: found.target });
    }
    if (found.kind === "not_found") return sendProblem(req, reply, { status: 404, code: "not_found", detail: "story not found", cacheControl: "public, max-age=60" });
    const data = await loadStoryDetail(found.storyId);
    if (!data) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "story not public", cacheControl: "public, max-age=60" });
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "story", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/lives/:publicId", siteHandler(async (req, reply) => {
    const publicId = (req.params as { publicId: string }).publicId;
    const data = await loadLive(publicId);
    if (!data) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "live not public", cacheControl: "public, max-age=60" });
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "live", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/releases/:publicId", siteHandler(async (req, reply) => {
    const publicId = (req.params as { publicId: string }).publicId;
    const data = await loadRelease(publicId);
    if (!data) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "release not public", cacheControl: "public, max-age=60" });
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "release", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/reports/:kind", siteHandler(async (req, reply) => {
    const kind = (req.params as { kind: string }).kind;
    if (!["daily", "weekly", "monthly"].includes(kind)) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "unknown report kind" });
    const body: ReportIndexResponse = { kind: kind as ReportKind, items: await listReports(kind as ReportKind) };
    return sendJsonWithEtag(req, reply, body, { etagPrefix: "reports", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  // The latest report page needs its archive selector and the report in one HTTP request.
  app.get("/api/site/reports/:kind/latest-page", siteHandler(async (req, reply) => {
    const kind = (req.params as { kind: string }).kind;
    if (!["daily", "weekly", "monthly"].includes(kind)) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "unknown report kind" });
    const index = await listReports(kind as ReportKind);
    const report = index[0] ? await loadReport(kind as ReportKind, index[0].key) : null;
    const body: ReportLatestPage = { index: reportNavigation(kind as ReportKind, index, report?.key ?? ""), report };
    return sendJsonWithEtag(req, reply, body, { etagPrefix: "report-latest", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/reports/:kind/navigation/:key", siteHandler(async (req, reply) => {
    const { kind, key } = req.params as { kind: string; key: string };
    if (!["daily", "weekly", "monthly"].includes(kind) || !/^\d{4}-(\d{2}(-\d{2})?|W\d{2})$/.test(key)) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "report not found" });
    const body: ReportNavigationResponse = { items: await loadReportNavigation(kind as ReportKind, key) };
    return sendJsonWithEtag(req, reply, body, { etagPrefix: "report-navigation", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/reports/daily/months/:month", siteHandler(async (req, reply) => {
    const { month } = req.params as { month: string };
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "month not found" });
    const body: ReportNavigationResponse = { items: await loadReportMonth("daily", month) };
    return sendJsonWithEtag(req, reply, body, { etagPrefix: "report-month", cacheControl: "public, max-age=60, s-maxage=60" });
  }));

  app.get("/api/site/reports/:kind/:key", siteHandler(async (req, reply) => {
    const { kind, key } = req.params as { kind: string; key: string };
    if (!["daily", "weekly", "monthly"].includes(kind) || !/^\d{4}-(\d{2}(-\d{2})?|W\d{2})$/.test(key)) {
      return sendProblem(req, reply, { status: 404, code: "not_found", detail: "report not found" });
    }
    const data = await loadReport(kind as ReportKind, key);
    if (!data) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "report not found", cacheControl: "public, max-age=60" });
    return sendJsonWithEtag(req, reply, data, { etagPrefix: "report", cacheControl: "public, max-age=120, s-maxage=120" });
  }));

  // Markdown export: attachment, 404 when there is nothing to export (same predicate as the button).
  app.get("/items/:id/markdown", siteHandler(async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
    const md = await exportMarkdown(id);
    if (!md) return reply.code(404).header("Cache-Control", "public, max-age=60").type("text/plain; charset=utf-8").send("Not found");
    return reply
      .header("Content-Type", "text/markdown; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${md.filename}"`)
      .header("Cache-Control", "public, max-age=300, s-maxage=300")
      .header("X-Robots-Tag", "noindex")
      .send(md.body);
  }));
}
