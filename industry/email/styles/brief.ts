// 简报（brief）——白底、紧凑，一封里放得下 12 条：先一段「本期速览」，再逐条展开，每条左边一张小方图。
//
// 和「传单」的分工：传单一条一张大纸卡，适合三五条的日子；简报适合条目多的日子，手机上一屏能看三四条。
//   1. 报头：通栏头图 + 大标题牌 + 一句说明。
//   2. 本期速览：编号 + 乐队 + 标题，一行一条，先让读者知道这封里有什么。
//   3. 逐条：左边 96×96 的公告配图（没有就整行给文字），右边 乐队 · 分类（应援色字）、18px 标题、
//      120 字摘要、时刻 · 来源、「读全文 →」。条与条之间一条细线。
//   4. 截止提醒：日期牌一列 + 当天条目，每条只有一行粗体时刻 + 标题 + 来源。
// 所有尺寸从 ../layout.ts 的标尺取。
import { dateHandle, DATE_SIZE, titleHandle, type TitleKind } from "../title.ts";
import { type HeroHandle } from "../hero.ts";
import { GAP, inkOn, LEADING, MAX_WIDTH, PAD_X, PAD_Y, readableOn, TYPE, WEIGHT } from "../layout.ts";
import { escapeHtml, type ConfirmData, type DeadlineData, type DigestData, type DigestItem, type EmailData, type EmailStyle, type EmailSite, type RenderedEmail } from "../types.ts";

const SANS = "-apple-system,'Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP','Noto Sans SC','Segoe UI',sans-serif";
const CLIP = 120;
/** 小方图边长与它那一栏的宽度（图 + 右边 16 的空）。 */
const THUMB = 96;
const THUMB_COL = 112;

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
  <tr><td bgcolor="${bg}" style="background:${bg};padding:${GAP.major}px ${PAD_X}px;font-size:${TYPE.subhead}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${inkOn(bg, site.ink, site.surface)}">${text(alt)}</td></tr>`;
}

function titleBlock(kind: TitleKind, site: EmailSite, note: string): string {
  const t = titleHandle(kind, site.url);
  return `
  <tr><td style="padding:${PAD_Y.section}px ${PAD_X}px 0">
    <img src="${href(t.src, site.url)}" alt="${text(t.alt)}" width="${t.width}" height="${t.height}" style="display:block;width:100%;max-width:${t.width}px;height:auto;border:0">
    <p style="margin:${GAP.group}px 0 0;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${site.inkBody}">${note}</p>
  </td></tr>`;
}

/** 应援色当字色，但对比度不够时退回墨色。 */
const accentText = (accent: string | undefined, site: EmailSite) => readableOn(color(accent, site.ink), site.surface, site.ink, 4.5);

/** 本期速览：编号 + 乐队 + 标题。 */
function index(items: DigestItem[], site: EmailSite): string {
  const rows = items
    .map((item, i) => {
      const who = item.bands[0] ? `<span style="font-weight:${WEIGHT.bold};color:${accentText(item.accents[0], site)}">${text(item.bands[0])}</span>&nbsp; ` : "";
      return `<tr>
        <td width="32" valign="top" style="width:32px;padding:${GAP.tight}px 0;font-size:${TYPE.body}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${site.inkSoft}">${String(i + 1).padStart(2, "0")}</td>
        <td valign="top" style="padding:${GAP.tight}px 0;font-size:${TYPE.body}px;line-height:${LEADING.normal};color:${site.ink}">${who}${link(item.url, clip(item.title, 40), site.ink, site.url, TYPE.body)}</td>
      </tr>`;
    })
    .join("");
  return `
  <tr><td style="padding:${PAD_Y.section}px ${PAD_X}px 0">
    <div style="border-top:3px solid ${site.ink};padding-top:${GAP.group}px;font-size:${TYPE.subhead}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${site.ink}">本期速览</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:${GAP.block}px">${rows}</table>
  </td></tr>`;
}

function thumb(item: DigestItem, site: EmailSite): string {
  const src = clean(item.image?.src);
  if (!item.image || !/^https?:\/\//i.test(src)) return "";
  return `<a href="${href(item.url, site.url)}" style="text-decoration:none"><img src="${href(src, site.url)}" alt="${text(item.title)}" width="${THUMB}" height="${THUMB}" style="display:block;width:${THUMB}px;height:${THUMB}px;object-fit:cover;border:0;border-radius:4px"></a>`;
}

function entry(item: DigestItem, site: EmailSite, i: number): string {
  const head = [item.bands.join("、"), clean(item.category), item.official ? "官方" : ""].filter(Boolean).map(text).join(" · ");
  const meta = [clean(item.time), clean(item.source)].filter(Boolean).map(text).join(" · ");
  const words = `
          ${head ? `<div style="font-size:${TYPE.small}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${accentText(item.accents[0], site)}">${head}</div>` : ""}
          <h2 style="margin:${GAP.tight}px 0 0;font-size:${TYPE.subhead}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};word-break:break-word">${link(item.url, item.title, site.ink, site.url, TYPE.subhead)}</h2>
          ${clean(item.summary) ? `<p style="margin:${GAP.block}px 0 0;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${site.inkBody}">${text(clip(item.summary, CLIP))}</p>` : ""}
          <div style="margin-top:${GAP.block}px;font-size:${TYPE.small}px;line-height:${LEADING.normal};color:${site.inkSoft}">${meta ? `${meta} · ` : ""}${link(item.url, "读全文 →", site.ink, site.url, TYPE.small)}</div>`;
  const pic = thumb(item, site);
  const row = pic
    ? `<tr>
        <td width="${THUMB_COL}" valign="top" style="width:${THUMB_COL}px;padding:${GAP.tight}px 0 0">${pic}</td>
        <td valign="top" style="padding:0">${words}</td>
      </tr>`
    : `<tr><td valign="top" style="padding:0">${words}</td></tr>`;
  return `
  <tr><td style="padding:${i === 0 ? PAD_Y.card : 0}px ${PAD_X}px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid ${i === 0 ? site.ink : site.lineSoft};padding-top:${PAD_Y.card}px;margin-bottom:${PAD_Y.card}px">${row}</table>
  </td></tr>`;
}

function footer(data: EmailData, site: EmailSite): string {
  const note = clean(site.footerNote) ? `※ ${text(site.footerNote)}。` : "※ 本邮件由系统自动发送。";
  const manage =
    data.kind === "confirm"
      ? "仅确认后开始发送"
      : `${link(data.preferencesUrl, "订阅设置", site.inkSoft, site.url, TYPE.small)} &nbsp; / &nbsp; ${link(data.unsubscribeUrl, "退订", site.inkSoft, site.url, TYPE.small)}`;
  return `
  <tr><td bgcolor="${site.bg}" style="background:${site.bg};padding:${PAD_Y.section}px">
    <div style="font-size:${TYPE.body}px;line-height:${LEADING.loose};font-weight:${WEIGHT.bold};color:${site.ink}">${text(site.name)}</div>
    <p style="margin:${GAP.block}px 0 ${PAD_Y.block}px;font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">${note}</p>
    <div style="font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">${manage}</div>
  </td></tr>`;
}

function document(site: EmailSite, subject: string, _preheader: string, inner: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text(subject)}</title></head>
<body style="margin:0;padding:0;background:${site.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${site.bg};font-family:${SANS}">
<tr><td align="center" style="padding:0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${MAX_WIDTH}px;background:${site.surface};font-family:${SANS}">
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

function button(url: string, label: string, site: EmailSite): string {
  return `<a href="${href(url, site.url)}" style="display:block;background:${site.ink};color:${site.surface};padding:${PAD_Y.block}px 0;font-size:${TYPE.subhead}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};text-decoration:none;text-align:center">${text(label)}</a>`;
}

function confirm(data: ConfirmData): RenderedEmail {
  const site = safeSite(data.site);
  const bands = data.bands.length ? data.bands.map(text).join("、") : "全部乐队与企划";
  const wants = [data.wantsDeadlines ? "截止提醒" : "", data.wantsDigest ? "每日精选" : ""].filter(Boolean);
  const subject = `【${clean(site.name)}】还差一步，订阅就完成了`;
  const preheader = "点一下「确认订阅」，我们才开始发；不点，一条都不会发。";
  const inner = `${heroRow(site, data.hero, bodyAccent(data, site))}
${titleBlock("confirm", site, "点一下，订阅就完成了。确认后，我们会把你关注的事件节点和精选动态送到邮箱。")}
  <tr><td style="padding:${PAD_Y.section}px ${PAD_X}px ${GAP.major}px">
    ${button(data.confirmUrl, "确认订阅 →", site)}
    <p style="margin:${GAP.group}px 0 0;font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">确认链接 48 小时内有效。</p>
    <div style="margin-top:${PAD_Y.section}px;border-top:1px solid ${site.line};padding-top:${PAD_Y.block}px;font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">你关注的乐队</div>
    <p style="margin:${GAP.tight}px 0 0;font-size:${TYPE.subhead}px;line-height:${LEADING.loose};font-weight:${WEIGHT.bold};color:${site.ink}">${bands}</p>
    <div style="margin-top:${GAP.block}px;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${site.ink}">${wants.length ? wants.map((w) => `✓ ${w}`).join(" &nbsp;&nbsp; ") : "先不发送任何内容。"}</div>
    <p style="margin:${PAD_Y.block}px 0 0;font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">如果不是你提交的订阅申请，忽略这封邮件即可。未经确认不会开始发送。</p>
  </td></tr>
${footer(data, site)}`;
  const body = [
    `${site.name} — 确认订阅`,
    "",
    "点一下，订阅就完成了。",
    `确认订阅：${hrefPlain(data.confirmUrl, site.url)}`,
    "（确认链接 48 小时内有效。）",
    "",
    `你关注的乐队：${data.bands.length ? data.bands.map(plain).join("、") : "全部乐队与企划"}`,
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
  const note = `本期 ${items.length} 件${soon.length ? `，<strong style="color:${site.hot}">${soon.length} 件在 48 小时内到期</strong>` : ""}。时刻均为公告当地时间。`;
  const days = data.days.slice(0, 7)
    .map((day) => {
      const d = dateHandle(day.date, site.url);
      const plate = d ? `<img src="${href(d.src, site.url)}" alt="${text(d.alt)}" width="${d.width}" height="${d.height}" style="display:block;width:${d.width}px;height:${d.height}px">` : "";
      const list = day.items
        .slice(0, 8)
        .map((item, i) => {
          const when = item.time ? `${text(item.time)}${item.zone ? ` ${text(item.zone)}` : ""}` : "全天";
          const who = [clean(item.band), clean(item.source)].filter(Boolean).map(text).join(" · ");
          return `<div${i === 0 ? "" : ` style="border-top:1px solid ${site.lineSoft};margin-top:${GAP.group}px;padding-top:${GAP.group}px"`}>
            <div style="font-size:${TYPE.body}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${item.soon ? site.hot : site.ink}">${when} · ${text(item.label)}${item.soon ? " · 48 小时内" : ""}</div>
            <div style="margin-top:${GAP.tight}px;font-size:${TYPE.body}px;line-height:${LEADING.normal}">${link(item.url, item.title, site.ink, site.url, TYPE.body)}</div>
            ${who ? `<div style="margin-top:${GAP.tight}px;font-size:${TYPE.small}px;line-height:${LEADING.normal};color:${accentText(item.accent ?? undefined, site)}">${who}</div>` : ""}
          </div>`;
        })
        .join("");
      return `
  <tr><td style="padding:0 ${PAD_X}px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid ${site.line}">
      <tr>
        <td width="${DATE_SIZE.width + 16}" valign="top" style="width:${DATE_SIZE.width + 16}px;padding:${PAD_Y.block}px 0">${plate}</td>
        <td valign="top" style="padding:${PAD_Y.block}px 0">${list}</td>
      </tr>
    </table>
  </td></tr>`;
    })
    .join("");
  const schedule = page(site, "/deadlines");
  const inner = `${heroRow(site, data.hero, bodyAccent(data, site))}
${titleBlock("deadline", site, note)}
  <tr><td style="padding:${PAD_Y.section}px 0 0"></td></tr>
${days || `<tr><td style="padding:0 ${PAD_X}px;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${site.inkSoft}">接下来没有要过期的日子。</td></tr>`}
  <tr><td style="padding:${PAD_Y.card}px ${PAD_X}px ${GAP.major}px">${button(schedule, "查看完整截止雷达 ↗", site)}</td></tr>
${footer(data, site)}`;
  const body = [
    `${site.name} — 截止提醒`,
    "",
    `本期 ${items.length} 件${soon.length ? `，其中 ${soon.length} 件在 48 小时内到期` : ""}。`,
    "",
    ...data.days.map((day) =>
      [`【${plain(day.label)} ${plain(day.weekday)}】`, ...day.items.map((item) => `  ${[item.time ?? "全天", item.label].map(plain).join(" · ")}　${plain(item.title)}\n  ${hrefPlain(item.url, site.url)}`), ""].join("\n"),
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
  const items = data.items.slice(0, 12);
  const preheader = items.length ? items.slice(0, 3).map((i) => plain(clip(i.title, 18))).join(" / ") : "这一期还没有新的精选。";
  const note = text(clean(data.lead)) || `过去 24 小时里值得一看的 ${items.length} 条。`;
  const inner = `${heroRow(site, data.hero, bodyAccent(data, site))}
${titleBlock("digest", site, note)}
${items.length ? index(items, site) : ""}
${items.map((item, i) => entry(item, site, i)).join("")}
  <tr><td style="padding:${GAP.block}px ${PAD_X}px ${GAP.major}px">${button(site.url, "去网站看全部精选 ↗", site)}</td></tr>
${footer(data, site)}`;
  const body = [
    `${site.name} — ${plain(data.heading) || "每日精选"}`,
    "",
    plain(data.lead),
    "",
    ...items.map((item, i) =>
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
  id: "brief",
  name: "简报",
  description: "白底紧凑：本期速览 + 逐条小方图，一封放得下 12 条，手机上一屏三四条。",
  render(data: EmailData): RenderedEmail {
    if (data.kind === "confirm") return confirm(data);
    if (data.kind === "deadline") return deadline(data);
    return digest(data);
  },
};

export default style;
