// 传单（flyer）——跟网站白纸主题同一套「淡粉墙 + 白卡 + 黄胶带 + 应援色」，每条情报一张卡，带公告自己的配图。
//
// 和「封面」的分工不同：封面把炸裂全交给三张图，正文只留一句摘要；这一版让正文自己也够读——
//   1. 通栏宣传头图（API 现画：网站 logo + ISSUE + 首页口号，见 ../promo.ts），图被屏蔽时铺淡粉。
//   2. 大标题牌 + 一句说明（「过去 24 小时 N 条」）。
//   3. 每条情报一张纸卡：左边一道应援色粗边；黄胶带色的分类签 + 乐队名；22px 标题；
//      公告自己的配图（有才放，整宽）；摘要放到 200 字；时刻 · 来源；一个黑底「读全文」按钮。
//   4. 截止提醒：每天一条黑底日期栏（日期牌 + 「今天 / 还有 N 天」），下面是当天的纸卡。
// 手机上：外层表格 width:100% + max-width:600px，窄屏不缩放，图片 width:100% 跟着收。
// 所有尺寸从 ../layout.ts 的标尺取；没有的数据一个字都不编。
import { dateHandle, titleHandle, type TitleKind } from "../title.ts";
import { type HeroHandle } from "../hero.ts";
import { GAP, inkOn, LEADING, MAX_WIDTH, PAD_X, PAD_Y, TYPE, WEIGHT } from "../layout.ts";
import { escapeHtml, type ConfirmData, type DeadlineData, type DeadlineEntry, type DigestData, type DigestItem, type EmailData, type EmailStyle, type EmailSite, type RenderedEmail } from "../types.ts";

const SANS = "-apple-system,'Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP','Noto Sans SC','Segoe UI',sans-serif";

/**
 * 网站白纸主题的配色：淡粉墙、更淡的粉纸、白卡、墨色、胶带黄、品牌粉。只在这一套里用。
 * 站主 2026-10-08：不要米色，用淡粉。
 */
const WALL = "#ffe4ee";
const PAPER = "#fff6f9";
const CARD = "#ffffff";
const PAPER_INK = "#141216";
const NIGHT = "#141216";
const TAPE = "#ffe600";
const PINK = "#e6005f";
const MUTED = "#6b6570";

/** 摘要放到 200 个字：这一版要「邮件里就能读完」。 */
const CLIP = 200;
/** 纸卡里的正文宽度：600 - 两边页面留白 - 两边卡内留白 - 左粗边。 */
const CARD_IMAGE_WIDTH = MAX_WIDTH - PAD_X * 2 - 16 * 2 - 6;

const HEX = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;

function clean(v: string | null | undefined): string {
  return (v ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "").trim();
}
function color(v: string | null | undefined, fallback: string): string {
  const c = clean(v);
  return HEX.test(c) ? c : fallback;
}
function safeSite(site: EmailSite): EmailSite {
  return {
    ...site,
    accent: color(site.accent, "#8a5c07"),
    accentBright: color(site.accentBright, "#e8b53c"),
    hot: color(site.hot, "#c8342a"),
    ink: color(site.ink, "#202126"),
    inkSoft: color(site.inkSoft, "#73747c"),
    inkBody: color(site.inkBody, "#555760"),
    surface: color(site.surface, "#ffffff"),
    bg: color(site.bg, "#f7f6f2"),
    line: color(site.line, "#d8d6d1"),
    lineSoft: color(site.lineSoft, "#eceae5"),
  };
}
const text = (v: string | null | undefined) => escapeHtml(clean(v));
const plain = (v: string | null | undefined) => clean(v).replace(/[<>]/g, "");
function href(raw: string | null | undefined, fallback: string): string {
  const value = clean(raw);
  return escapeHtml(/^https?:\/\//i.test(value) ? value : fallback);
}
function hrefPlain(raw: string | null | undefined, fallback: string): string {
  const value = clean(raw);
  return /^https?:\/\//i.test(value) ? value : fallback;
}
function link(url: string | null | undefined, label: string, c: string, fallback: string, size: number = TYPE.body): string {
  return `<a href="${href(url, fallback)}" style="font-size:${size}px;color:${c};text-decoration:none;word-break:break-word">${text(label)}</a>`;
}
function clip(v: string | null | undefined, n: number): string {
  const chars = [...clean(v)];
  return chars.length <= n ? chars.join("") : `${chars.slice(0, n).join("")}…`;
}
function page(site: EmailSite, path: string): string {
  return `${clean(site.url).replace(/\/+$/, "")}${path}`;
}

function heroRow(site: EmailSite, hero: HeroHandle | null | undefined, accent: string): string {
  const bg = color(hero?.bg, accent);
  const src = clean(hero?.src);
  const alt = clean(hero?.alt) || clean(hero?.caption) || clean(site.name);
  if (hero && /^https?:\/\//i.test(src)) {
    return `
  <tr><td bgcolor="${bg}" style="background:${bg};padding:0">
    <img src="${href(src, site.url)}" alt="${text(alt)}" width="${hero.width}" height="${hero.height}" style="display:block;width:100%;max-width:${MAX_WIDTH}px;height:auto;border:0">
  </td></tr>`;
  }
  return `
  <tr><td bgcolor="${bg}" style="background:${bg};padding:${GAP.major}px ${PAD_X}px;font-size:${TYPE.subhead}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${inkOn(bg, PAPER_INK, CARD)}">${text(alt)}</td></tr>`;
}

/** 大标题牌 + 一句说明，铺在纸色底上。 */
function titleBlock(kind: TitleKind, site: EmailSite, note: string): string {
  const t = titleHandle(kind, site.url);
  return `
  <tr><td bgcolor="${CARD}" style="background:${CARD};border-bottom:4px solid ${PINK};padding:${GAP.major}px ${PAD_X}px ${PAD_Y.card}px">
    <img src="${href(t.src, site.url)}" alt="${text(t.alt)}" width="${t.width}" height="${t.height}" style="display:block;width:100%;max-width:${t.width}px;height:auto;border:0">
    <p style="margin:${PAD_Y.block}px 0 0;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${PAPER_INK}">${note}</p>
  </td></tr>`;
}

/** 胶带色小签：分类 / 状态。 */
function tag(label: string, bg = TAPE, fg = PAPER_INK): string {
  return `<span style="display:inline-block;background:${bg};color:${fg};padding:2px 16px;font-size:${TYPE.small}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold}">${text(label)}</span>`;
}

/** 黑底按钮，底下一道胶带黄的硬边。 */
function button(url: string, label: string, site: EmailSite): string {
  return `<a href="${href(url, site.url)}" style="display:inline-block;background:${PAPER_INK};border-bottom:4px solid ${TAPE};color:${CARD};padding:${GAP.group}px 16px;font-size:${TYPE.body}px;line-height:${LEADING.tight};font-weight:${WEIGHT.bold};text-decoration:none">${text(label)}</a>`;
}

/** 一张纸卡：左边应援色粗边。 */
function card(accent: string, inner: string, last: boolean): string {
  return `
  <tr><td bgcolor="${PAPER}" style="background:${PAPER};padding:0 ${PAD_X}px ${last ? GAP.major : PAD_Y.card}px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${CARD};border:2px solid ${PAPER_INK};border-left:6px solid ${accent}">
      <tr><td style="padding:${PAD_Y.card}px 16px">${inner}</td></tr>
    </table>
  </td></tr>`;
}

function imageBlock(image: DigestItem["image"], alt: string, site: EmailSite): string {
  const src = clean(image?.src);
  if (!image || !/^https?:\/\//i.test(src)) return "";
  const width = CARD_IMAGE_WIDTH;
  const height = Math.max(1, Math.round((width * image.height) / Math.max(1, image.width)));
  return `<img src="${href(src, site.url)}" alt="${text(alt)}" width="${width}" height="${height}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;margin:${GAP.group}px 0 0">`;
}

function digestCard(item: DigestItem, site: EmailSite, last: boolean): string {
  const accent = color(item.accents[0], PINK);
  const bandName = item.bands.length ? item.bands.join("、") : "";
  const head = [
    clean(item.category) ? tag(item.category) : "",
    bandName ? `<span style="font-size:${TYPE.small}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${PAPER_INK}">&nbsp; ◆ ${text(bandName)}</span>` : "",
    item.official ? `<span style="font-size:${TYPE.small}px;line-height:${LEADING.normal};color:${MUTED}">&nbsp; 官方</span>` : "",
  ].join("");
  const meta = [clean(item.time), clean(item.source)].filter(Boolean).map(text).join(" · ");
  return card(
    accent,
    `
      ${head ? `<div style="line-height:${LEADING.normal}">${head}</div>` : ""}
      <h2 style="margin:${GAP.group}px 0 0;font-size:${TYPE.heading}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};word-break:break-word">${link(item.url, item.title, PAPER_INK, site.url, TYPE.heading)}</h2>
      ${imageBlock(item.image, item.title, site)}
      ${clean(item.summary) ? `<p style="margin:${GAP.group}px 0 0;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:#3d3842">${text(clip(item.summary, CLIP))}</p>` : ""}
      ${meta ? `<div style="margin-top:${GAP.group}px;font-size:${TYPE.small}px;line-height:${LEADING.normal};color:${MUTED}">${meta}</div>` : ""}
      <div style="margin-top:${PAD_Y.block}px">${button(item.url, "读全文 →", site)}</div>`,
    last,
  );
}

/** 距今几天：日期栏右边那句。 */
function countdown(date: string, today: string): string {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  const n = Math.round((a - b) / 86400_000);
  return n <= 0 ? "今天" : n === 1 ? "明天" : `还有 ${n} 天`;
}

function deadlineCard(item: DeadlineEntry, site: EmailSite, last: boolean): string {
  const accent = color(item.accent, PINK);
  const when = item.time ? `${text(item.time)}${item.zone ? ` ${text(item.zone)}` : ""}` : "全天";
  const head = [
    tag(item.label, item.soon ? PINK : TAPE, item.soon ? CARD : PAPER_INK),
    clean(item.band) ? `<span style="font-size:${TYPE.small}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${PAPER_INK}">&nbsp; ◆ ${text(item.band)}</span>` : "",
    item.soon ? `<span style="font-size:${TYPE.small}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${site.hot}">&nbsp; 48 小时内</span>` : "",
  ].join("");
  const source = [clean(item.note), clean(item.source)].filter(Boolean).map(text).join(" · ");
  return card(
    accent,
    `
      <div style="line-height:${LEADING.normal}">${head}</div>
      <div style="margin-top:${GAP.group}px;font-size:${TYPE.title}px;line-height:${LEADING.tight};font-weight:${WEIGHT.bold};color:${PAPER_INK}">${when}</div>
      <h2 style="margin:${GAP.block}px 0 0;font-size:${TYPE.subhead}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};word-break:break-word">${link(item.url, item.title, PAPER_INK, site.url, TYPE.subhead)}</h2>
      ${source ? `<div style="margin-top:${GAP.block}px;font-size:${TYPE.small}px;line-height:${LEADING.normal};color:${MUTED}">${source}</div>` : ""}
      <div style="margin-top:${PAD_Y.block}px">${button(item.url, "查看详情 →", site)}</div>`,
    last,
  );
}

function dayBar(date: string, label: string, weekday: string, today: string, site: EmailSite): string {
  const d = dateHandle(date, site.url);
  const plate = d ? `<img src="${href(d.src, site.url)}" alt="${text(d.alt)}" width="${d.width}" height="${d.height}" style="display:block;width:${d.width}px;height:${d.height}px">` : "";
  return `
  <tr><td bgcolor="${PAPER}" style="background:${PAPER};padding:${PAD_Y.block}px ${PAD_X}px ${GAP.group}px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${NIGHT}">
      <tr>
        <td width="80" valign="middle" style="width:80px;padding:${GAP.block}px 0 ${GAP.block}px ${GAP.block}px">${plate}</td>
        <td valign="middle" style="padding:0 16px">
          <div style="font-size:${TYPE.heading}px;line-height:${LEADING.tight};font-weight:${WEIGHT.bold};color:${CARD}">${text(label)} ${text(weekday)}</div>
          <div style="margin-top:${GAP.tight}px;font-size:${TYPE.body}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${TAPE}">${text(countdown(date, today))}</div>
        </td>
      </tr>
    </table>
  </td></tr>`;
}

function footer(data: EmailData, site: EmailSite): string {
  const note = clean(site.footerNote) ? `※ ${text(site.footerNote)}。` : "※ 本邮件由系统自动发送。";
  const manage =
    data.kind === "confirm"
      ? "仅确认后开始发送"
      : `${link(data.preferencesUrl, "订阅设置", MUTED, site.url, TYPE.small)} &nbsp; / &nbsp; ${link(data.unsubscribeUrl, "退订", MUTED, site.url, TYPE.small)}`;
  return `
  <tr><td bgcolor="${WALL}" style="background:${WALL};padding:${PAD_Y.section}px">
    <div style="font-size:${TYPE.body}px;line-height:${LEADING.loose};font-weight:${WEIGHT.bold};color:${PAPER_INK}">${text(site.name)}</div>
    <p style="margin:${GAP.block}px 0 ${PAD_Y.block}px;font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${MUTED}">${note}</p>
    <div style="font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${MUTED}">${manage}</div>
  </td></tr>`;
}

/** 整封信：外层 100% 宽，内层 600 封顶——手机上是流式的，不会被整体缩小。 */
function document(site: EmailSite, subject: string, _preheader: string, inner: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text(subject)}</title></head>
<body style="margin:0;padding:0;background:${WALL}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${WALL};font-family:${SANS}">
<tr><td align="center" style="padding:0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${MAX_WIDTH}px;background:${PAPER};font-family:${SANS}">
${inner}
</table>
</td></tr>
</table>
</body></html>`;
}

function bodyAccent(data: EmailData, site: EmailSite): string {
  if (data.kind === "deadline") for (const day of data.days) for (const item of day.items) if (item.accent) return color(item.accent, site.accentBright);
  if (data.kind === "digest") for (const item of data.items) for (const a of item.accents) if (a) return color(a, site.accentBright);
  return site.accentBright;
}

/** 今天（北京时间）：截止栏「还有 N 天」用。 */
function todayBeijing(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

function confirm(data: ConfirmData): RenderedEmail {
  const site = safeSite(data.site);
  const bands = data.bands.length ? data.bands.map(text).join("、") : "全部乐队与企划";
  const bandsPlain = data.bands.length ? data.bands.map(plain).join("、") : "全部乐队与企划";
  const wants = [data.wantsDeadlines ? "截止提醒" : "", data.wantsDigest ? "每日精选" : ""].filter(Boolean);
  const subject = `【${clean(site.name)}】还差一步，订阅就完成了`;
  const preheader = "点一下「确认订阅」，我们才开始发；不点，一条都不会发。";
  const inner = `${heroRow(site, data.hero, bodyAccent(data, site))}
${titleBlock("confirm", site, "点一下，订阅就完成了。确认后，我们会把你关注的事件节点和精选动态送到邮箱。")}
${card(
  PINK,
  `
      <div style="font-size:${TYPE.small}px;line-height:${LEADING.normal};color:${MUTED}">你关注的乐队</div>
      <p style="margin:${GAP.block}px 0 0;font-size:${TYPE.subhead}px;line-height:${LEADING.loose};font-weight:${WEIGHT.bold};color:${PAPER_INK}">${bands}</p>
      <div style="margin-top:${GAP.group}px;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${PAPER_INK}">${wants.length ? wants.map((w) => `✓ ${w}`).join(" &nbsp;&nbsp; ") : "先不发送任何内容，你随时可以在订阅设置里打开。"}</div>
      <div style="margin-top:${PAD_Y.card}px">${button(data.confirmUrl, "确认订阅 →", site)}</div>
      <p style="margin:${GAP.group}px 0 0;font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${MUTED}">确认链接 48 小时内有效。如果不是你提交的订阅申请，忽略这封邮件即可。</p>`,
  true,
)}
${footer(data, site)}`;
  const body = [
    `${site.name} — 确认订阅`,
    "",
    "点一下，订阅就完成了。",
    `确认订阅：${hrefPlain(data.confirmUrl, site.url)}`,
    "（确认链接 48 小时内有效。）",
    "",
    `你关注的乐队：${bandsPlain}`,
    `发送内容：${wants.length ? wants.join(" / ") : "先不发送任何内容"}`,
    "",
    "如果不是你提交的订阅申请，忽略这封邮件即可。未经确认不会开始发送。",
    "",
    `※ ${plain(site.footerNote)}。`,
    `${plain(site.name)} · ${hrefPlain(site.url, site.url)}`,
  ].join("\n");
  return { subject, preheader, html: document(site, subject, preheader, inner), text: body };
}

function deadline(data: DeadlineData): RenderedEmail {
  const site = safeSite(data.site);
  const items = data.days.flatMap((d) => d.items);
  const soon = items.filter((i) => i.soon);
  const subject = `【${clean(site.name)}】${soon.length > 0 ? `${soon.length} 件在 48 小时内到期` : items.length > 0 ? `${items.length} 件即将到期` : "接下来没有要到期的事"}`;
  const preheader = soon.length ? `最近的是 ${plain(data.days[0]?.label)}，48 小时内就得动手。` : "接下来这几天的安排，先记进日历，临近了我们再提醒你。";
  const today = todayBeijing();
  const note = `本期 ${items.length} 件${soon.length ? `，<strong style="color:${site.hot}">${soon.length} 件在 48 小时内到期</strong>` : ""}。所有日期与时刻均为公告当地时间。`;
  const days = data.days.slice(0, 6);
  const blocks = days.length
    ? days
        .map((day, di) => {
          const list = day.items.slice(0, 6);
          return `${dayBar(day.date, day.label, day.weekday, today, site)}${list.map((item, i) => deadlineCard(item, site, di === days.length - 1 && i === list.length - 1)).join("")}`;
        })
        .join("")
    : `
  <tr><td bgcolor="${PAPER}" style="background:${PAPER};padding:${PAD_Y.section}px ${PAD_X}px ${GAP.major}px;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${PAPER_INK}">接下来没有要过期的日子。有新的，我们再提醒你。</td></tr>`;
  const schedule = page(site, "/deadlines");
  const inner = `${heroRow(site, data.hero, bodyAccent(data, site))}
${titleBlock("deadline", site, note)}
${blocks}
  <tr><td bgcolor="${PAPER}" style="background:${PAPER};padding:0 ${PAD_X}px ${GAP.major}px">${button(schedule, "查看完整截止雷达 ↗", site)}</td></tr>
${footer(data, site)}`;
  const body = [
    `${site.name} — 截止提醒`,
    "",
    `本期 ${items.length} 件${soon.length ? `，其中 ${soon.length} 件在 48 小时内到期` : ""}。所有日期与时刻均为公告当地时间。`,
    "",
    ...data.days.map((day) =>
      [
        `【${plain(day.label)} ${plain(day.weekday)}】`,
        ...day.items.map((item) =>
          [`  ${[item.time, item.zone, item.label].filter(Boolean).map(plain).join("　")}${item.soon ? "（48 小时内）" : ""}`, `  ${plain(item.title)}`, `  ${[item.band, item.source].filter(Boolean).map(plain).join(" · ")}`, `  ${hrefPlain(item.url, site.url)}`].join("\n"),
        ),
        "",
      ].join("\n"),
    ),
    `完整截止雷达：${hrefPlain(schedule, site.url)}`,
    "",
    `※ ${plain(site.footerNote)}。`,
    `${plain(site.name)} · ${hrefPlain(site.url, site.url)}`,
    `订阅设置：${hrefPlain(data.preferencesUrl, site.url)}　退订：${hrefPlain(data.unsubscribeUrl, site.url)}`,
  ].join("\n");
  return { subject, preheader, html: document(site, subject, preheader, inner), text: body };
}

function digest(data: DigestData): RenderedEmail {
  const site = safeSite(data.site);
  const subject = `【${clean(site.name)}】${clean(data.heading) || `本期 ${data.items.length} 条`}`;
  const preheader = data.items[0] ? `头条：${plain(clip(data.items[0].title, 40))}` : "这一期还没有新的精选。";
  const list = data.items.slice(0, 10);
  const note = `${text(clean(data.lead)) || `过去 24 小时里值得一看的 ${data.items.length} 条。`}`;
  const cards = list.length
    ? list.map((item, i) => digestCard(item, site, i === list.length - 1)).join("")
    : `
  <tr><td bgcolor="${PAPER}" style="background:${PAPER};padding:${PAD_Y.section}px ${PAD_X}px ${GAP.major}px;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${PAPER_INK}">这一期还没有新的精选。有值得看的，我们再发给你。</td></tr>`;
  const inner = `${heroRow(site, data.hero, bodyAccent(data, site))}
${titleBlock("digest", site, note)}
${cards}
  <tr><td bgcolor="${PAPER}" style="background:${PAPER};padding:0 ${PAD_X}px ${GAP.major}px">${button(site.url, "去网站看全部精选 ↗", site)}</td></tr>
${footer(data, site)}`;
  const body = [
    `${site.name} — ${plain(data.heading) || "每日精选"}`,
    "",
    plain(data.lead),
    "",
    ...list.map((item, i) =>
      [`${String(i + 1).padStart(2, "0")}　${plain(item.title)}`, `　${plain(clip(item.summary, CLIP))}`, `　${[item.bands.join("、"), item.time, item.category, item.source].filter(Boolean).map(plain).join(" · ")}`, `　${hrefPlain(item.url, site.url)}`, ""].join("\n"),
    ),
    `看全部精选：${hrefPlain(site.url, site.url)}`,
    "",
    `※ ${plain(site.footerNote)}。`,
    `${plain(site.name)} · ${hrefPlain(site.url, site.url)}`,
    `订阅设置：${hrefPlain(data.preferencesUrl, site.url)}　退订：${hrefPlain(data.unsubscribeUrl, site.url)}`,
  ].join("\n");
  return { subject, preheader, html: document(site, subject, preheader, inner), text: body };
}

const style: EmailStyle = {
  id: "flyer",
  name: "传单",
  description: "跟网站同一套黑墙米白纸：每条一张纸卡，带配图、长摘要和按钮，邮件里就能读完。",
  render(data: EmailData): RenderedEmail {
    if (data.kind === "confirm") return confirm(data);
    if (data.kind === "deadline") return deadline(data);
    return digest(data);
  },
};

export default style;
