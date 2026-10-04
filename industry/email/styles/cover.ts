// 封面（cover）——「大标题牌 + 正文只负责说清楚」。
//
// 这一版是用户自己改出来的（原稿在 .data/event-mail-v1/，1200×450 的头图 + 标题牌 + 日期牌）。
// 前 17 套都栽在同一件事上：纯文字排版再怎么排也炸裂不起来。这一版把「炸裂」整个交给图片：
//
//   1. 通栏头图（600×225）：API 现画——官方 logo + 应援色底板 + 巨号鬼影日号。图片被屏蔽时
//      那一格用 hero.bg 的应援色垫底，alt 里写着「哪支乐队、哪一天」，所以不加载也读得懂。
//   2. 大标题牌（552×109）：Dela Gothic One 108px 的日文大标题 + 36px 的中文小注。
//   3. 正文：只有 14/16/18/22 四级字号，把「什么时候、什么事、去哪看」说清楚。
//      deadline 每天一块：左边一张日期牌（64×80），右边是当天的事件；digest 每条一块；
//      confirm 只有一个按钮。
//   4. 页脚：站名 + ※ 注意書き + 订阅设置 / 退订，上面一条 1px 细线。
//
// 为什么标题和日期是图片（用户自己写下的理由）：**邮件正文不能加载外部字体**。Dela Gothic One
// 只存在于预览页和 API 那台机器上，同一个字体在 Gmail、Outlook、iOS 邮件里会变成三种样子，
// 所以由 API 用 satori 画成 PNG，正文里只放 <img>。代价是图片被屏蔽就什么都看不到，
// 所以两块牌的 alt 都是中文全称（「截止提醒」「10/4」），不是文件名。
// 正文的字色、分隔线一律从 theme.ts 取；所有尺寸从 layout.ts 的标尺取，tests/email-rules.ts 逐条核对。
//
// 少女乐队感来自应援色的用法：底板、日期牌、按钮都是主角乐队的应援色族，墨色压在色面上时
// 深浅一律交给 `inkOn()` 决定。整封只用一个应援色族 + 墨色 + 浅底。
//
// 没有的数据一个都不编：会場名・席種・料金・整理番号・メンバー名我们都没有，一个字都不写。
import { dateHandle, DATE_SIZE, titleHandle, type TitleKind } from "../title.ts";
import { type HeroHandle } from "../hero.ts";
import { GAP, inkOn, LEADING, MAX_WIDTH, PAD_X, PAD_Y, TYPE, WEIGHT } from "../layout.ts";
import { escapeHtml, type ConfirmData, type DeadlineData, type DigestData, type EmailData, type EmailStyle, type EmailSite, type RenderedEmail } from "../types.ts";

/** 邮件里不引外部字体：中日文都走系统栈。属性用单引号，双引号会截断 style="…"。 */
const SANS = "-apple-system,'Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP','Noto Sans SC','Segoe UI',sans-serif";

/** 按钮底部的硬边。6px 是标尺里最粗的一档。 */
const BORDER_EDGE = 6;
/** 摘要只留 80 个全角字：邮件不是阅读器，剩下的交给「读这条情报」。 */
const CLIP = 80;

const HEX = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;

/** 去掉控制字符与零宽字符——邮件里这些字符会让量尺和客户端都读错。 */
function clean(v: string | null | undefined): string {
  return (v ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "").trim();
}

/** 颜色来自数据，会直接写进 style，所以一律先过 HEX 校验；脏值退回兜底色。 */
function color(v: string | null | undefined, fallback: string): string {
  const c = clean(v);
  return HEX.test(c) ? c : fallback;
}

/** 站点色令牌全部先过一遍校验，后面所有地方都只认这个对象。 */
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

/** 所有读者可见的 HTML 文字都先过这一层。 */
const text = (v: string | null | undefined) => escapeHtml(clean(v));

/** 纯文本版：数据里的尖括号一律摘掉，免得被当成 HTML 标签。 */
const plain = (v: string | null | undefined) => clean(v).replace(/[<>]/g, "");

/** 只放行 http(s)；其余（含 javascript:）退回兜底地址，绝不写进 href。 */
function href(raw: string | null | undefined, fallback: string): string {
  const value = clean(raw);
  return escapeHtml(/^https?:\/\//i.test(value) ? value : fallback);
}

/** 纯文本版地址：同样只放行 http(s)，但不过 HTML 转义。 */
function hrefPlain(raw: string | null | undefined, fallback: string): string {
  const value = clean(raw);
  return /^https?:\/\//i.test(value) ? value : fallback;
}

/** 正文里的链接：一律墨色、无下划线——邮件里蓝色下划线是最像网页的东西。 */
function link(url: string | null | undefined, label: string, c: string, fallback: string, size: number = TYPE.body): string {
  return `<a href="${href(url, fallback)}" style="font-size:${size}px;color:${color(c, fallback)};text-decoration:none;word-break:break-word">${text(label)}</a>`;
}

/** 按 code point 截断到 n 个全角字以内，末尾补省略号。 */
function clip(v: string | null | undefined, n: number): string {
  const chars = [...clean(v)];
  return chars.length <= n ? chars.join("") : `${chars.slice(0, n).join("")}…`;
}

/**
 * 大标题牌。显示 552×109（画布 1104×218，2 倍图），撑满正文宽度——它就是这一封的版面主角。
 * `width:100%;max-width:552px` 是给窄屏客户端的：600px 的表格在手机上会被缩放，图跟着缩。
 */
function titlePlate(kind: TitleKind, site: EmailSite): string {
  const t = titleHandle(kind, site.url);
  return `<img src="${href(t.src, site.url)}" alt="${text(t.alt)}" width="${t.width}" height="${t.height}" style="display:block;width:100%;max-width:${t.width}px;height:auto;border:0">`;
}

/** 日期牌：一天一张（`10-04` → 画布 128×160 显示 64×80）。日期不合法就不画，绝不编一个。 */
function datePlate(date: string, site: EmailSite): string {
  const d = dateHandle(date, site.url);
  if (!d) return "";
  return `<img src="${href(d.src, site.url)}" alt="${text(d.alt)}" width="${d.width}" height="${d.height}" style="display:block;width:${d.width}px;height:${d.height}px">`;
}

/** 标题牌那一格：牌 + 一句说明。三种信共用，说明行各自写。 */
function titleBlock(kind: TitleKind, site: EmailSite, note: string): string {
  return `
  <tr><td style="padding:${GAP.major}px ${PAD_X}px 0">
    ${titlePlate(kind, site)}
    <p style="margin:${PAD_Y.block}px 0 0;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${site.inkSoft}">${note}</p>
  </td></tr>`;
}

/**
 * 通栏头图。图片被屏蔽时那一格是 hero.bg 的应援色（bgcolor + background 都写，老客户端只认前者），
 * alt 里带着「哪支乐队、哪一天」；没有 hero 时退成同色实色块，版面一样不漏。
 */
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
  // 兜底：没有头图时只留一块应援色 + 一句话。行高撑不起来没关系，这一格本来就不该出现。
  return `
  <tr><td bgcolor="${bg}" style="background:${bg};padding:${GAP.major}px ${PAD_X}px;font-size:${TYPE.subhead}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};color:${inkOn(bg, site.ink, site.surface)}">${text(alt)}</td></tr>`;
}

/** 站点里的某个页面：site.url 可能带尾斜杠，先去掉再拼，免得拼出 `//deadlines`。 */
function page(site: EmailSite, path: string): string {
  return `${clean(site.url).replace(/\/+$/, "")}${path}`;
}

/** 一行小字：来源、时刻、注释都用它。 */
function metaLine(v: string, site: EmailSite, top = 0): string {
  return `<div style="padding-top:${top}px;font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">${v}</div>`;
}

/** 正文：deadline——每天一块：左边日期牌，右边当天的事件。 */
function deadlineBody(data: DeadlineData, site: EmailSite, accent: string): string {
  const days = data.days.slice(0, 4);
  if (days.length === 0) {
    return `
  <tr><td style="padding:${PAD_Y.section}px ${PAD_X}px ${GAP.major}px">
    <div style="font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${site.inkSoft}">接下来没有要过期的日子。有新的，我们再提醒你。</div>
  </td></tr>`;
  }
  return days
    .map((day) => {
      const events = day.items
        .slice(0, 4)
        .map((item, i) => {
          const soon = item.soon ? `<span style="font-size:${TYPE.small}px;color:${site.hot}"> · 48 小时内</span>` : "";
          const who = clean(item.band) || clean(item.label);
          // 时刻用粗体顶在状态前面；只写了「当天」的节点没有时刻，就只印状态。
          const when = item.time ? `<strong>${text(item.time)}</strong>&nbsp; ` : "";
          const source = [clean(item.note), clean(item.source)].filter(Boolean).map(text).join(" · ");
          return `
    <div${i === 0 ? "" : ` style="border-top:1px solid ${site.lineSoft};padding-top:${PAD_Y.card}px;margin-top:${PAD_Y.card}px"`}>
      <div style="font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">${text(who)}${soon}</div>
      <div style="margin:${GAP.block}px 0 ${GAP.group}px;font-size:${TYPE.subhead}px;line-height:${LEADING.loose};font-weight:${WEIGHT.bold};color:${site.ink};word-break:break-word">${link(item.url, item.title, site.ink, site.url, TYPE.subhead)}</div>
      <div style="font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${site.ink}">${when}${text(item.label)}</div>
      ${source ? metaLine(source, site, GAP.block) : ""}
      <div style="margin-top:${GAP.group}px">${link(item.url, "查看详情 →", site.ink, site.url, TYPE.small)}</div>
    </div>`;
        })
        .join("");
      return `
  <tr><td style="padding:${GAP.block}px ${PAD_X}px ${PAD_Y.section}px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid ${site.line}">
      <tr>
        <td width="${DATE_SIZE.width}" valign="top" style="width:${DATE_SIZE.width}px;padding:${PAD_Y.section}px ${GAP.section}px 0 0">${datePlate(day.date, site)}</td>
        <td valign="top" style="padding:${PAD_Y.section}px 0 0">${events}</td>
      </tr>
    </table>
  </td></tr>`;
    })
    .join("");
}

/** 正文：digest——每条一块，块与块之间一条细线。 */
function digestBody(data: DigestData, site: EmailSite): string {
  if (data.items.length === 0) {
    return `
  <tr><td style="padding:${PAD_Y.section}px ${PAD_X}px ${GAP.major}px">
    <div style="font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${site.inkSoft}">这一期还没有新的精选。有值得看的，我们再发给你。</div>
  </td></tr>`;
  }
  const items = data.items
    .slice(0, 6)
    .map((item, i) => {
      const bands = [item.bands.join("、"), item.official ? "官方" : ""].filter(Boolean).map(text).join(" · ");
      const metaText = [clean(item.time), clean(item.category), clean(item.source)].filter(Boolean).map(text).join(" · ");
      return `
    <div${i === 0 ? "" : ` style="border-top:1px solid ${site.lineSoft};padding-top:${PAD_Y.card}px;margin-top:${PAD_Y.card}px"`}>
      ${bands ? metaLine(bands, site) : ""}
      <h2 style="margin:${GAP.group}px 0 ${PAD_Y.block}px;font-size:${TYPE.heading}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};word-break:break-word">${link(item.url, item.title, site.ink, site.url, TYPE.heading)}</h2>
      <p style="margin:0 0 ${PAD_Y.block}px;font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${site.inkBody}">${text(clip(item.summary, CLIP))}</p>
      ${metaText ? `<div style="font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">${metaText}</div>` : ""}
      <p style="margin:${PAD_Y.card}px 0 0;font-weight:${WEIGHT.bold}">${link(item.url, "读这条情报 →", site.ink, site.url, TYPE.body)}</p>
    </div>`;
    })
    .join("");
  return `
  <tr><td style="padding:${GAP.block}px ${PAD_X}px ${GAP.major}px">
    <div style="border-top:3px solid ${site.ink};padding-top:${PAD_Y.section}px">${items}</div>
  </td></tr>
  <tr><td style="padding:0 ${PAD_X}px ${GAP.major}px">${link(site.url, "查看全部精选 ↗", site.ink, site.url, TYPE.body)}</td></tr>`;
}

/** 正文：confirm——只有一件事：一个大按钮。 */
function confirmBody(data: ConfirmData, site: EmailSite): string {
  const bands = data.bands.length ? data.bands.map(text).join("、") : "全部乐队与企划";
  const wants = [data.wantsDeadlines ? "截止提醒" : "", data.wantsDigest ? "每日精选" : ""].filter(Boolean);
  const plan = wants.length ? wants.map((w) => `✓ ${w}`).join(" &nbsp;&nbsp; ") : "先不发送任何内容，你随时可以在订阅设置里打开。";
  return `
  <tr><td style="padding:${GAP.block}px ${PAD_X}px ${GAP.major}px">
    <a href="${href(data.confirmUrl, site.url)}" style="display:block;background:${site.ink};border-bottom:${BORDER_EDGE}px solid ${site.accentBright};color:${site.surface};padding:${PAD_Y.card}px 0;font-size:${TYPE.heading}px;line-height:${LEADING.normal};font-weight:${WEIGHT.bold};text-decoration:none;text-align:center">确认订阅 →</a>
    <p style="margin:${GAP.group}px 0 0;font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">确认链接 48 小时内有效。</p>
  </td></tr>
  <tr><td style="padding:0 ${PAD_X}px ${GAP.major}px">
    <div style="border-top:1px solid ${site.line};padding-top:${PAD_Y.section}px">
      <div style="font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">你关注的乐队</div>
      <p style="margin:${GAP.block}px 0 ${PAD_Y.card}px;font-size:${TYPE.subhead}px;line-height:${LEADING.loose};font-weight:${WEIGHT.bold};color:${site.ink}">${bands}</p>
      <div style="font-size:${TYPE.body}px;line-height:${LEADING.loose};color:${site.ink}">${plan}</div>
      <p style="margin:${PAD_Y.section}px 0 0;font-size:${TYPE.small}px;line-height:${LEADING.loose};color:${site.inkSoft}">如果不是你提交的订阅申请，忽略这封邮件即可。未经确认不会开始发送。</p>
    </div>
  </td></tr>`;
}

/** 页脚：站名 + 注意書き + 订阅设置 / 退订。三种信共用；确认信不写退订（那时还没订上）。 */
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

/** 整封信：600px 封顶的浅底，里面一列到底。 */
function document(site: EmailSite, subject: string, inner: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text(subject)}</title></head>
<body style="margin:0;padding:0;background:${site.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${site.bg};font-family:${SANS}">
<tr><td align="center" style="padding:${PAD_Y.section}px 0">
<table role="presentation" width="${MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${MAX_WIDTH}px;max-width:${MAX_WIDTH}px;background:${site.surface};font-family:${SANS}">
${inner}
</table>
</td></tr>
</table>
</body></html>`;
}

/** 这一封的应援色：数据里的第一支乐队色，取不到才退品牌金。 */
function bodyAccent(data: EmailData, site: EmailSite): string {
  if (data.kind === "deadline") {
    for (const day of data.days) for (const item of day.items) if (item.accent) return color(item.accent, site.accentBright);
  }
  if (data.kind === "digest") {
    for (const item of data.items) for (const a of item.accents) if (a) return color(a, site.accentBright);
  }
  return site.accentBright;
}

/** 确认订阅：标题牌 + 一句「点一下」+ 一个大按钮 + 你订了什么。 */
function confirm(data: ConfirmData): RenderedEmail {
  const site = safeSite(data.site);
  const accent = bodyAccent(data, site);
  const bands = data.bands.length ? data.bands.map(plain).join("、") : "全部乐队与企划";
  const wants = [data.wantsDeadlines ? "截止提醒" : "", data.wantsDigest ? "每日精选" : ""].filter(Boolean);
  const subject = `【${clean(site.name)}】还差一步，订阅就完成了`;
  const preheader = "点一下「确认订阅」，我们才开始发；不点，一条都不会发。";

  const note = `<span style="font-size:${TYPE.subhead}px;color:${site.ink}">点一下，订阅就完成了。</span><br>确认后，我们会把你关注的事件节点和精选动态送到邮箱。`;
  const inner = `${heroRow(site, data.hero, accent)}
${titleBlock("confirm", site, note)}
${confirmBody(data, site)}
${footer(data, site)}`;

  const body = [
    `${site.name} — 确认订阅`,
    "",
    "点一下，订阅就完成了。",
    "确认后，我们会把你关注的事件节点和精选动态送到邮箱。",
    "",
    `确认订阅：${hrefPlain(data.confirmUrl, site.url)}`,
    "（确认链接 48 小时内有效。）",
    "",
    `你关注的乐队：${bands}`,
    `发送内容：${wants.length ? wants.join(" / ") : "先不发送任何内容"}`,
    "",
    "如果不是你提交的订阅申请，忽略这封邮件即可。未经确认不会开始发送。",
    "",
    `※ ${plain(site.footerNote)}。`,
    `${plain(site.name)} · ${hrefPlain(site.url, site.url)}`,
  ].join("\n");
  return { subject, preheader, html: document(site, subject, inner), text: body };
}

/** 截止雷达：头图 + 标题牌 + 每天一块（日期牌 + 当天的事件）。 */
function deadline(data: DeadlineData): RenderedEmail {
  const site = safeSite(data.site);
  const accent = bodyAccent(data, site);
  const items = data.days.flatMap((d) => d.items);
  const soon = items.filter((i) => i.soon);
  const days = data.days.length;
  const subject = `【${clean(site.name)}】${soon.length > 0 ? `${soon.length} 件在 48 小时内到期` : items.length > 0 ? `${items.length} 件即将到期` : "接下来没有要到期的事"}`;
  const preheader = soon.length
    ? `最近的是 ${plain(data.days[0]?.label)}，48 小时内就得动手。`
    : days
      ? "接下来这几天的安排，先记进日历，临近了我们再提醒你。"
      : "接下来没有要过期的日子，有新的我们立刻提醒你。";

  const soonNote = soon.length > 0 ? ` · <span style="font-size:${TYPE.body}px;color:${site.hot}">${soon.length} 件在 48 小时内到期</span>` : "";
  const note = `本期 ${items.length} 条动态${soonNote}<br>所有日期与时刻均为日本时间。`;
  // 用户那版样张底下有一条「查看完整日程 ↗」；P0 的截止雷达页就是按天排的完整日程，指过去。
  const schedule = page(site, "/deadlines");
  const inner = `${heroRow(site, data.hero, accent)}
${titleBlock("deadline", site, note)}
${deadlineBody(data, site, accent)}
  <tr><td style="padding:0 ${PAD_X}px ${GAP.major}px"><div style="border-top:1px solid ${site.line};padding-top:${PAD_Y.section}px">${link(schedule, "查看完整日程 ↗", site.ink, site.url, TYPE.body)}</div></td></tr>
${footer(data, site)}`;

  const body = [
    `${site.name} — 截止雷达`,
    "",
    `本期 ${items.length} 条动态${soon.length > 0 ? `，其中 ${soon.length} 件在 48 小时内到期` : ""}。`,
    "所有日期与时刻均为日本时间。",
    "",
    ...data.days.map((day) =>
      [
        `【${plain(day.label)} ${plain(day.weekday)}】`,
        ...day.items.map((item) => {
          const when = [item.time, item.label].filter(Boolean).map(plain).join("　");
          const where = [item.band, item.source].filter(Boolean).map(plain).join(" · ");
          return [`  ${when}${item.soon ? "（48 小时内）" : ""}`, `  ${plain(item.title)}`, where ? `  ${where}` : "", `  ${hrefPlain(item.url, site.url)}`]
            .filter(Boolean)
            .join("\n");
        }),
        "",
      ].join("\n"),
    ),
    `查看完整日程：${hrefPlain(schedule, site.url)}`,
    "",
    `※ ${plain(site.footerNote)}。`,
    `${plain(site.name)} · ${hrefPlain(site.url, site.url)}`,
    `订阅设置：${hrefPlain(data.preferencesUrl, site.url)}　退订：${hrefPlain(data.unsubscribeUrl, site.url)}`,
  ].join("\n");
  return { subject, preheader, html: document(site, subject, inner), text: body };
}

/** 每日精选：头图 + 标题牌 + 每条一块（乐队、标题、摘要、时刻来源、读这条）。 */
function digest(data: DigestData): RenderedEmail {
  const site = safeSite(data.site);
  const accent = bodyAccent(data, site);
  const subject = `【${clean(site.name)}】${clean(data.heading) || `本期 ${data.items.length} 条`}`;
  const preheader = `过去 24 小时里，值得一看的 ${data.items.length} 条动态。`;

  const note = text(clip(data.lead, CLIP)) || `过去 24 小时里，值得一看的 ${data.items.length} 条动态。`;
  const inner = `${heroRow(site, data.hero, accent)}
${titleBlock("digest", site, note)}
${digestBody(data, site)}
${footer(data, site)}`;

  const body = [
    `${site.name} — ${plain(data.heading) || "每日精选"}`,
    "",
    plain(clip(data.lead, CLIP)),
    "",
    ...data.items.map((item, i) => {
      const metaText = [item.bands.join("、"), item.time, item.category, item.source].filter(Boolean).map(plain).join(" · ");
      return [`${String(i + 1).padStart(2, "0")}　${plain(item.title)}`, `　${plain(clip(item.summary, CLIP))}`, metaText ? `　${metaText}` : "", `　${hrefPlain(item.url, site.url)}`, ""]
        .filter(Boolean)
        .join("\n");
    }),
    `看全部情报：${hrefPlain(site.url, site.url)}`,
    "",
    `※ ${plain(site.footerNote)}。`,
    `${plain(site.name)} · ${hrefPlain(site.url, site.url)}`,
    `订阅设置：${hrefPlain(data.preferencesUrl, site.url)}　退订：${hrefPlain(data.unsubscribeUrl, site.url)}`,
  ].join("\n");
  return { subject, preheader, html: document(site, subject, inner), text: body };
}

const style: EmailStyle = {
  id: "cover",
  name: "封面",
  description: "通栏头图 + 栅格化大标题牌：图负责炸裂，正文只用四级字号说清楚。",
  render(data: EmailData): RenderedEmail {
    if (data.kind === "confirm") return confirm(data);
    if (data.kind === "deadline") return deadline(data);
    return digest(data);
  },
};

export default style;
