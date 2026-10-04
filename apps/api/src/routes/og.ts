// Share images (1200×630 PNG) for pages, items, reports, topics and events. Only public content
// gets a card; anything else is a real 404.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { beijingDate } from "@aihot/contracts/time";
import { loadItemShare } from "@aihot/backend/publication/og";
import { loadReport, type ReportKind } from "@aihot/backend/publication/reports";
import { findTopic, TOPIC_GROUPS, TOPICS } from "@aihot/backend/publication/topics";
import { loadStoryDetail, resolveStory } from "@aihot/backend/publication/stories";
import { ogEtag, renderOg, type OgCard } from "../og/render.ts";
import { posterEtag, renderPoster, type Poster } from "../og/poster.ts";
import { renderHero } from "../og/hero.ts";
import { parseDateFile, parseTitleFile, renderDate, renderTitle } from "../og/title.ts";
import { decodeHero } from "@aihot/industry/email/hero";
import { SITE, subjectAfter, withSubject } from "@aihot/industry/site";
import { config } from "@aihot/backend/config";
import { Rejected, rateLimit, sourceFingerprint } from "@aihot/backend/operations/abuse";

const S = SITE.subject;

const PAGES: Record<string, OgCard> = {
  site: { kicker: SITE.name, title: SITE.tagline, subtitle: SITE.description },
  all: { kicker: `全部${withSubject("动态")}`, title: "所有信源的最新动态，一站看完", subtitle: "按时间汇总各信源的最新动态，可按类别与标签筛选。" },
  hot: { kicker: "热点榜", title: "过去 48 小时，大家在讨论什么", subtitle: "热度指数、趋势与组成热度的公开来源。", accent: "hot" },
  deadlines: { kicker: "截止雷达", title: `${subjectAfter("未来 30 天", "圈")}会过期的日子`, subtitle: "抽选与先行受理截止、一般发售开卖、演出当天、配信观看期限。", accent: "hot" },
  daily: { kicker: withSubject("日报"), title: `每天 8 点，一份读得完的${withSubject("日报")}`, subtitle: `前一天值得关注的${S}动态。` },
  weekly: { kicker: withSubject("周报"), title: "一周大事，一次看清", subtitle: "本周的主线、重要发布与值得回看的讨论。" },
  monthly: { kicker: withSubject("月报"), title: "一个月的变化", subtitle: "月度主线与关键事件回顾。" },
  topics: { kicker: "主题", title: `${TOPICS.length} ${subjectAfter("个长期追踪的", "方向")}`, subtitle: `${TOPIC_GROUPS.map((g) => g.name).join("、")}。` },
  about: { kicker: "关于", title: `关于 ${SITE.name}`, subtitle: SITE.description },
  terms: { kicker: "使用规则", title: `${SITE.name} 使用规则`, subtitle: "网站、API、RSS 与 MCP 的使用范围。" },
  privacy: { kicker: "隐私说明", title: `${SITE.name} 隐私说明`, subtitle: "访问日志、浏览器本地数据与反馈资料的处理方式。" },
  changelog: { kicker: "更新日志", title: `${SITE.name} 更新日志`, subtitle: "功能更新、优化、公告与下线记录。" },
  feedback: { kicker: "反馈", title: "告诉我们哪里可以更好", subtitle: "内容、功能、接入，或来源方的更正与下架请求。" },
  agent: { kicker: "Agent 接入", title: `把 ${SITE.name} 接进你的 Agent`, subtitle: "Markdown、MCP、RSS、API 四种方式，匿名只读，无需 API Key。" },
};

/**
 * Article and event share images carry current content, so shared caches keep them for an hour at most:
 * after a withdrawal or a correction they are gone from any cache within the hour.
 */
const CONTENT_IMAGE_CACHE = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600";
const CONTENT_IMAGE_ORIGIN_SECONDS = "300";
/**
 * 邮件头图可以久存：地址里的 token 就是内容本身（改了内容就换了地址），所以一张图永远不会变。
 * 但仍然给了 7 天而不是一年——真改了模板，旧信里的地址最多一周就会重新取一次。
 */
const EMAIL_IMAGE_CACHE = "public, max-age=86400, s-maxage=604800";
/** 头图按来源限速（每分钟）。真机几乎都命中 CDN 与磁盘缓存，这个数只挡「拿新 token 刷冷启动」的人。 */
const HERO_RENDERS_PER_MINUTE = 60;
/**
 * 邮件里的标题图/日期图（apps/api/src/og/title.ts）：参数只有几个，全站共用同一批 PNG，
 * 冷启动之后全是磁盘缓存，所以限速与头图同档——它挡的是刷冷启动，不是正常收件人。
 */
const CARD_RENDERS_PER_MINUTE = 60;

/** 超限就回 429（带 Retry-After）并返回已发送的 reply；没超返回 null。 */
function overLimit(req: FastifyRequest, reply: FastifyReply, scope: string): FastifyReply | null {
  try {
    rateLimit(`${scope}:${sourceFingerprint(String(req.headers["x-real-ip"] ?? req.ip ?? ""), String(req.headers["user-agent"] ?? ""))}`, CARD_RENDERS_PER_MINUTE, "请求太频繁。");
    return null;
  } catch (error) {
    if (!(error instanceof Rejected)) throw error;
    return reply.code(error.status).header("Retry-After", String(error.retryAfter ?? 60)).type("text/plain; charset=utf-8").send("Too many requests");
  }
}

/** ETag 命中就 304（弱校验前缀与逗号列表按 HTTP 语义处理）。 */
function notModified(req: FastifyRequest, tag: string): boolean {
  return String(req.headers["if-none-match"] ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === tag);
}

async function send(req: FastifyRequest, reply: FastifyReply, card: OgCard, maxAge: number, cacheControl = `public, max-age=${maxAge}, s-maxage=${maxAge * 7}, stale-while-revalidate=86400`) {
  const tag = `"og-${ogEtag(card)}"`;
  reply.header("ETag", tag).header("Cache-Control", cacheControl);
  if (String(req.headers["if-none-match"] ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === tag)) return reply.code(304).send();
  return reply.type("image/png").send((await renderOg(card)).png);
}

function notFound(reply: FastifyReply) {
  return reply.code(404).header("Cache-Control", "public, max-age=300").type("text/plain; charset=utf-8").send("Not found");
}

const REPORT_NAMES: Record<ReportKind, string> = { daily: withSubject("日报"), weekly: withSubject("周报"), monthly: withSubject("月报") };

export function registerOg(app: FastifyInstance) {
  app.get("/og/site.png", (req, reply) => send(req, reply, PAGES.site!, 86400));

  app.get("/og/pages/:file", async (req, reply) => {
    const name = (req.params as { file: string }).file.replace(/\.png$/, "");
    const card = PAGES[name];
    if (!card || !(req.params as { file: string }).file.endsWith(".png")) return notFound(reply);
    return send(req, reply, card, 86400);
  });

  /**
   * 邮件头图（1200×600，邮件里按 600×300 显示）。地址里带着一份**无状态**的 spec（base64url），
   * 所以这里不查库：一封已经发出去的旧信，永远指向它当年那张图。
   * 也正因为地址即内容，token 必须被当成不可信输入——decodeHero() 会限长、只认 6 位十六进制颜色、
   * 把所有文字截到 60 字并剥掉控制字符；坏 token 一律 404，绝不画一张半成品。
   * spec 里那个乐队 id（`logo`）只用来在 assets/band-logos/ 里查表，**渲染时不出网**——这是这条
   * 路由相对上一版最重要的变化：它曾经照着 token 里的照片地址去外网取图，那条 SSRF 面已经消失。
   * 限速仍然留着：satori 渲染是这台机器上最贵的公开动作，冷缓存被刷一样会把 CPU 打满。
   * 邮件客户端默认屏蔽图片，所以这张图的宗旨是「不加载也读得懂」，alt 与 bg 由模板兜底。
   */
  app.get("/og/email/:file", async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!file.endsWith(".png")) return notFound(reply);
    const spec = decodeHero(file.slice(0, -4));
    if (!spec) return notFound(reply);
    try {
      rateLimit(`hero:${sourceFingerprint(String(req.headers["x-real-ip"] ?? req.ip ?? ""), String(req.headers["user-agent"] ?? ""))}`, HERO_RENDERS_PER_MINUTE, "请求太频繁。");
    } catch (error) {
      if (!(error instanceof Rejected)) throw error;
      return reply.code(error.status).header("Retry-After", String(error.retryAfter ?? 60)).type("text/plain; charset=utf-8").send("Too many requests");
    }
    const { png, etag } = await renderHero(spec);
    const tag = `"hero-${etag}"`;
    reply.header("ETag", tag).header("Cache-Control", EMAIL_IMAGE_CACHE);
    if (String(req.headers["if-none-match"] ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === tag)) return reply.code(304).send();
    return reply.type("image/png").send(png);
  });

  /**
   * 邮件里的标题图（1104×218，显示 552×109）与日期图（128×160，显示 64×80）。
   * 两张都是「栅格化的排版」：邮件客户端只有系统字体，Dela Gothic One 这种显示字体只能预渲染。
   * 参数就在路径里，所以同样不查库；渲染键（磁盘缓存与 inflight 去重的 name）由 title.ts 拼上
   * 模板版本与全部参数，换了参数就是换了文件，不会命中旧图。
   */
  app.get("/og/email/title/:file", async (req, reply) => {
    const id = parseTitleFile((req.params as { file: string }).file);
    if (!id) return notFound(reply);
    const limited = overLimit(req, reply, "og:title");
    if (limited) return limited;
    const { png, etag } = await renderTitle(id);
    const tag = `"title-${etag}"`;
    reply.header("ETag", tag).header("Cache-Control", EMAIL_IMAGE_CACHE);
    if (notModified(req, tag)) return reply.code(304).send();
    return reply.type("image/png").send(png);
  });

  app.get("/og/email/date/:file", async (req, reply) => {
    const date = parseDateFile((req.params as { file: string }).file);
    if (!date) return notFound(reply);
    const limited = overLimit(req, reply, "og:date");
    if (limited) return limited;
    const { png, etag } = await renderDate(date.month, date.day);
    const tag = `"date-${etag}"`;
    reply.header("ETag", tag).header("Cache-Control", EMAIL_IMAGE_CACHE);
    if (notModified(req, tag)) return reply.code(304).send();
    return reply.type("image/png").send(png);
  });

  app.get("/og/items/:file", async (req, reply) => {    const file = (req.params as { file: string }).file;
    if (!file.endsWith(".png")) return notFound(reply);
    const d = await loadItemShare(file.slice(0, -4));
    if (!d) return notFound(reply);
    reply.header("X-Accel-Expires", CONTENT_IMAGE_ORIGIN_SECONDS);
    return send(req, reply, {
      kicker: d.category ? CATEGORY_LABELS[d.category] : withSubject("动态"),
      title: d.title,
      subtitle: d.summary,
      meta: `${d.source.name} · ${beijingDate(d.timelineAt)}`,
      badge: d.selected && d.score !== null ? { value: String(Math.round(d.score)), label: "精选评分" } : null,
    }, 3600, CONTENT_IMAGE_CACHE);
  });

  // Phone share poster for an article (1080×1440), generated on first request and cached by content.
  app.get("/og/posters/:file", async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!file.endsWith(".png")) return notFound(reply);
    const d = await loadItemShare(file.slice(0, -4));
    if (!d) return notFound(reply);
    const poster: Poster = {
      url: `${config.siteUrl}/items/${d.id}`,
      kicker: d.category ? CATEGORY_LABELS[d.category] : withSubject("动态"),
      title: d.title,
      summary: d.summary,
      source: d.source.name,
      date: beijingDate(d.timelineAt),
      score: d.selected ? d.score : null,
    };
    const tag = `"poster-${posterEtag(poster)}"`;
    reply.header("ETag", tag).header("Cache-Control", CONTENT_IMAGE_CACHE).header("X-Accel-Expires", CONTENT_IMAGE_ORIGIN_SECONDS);
    if (String(req.headers["if-none-match"] ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === tag)) return reply.code(304).send();
    return reply.type("image/png").send((await renderPoster(poster)).png);
  });

  app.get("/og/reports/:kind/:file", async (req, reply) => {
    const { kind, file } = req.params as { kind: string; file: string };
    if (!["daily", "weekly", "monthly"].includes(kind) || !file.endsWith(".png")) return notFound(reply);
    const r = await loadReport(kind as ReportKind, file.slice(0, -4));
    if (!r) return notFound(reply);
    return send(req, reply, {
      kicker: `${REPORT_NAMES[r.kind]} · ${r.key}`,
      title: r.lead?.title ?? r.title,
      subtitle: r.lead?.leadParagraph ?? r.overview,
      meta: `${r.sections.reduce((n, s) => n + s.items.length, 0)} 条核心新闻 · 约 ${r.readingMinutes} 分钟读完`,
    }, 86400);
  });

  app.get("/og/topics/:file", async (req, reply) => {
    const file = (req.params as { file: string }).file;
    const t = file.endsWith(".png") ? findTopic(file.slice(0, -4)) : null;
    if (!t) return notFound(reply);
    return send(req, reply, { kicker: `主题 · ${TOPIC_GROUPS.find((g) => g.key === t.group)?.name ?? ""}`, title: `${t.name} 最新动态`, subtitle: t.definition }, 86400);
  });

  app.get("/og/stories/:file", async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!file.endsWith(".png")) return notFound(reply);
    const found = await resolveStory(file.slice(0, -4));
    if (found.kind !== "found") return notFound(reply);
    const s = await loadStoryDetail(found.storyId);
    if (!s) return notFound(reply);
    reply.header("X-Accel-Expires", CONTENT_IMAGE_ORIGIN_SECONDS);
    return send(req, reply, {
      kicker: s.whyHot.rank ? `热点第 ${s.whyHot.rank} · 事件` : "事件",
      title: s.title,
      subtitle: s.latest ?? s.digest,
      meta: `${s.sourceCount} 个来源 · ${s.reportCount} 篇报道`,
      accent: s.whyHot.rank ? "hot" : "teal",
    }, 3600, CONTENT_IMAGE_CACHE);
  });
}
