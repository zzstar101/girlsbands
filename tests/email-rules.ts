// 邮件模板的排版规则与量尺。tests/email-templates.test.ts 用它跑全部风格；
// 写新风格时也可以单独对自己那一套跑（见文件末尾的用法注释）。
//
// 规则分五组，返回的每条问题都带组名前缀：
//   [标尺] 间距四的倍数、字号只有四级、行高只有三档、圆角只有三档
//   [对齐] 正文左边界必须落在 PAD_X + n×INDENT 的网格上，最多缩进三级
//   [收发] 邮件客户端的硬约束：行内样式、table 布局、600px 封顶、无 <style>/<script>/<link>、
//          无 flex/grid/@media/position、不引外部字体、主题与预览行都有内容
//   [转义] 读者可见的文字全部转义，javascript: URL 不放行
//   [头图] 给了 hero 就必须用：<img> 带 alt/width/height、src 是 http(s)、那一格铺 hero.bg
//          （图片默认被屏蔽，所以「不加载也读得懂」是硬要求，不是加分项）；
//          每一封还要引用自己的大标题牌 /og/email/title/<kind>.png，截止雷达每天一张日期牌
import { load } from "cheerio";
import { ALLOWED_PX, BORDER, INDENT, LEADING, MAX_WIDTH, PAD_X, RADIUS, SPACE, TYPE } from "@girlsbands/industry/email/layout";
import { heroHandle, normalizeHero, type HeroHandle } from "@girlsbands/industry/email/hero";
import { dateHandle, titleHandle } from "@girlsbands/industry/email/title";
import type { EmailData, EmailSite, EmailStyle } from "@girlsbands/industry/email/types";

export const SAMPLE_SITE: EmailSite = {
  name: "少女乐队's",
  subject: "少女乐队",
  tagline: "别错过下一场 Live",
  url: "https://girlsbands.example",
  footerNote: "本站是聚合摘要与索引，信息以官方发布为准",
  logoUrl: "https://girlsbands.example/icon-192.png",
  accent: "#8a5c07",
  accentBright: "#e8b53c",
  hot: "#c8342a",
  ink: "#202126",
  inkSoft: "#73747c",
  inkBody: "#555760",
  surface: "#ffffff",
  bg: "#f7f6f2",
  line: "#d8d6d1",
  lineSoft: "#eceae5",
};

const SITE = SAMPLE_SITE;

/**
 * 把 HTML 实体还原成读者看到的文字。
 * 站名 `少女乐队's` 里的撇号在模板里按规矩转成 `&#39;`，所以「HTML 里有没有站名」不能用原文去比。
 * 只用于这一类可见文字比对；安全检查一律仍拿原始 html。
 */
const visibleText = (html: string) =>
  html
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * 头图样本：与 packages/backend/src/subscriptions/content.ts 造出来的句柄同形。
 * 每封邮件都给一份，因为「每封一张通栏头图」是这一版的产品决定——模板不许装作没看见。
 */
export const HERO_SAMPLE: HeroHandle = heroHandle(
  normalizeHero({
    accent: "#2f6fd0",
    ink: SITE.ink,
    surface: SITE.surface,
    star: "トゲナシトゲアリ",
    date: "2026-10-04",
    logo: "togenashi-togeari",
  }),
  SITE.url,
);

/** 三种邮件的固定样本：故意包含长标题、空乐队、无 note、跨天、48 小时内与远期。 */
export const SAMPLES: EmailData[] = [
  {
    kind: "confirm",
    site: SITE,
    email: "listener@example.com",
    confirmUrl: "https://girlsbands.example/api/site/subscribe/confirm?token=abc123",
    bands: ["トゲナシトゲアリ", "MyGO!!!!!", "結束バンド"],
    wantsDeadlines: true,
    wantsDigest: true,
  },
  {
    kind: "deadline",
    site: SITE,
    email: "listener@example.com",
    days: [
      {
        date: "2026-10-04",
        label: "10/04",
        weekday: "周日",
        items: [
          {
            at: "2026-10-04T23:59",
            time: "23:59",
            zone: "日本时间",
            label: "抽选截止",
            note: "FC先行受付締切",
            title: "トゲナシトゲアリ 8th ONE-MAN LIVE『凛音の理』チケット先行受付",
            url: "https://girlsbands.example/items/abc",
            band: "トゲナシトゲアリ",
            accent: "#e8b53c",
            source: "トゲナシトゲアリ 官网",
            soon: true,
          },
          {
            at: "2026-10-04T10:00",
            time: "10:00",
            zone: "日本时间",
            label: "一般发售",
            note: null,
            title: "結束バンド 出演 新宿LOFT 50周年記念 2マンライブ「DREAM MATCH 2026」",
            url: "https://girlsbands.example/items/def",
            band: "結束バンド",
            accent: "#3f7d5a",
            source: "結束バンド 官网",
            soon: true,
          },
        ],
      },
      {
        date: "2026-10-11",
        label: "10/11",
        weekday: "周日",
        items: [
          {
            at: "2026-10-11",
            time: null,
            zone: null,
            label: "演出当天",
            note: "開場 17:00 / 開演 18:00",
            title: "MyGO!!!!! 5th LIVE「迷跡波」日本武道館公演",
            url: "https://girlsbands.example/items/ghi",
            band: "MyGO!!!!!",
            accent: "#5b6ecb",
            source: "BanG Dream! 官网",
            soon: false,
          },
        ],
      },
      {
        date: "2026-10-18",
        label: "10/18",
        weekday: "周日",
        items: [
          {
            at: "2026-10-18",
            time: null,
            zone: null,
            label: "配信截止",
            note: "アーカイブ配信の視聴期限",
            title: "『ガールズバンドクライ』2nd Anniversary LIVE アーカイブ配信",
            url: "https://girlsbands.example/items/jkl",
            band: "ガールズバンドクライ",
            accent: "#c8342a",
            source: "GIRLS BAND CRY 官网",
            soon: false,
          },
        ],
      },
    ],
    unsubscribeUrl: "https://girlsbands.example/subscribe/manage?token=abc123&action=unsubscribe",
    preferencesUrl: "https://girlsbands.example/subscribe/manage?token=abc123",
  },
  {
    kind: "digest",
    site: SITE,
    email: "listener@example.com",
    heading: "今天的情报",
    lead: "过去 24 小时里，你追的乐队有 6 条值得看一眼。",
    items: [
      {
        title: "トゲナシトゲアリ LIVE in 日本武道館“奏檄の叫” 影像碟化",
        summary: "2026 年 1 月 28 日发售 Blu-ray & DVD，初回限定盘附赠演唱会写真集与纪录片。",
        url: "https://girlsbands.example/items/mno",
        category: "发售",
        bands: ["トゲナシトゲアリ"],
        accents: ["#e8b53c"],
        source: "トゲナシトゲアリ 官网",
        time: "10/03 21:40",
        official: true,
        selected: true,
      },
      {
        title: "トゲナシトゲアリ 香港公演「凛音の理」Special Edition 10 月 2 日开演",
        summary: "首次海外 One-man 公演，主办方公布了入场时间与周边售卖安排。",
        url: "https://girlsbands.example/items/pqr",
        category: "Live",
        bands: ["トゲナシトゲアリ"],
        accents: ["#e8b53c"],
        source: "GIRLS BAND CRY 官网",
        time: "10/03 18:02",
        official: true,
        selected: true,
      },
      {
        title: "結束バンド 将在 SHELTER 35 周年纪念活动举行ワンマン",
        summary: "下北泽 SHELTER 35 周年纪念演出，結束バンド 确认出演并举行单独公演。",
        url: "https://girlsbands.example/items/stu",
        category: "Live",
        bands: ["結束バンド"],
        accents: ["#3f7d5a"],
        source: "結束バンド 官网",
        time: "10/03 12:15",
        official: true,
        selected: false,
      },
      {
        title: "MyGO!!!!! 新单曲「名前のない歌」初回限定盘 店铺别特典公开",
        summary: "各店铺特典图案公开，Amazon 限定版附赠亚克力立牌。",
        url: "https://girlsbands.example/items/vwx",
        category: "周边",
        bands: ["MyGO!!!!!"],
        accents: ["#5b6ecb"],
        source: "BanG Dream! 官网",
        time: "10/02 20:30",
        official: true,
        selected: false,
      },
      {
        title: "「ぼっち・ざ・らじお！」公開録音 in 大阪 门票与配信券 6 月 13 日一般贩售",
        summary: "公开录音的门票与配信券同日开卖，售完即止。",
        url: "https://girlsbands.example/items/yza",
        category: "票务",
        bands: [],
        accents: [],
        source: "リスアニ！",
        time: "10/02 15:00",
        official: false,
        selected: false,
      },
      {
        title: "夢限大みゅーたいぷ 数字单曲「夢我夢中」9 月 28 日 0:00 开始配信",
        summary: "数字单曲正式上线各大平台，附带无字幕 MV。",
        url: "https://girlsbands.example/items/bcd",
        category: "配信",
        bands: ["夢限大みゅーたいぷ"],
        accents: ["#7a4fbf"],
        source: "BanG Dream! 官网",
        time: "10/01 09:00",
        official: true,
        selected: false,
      },
    ],
    unsubscribeUrl: "https://girlsbands.example/subscribe/manage?token=abc123&action=unsubscribe",
    preferencesUrl: "https://girlsbands.example/subscribe/manage?token=abc123",
  },
];

const NASTY = `<script>alert(1)</script>&"'`;

/** 恶意头图句柄：src 是 javascript:，alt / bg / caption 全是注入串。 */
const EVIL_HERO: HeroHandle = { src: `javascript:${NASTY}`, alt: NASTY, width: 600, height: 225, bg: NASTY, caption: NASTY };

/** 恶意样本：每一处读者可见的文字和每一个 URL 都塞进注入串。 */
export const EVIL_SAMPLES: EmailData[] = [
  { kind: "confirm", site: SITE, email: "x@example.com", confirmUrl: `https://girlsbands.example/${NASTY}`, bands: [NASTY], wantsDeadlines: true, wantsDigest: true },
  {
    kind: "deadline",
    site: SITE,
    email: "x@example.com",
    days: [
      {
        date: "2026-10-04",
        label: NASTY,
        weekday: NASTY,
        items: [{ at: "2026-10-04", time: null, zone: null, label: NASTY, note: NASTY, title: NASTY, url: `https://girlsbands.example/${NASTY}`, band: NASTY, accent: NASTY, source: NASTY, soon: true }],
      },
    ],
    unsubscribeUrl: "https://girlsbands.example/u",
    preferencesUrl: `https://girlsbands.example/${NASTY}`,
  },
  {
    kind: "digest",
    site: { ...SITE, name: NASTY, tagline: NASTY, footerNote: NASTY, logoUrl: `javascript:${NASTY}` },
    email: "x@example.com",
    heading: NASTY,
    lead: NASTY,
    items: [{ title: NASTY, summary: NASTY, url: `https://girlsbands.example/${NASTY}`, category: NASTY, bands: [NASTY], accents: [NASTY], source: NASTY, time: NASTY, official: true, selected: true }],
    unsubscribeUrl: "https://girlsbands.example/u",
    preferencesUrl: "https://girlsbands.example/p",
  },
];

/** 把一条行内样式拆成声明表，并把 padding / margin 的简写展开成四边。 */
export function declarations(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (!prop || !value) continue;
    if (prop === "padding" || prop === "margin") {
      const v = value.split(/\s+/);
      const [t, r, b, l] = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v.length === 3 ? [v[0], v[1], v[2], v[1]] : [v[0], v[1], v[2], v[3]];
      out[`${prop}-top`] = t!;
      out[`${prop}-right`] = r!;
      out[`${prop}-bottom`] = b!;
      out[`${prop}-left`] = l!;
      continue;
    }
    out[prop] = value;
  }
  return out;
}

const pxOf = (value: string | undefined): number | null => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec((value ?? "").trim());
  return m ? Number(m[1]) : null;
};

/** 取一个单元格声明的列宽（像素）。`width` 属性和 `style="width:72px"` 都认。 */
function columnWidth(el: { attribs?: Record<string, string> }): number | null {
  const attr = el.attribs?.width;
  if (attr && /^\d+$/.test(attr.trim())) return Number(attr);
  return pxOf(declarations(el.attribs?.style ?? "")["width"] ?? undefined);
}

/** 这个单元格是不是「一栏」——同一行里还有别的 td/th。
 *  独占一行的单元格只是包一层壳，页面留白要从它外面继承下来，不能当栏位清零。 */
function isColumn(node: { prev?: unknown; next?: unknown }): boolean {
  const tds = (n: unknown) => {
    const t = ((n as { tagName?: string }).tagName ?? "").toLowerCase();
    return t === "td" || t === "th";
  };
  let p = node.prev as never;
  while (p) {
    if (tds(p)) return true;
    p = ((p as { prev?: unknown }).prev ?? null) as never;
  }
  let n = node.next as never;
  while (n) {
    if (tds(n)) return true;
    n = ((n as { next?: unknown }).next ?? null) as never;
  }
  return false;
}

/** 正文元素的左边界。
 *
 *  一栏（同一行里有兄弟单元格的 td）自成一个小页面：从它自己的内容盒起算，不把同行
 *  前序单元格的宽度算进来。并列栏位不是缩进层级——三格倒计时色带、日期栏 + 正文栏
 *  这类排版里，第二格的左边界天然落在 200px、72px 这种位置，那不是「缩进歪了」，
 *  而是「另起一栏」。真正要抓的是同一栏位内部的留白漂移：一处 padding 24、
 *  一处 padding 26，前者落在网格上、后者不落。
 *
 *  独占一行的单元格不是栏位，只是壳，所以它的 padding 照常累加。 */
export function insets(html: string): Map<number, string[]> {
  const $ = load(html);
  const out = new Map<number, string[]>();
  $("*").each((_, el) => {
    // <head> 里的东西（title / meta）不进正文版面，量它没有意义。
    const inHead = ["title", "meta", "style", "script", "head"].includes(((el as { tagName?: string }).tagName ?? "").toLowerCase());
    if (inHead) return;
    const node = el as unknown as { children?: { type: string; data?: string }[]; parent?: unknown };
    const text = (node.children ?? [])
      .filter((c) => c.type === "text" && (c.data ?? "").trim())
      .map((c) => (c.data ?? "").trim())
      .join(" ")
      .slice(0, 24);
    if (!text) return;
    let left = 0;
    let cur: { parent?: unknown } | null = el as never;
    while (cur && (cur as { type?: string }).type !== "root") {
      const tag = ((cur as { tagName?: string }).tagName ?? "").toLowerCase();
      if ((tag === "td" || tag === "th") && isColumn(cur as never)) left = 0;
      const d = declarations((cur as { attribs?: Record<string, string> }).attribs?.style ?? "");
      left += pxOf(d["padding-left"]) ?? 0;
      left += pxOf(d["margin-left"]) ?? 0;
      cur = ((cur as { parent?: unknown }).parent ?? null) as never;
    }
    out.set(left, [...(out.get(left) ?? []), text]);
  });
  return out;
}

/** 量一套风格。返回所有问题；空数组表示通过。 */
export function checkStyle(style: EmailStyle): string[] {
  const problems: string[] = [];

  for (const data of SAMPLES) {
    const where = `[标尺] ${style.id}/${data.kind}`;
    const { html } = style.render(data);
    const $ = load(html);
    // 层次：日系 Live 传单的硬规则是「最大字至少是最小字的 3 倍」，否则整页没有主次；
    // 字体最多两套（见出し用 + 本文用）。这两条一起量。
    const sizes: number[] = [];
    const families = new Set<string>();

    $("[style]").each((_, el) => {
      const style0 = $(el).attr("style") ?? "";
      const d = declarations(style0);
      const tag = ((el as { tagName?: string }).tagName ?? "?").toLowerCase();
      const $el = $(el);
      // 撑高用的空元素（font-size:0 / line-height:1px / 1px 高的分隔线）是邮件排版的老办法，
      // 它们不显示文字，所以不受字号标尺约束。
      const spacer = !$el.children().length && !$el.text().trim();
      // 隐藏的预览行（display:none + max-height:0 那一套）读者看不见，同样不量。
      const hidden = /display\s*:\s*none|max-height\s*:\s*0px|opacity\s*:\s*0/i.test(style0);
      for (const [prop, value] of Object.entries(d)) {
        if (hidden) continue;
        const px = pxOf(value);
        if (px === null) continue;
        if (tag === "img" && (prop === "width" || prop === "height" || prop === "max-width")) continue;
        if (prop.startsWith("padding") || prop.startsWith("margin")) {
          if (!(SPACE as readonly number[]).includes(px)) problems.push(`${where}: <${tag}> ${prop}:${px}px 不在间距标尺上`);
        } else if (prop === "font-size") {
          if (spacer && px <= 1) continue;
          sizes.push(px);
          if (!(Object.values(TYPE) as readonly number[]).includes(px)) problems.push(`${where}: <${tag}> font-size:${px}px 不在字号标尺上`);
        } else if (prop.startsWith("border") && prop.endsWith("width")) {
          if (!(BORDER as readonly number[]).includes(px)) problems.push(`${where}: <${tag}> ${prop}:${px}px 不在边框标尺上`);
        } else if (prop === "border-radius") {
          if (!(RADIUS as readonly number[]).includes(px)) problems.push(`${where}: <${tag}> border-radius:${px}px 不在圆角标尺上`);
        } else if (prop === "width" || prop === "max-width") {
          if (px > MAX_WIDTH) problems.push(`${where}: <${tag}> ${prop}:${px}px 超过 ${MAX_WIDTH}px`);
        } else if (prop === "height") {
          if (px > 8 && !(SPACE as readonly number[]).includes(px)) problems.push(`${where}: <${tag}> height:${px}px 不在标尺上`);
        } else if (prop === "line-height") {
          if (spacer && px <= 1) continue;
          if (!(SPACE as readonly number[]).includes(px)) problems.push(`${where}: <${tag}> line-height:${px}px 不在标尺上`);
        } else if (!(ALLOWED_PX as readonly number[]).includes(px)) {
          problems.push(`${where}: <${tag}> ${prop}:${px}px 不在标尺上`);
        }
      }
      if (!hidden && d["font"]) problems.push(`${where}: <${tag}> 用了 font 简写，检查脚本读不出来`);
      if (!hidden && d["font-family"]) families.add(d["font-family"].toLowerCase().replace(/\s+/g, " ").trim());
      if (!hidden && !spacer && d["font-size"] && pxOf(d["font-size"]) !== null && pxOf(d["font-size"])! < TYPE.small) {
        problems.push(`${where}: <${tag}> font-size 小于 ${TYPE.small}px，手机上读不了`);
      }
      const lh = Number(d["line-height"]);
      if (!hidden && d["line-height"] && /^-?[\d.]+$/.test(d["line-height"].trim()) && !(spacer && lh <= 1) && !(Object.values(LEADING) as readonly number[]).includes(lh)) {
        problems.push(`${where}: <${tag}> line-height:${d["line-height"]} 不在行高标尺上`);
      }
    });

    if (sizes.length) {
      const lo = Math.min(...sizes);
      const hi = Math.max(...sizes);
      // 从「封面」这一版起，整封的主次由三张栅格图承担：通栏头图 600×225、大标题牌 552×109、
      // 日期牌 64×80。它们不在 CSS 字号里，所以「最大字 ≥ 最小字 3 倍」这条对正文不再成立——
      // 正文只剩 14/16/18/22 四级，见出し是图片。改成量三件它还能量的事：
      //   ① 最大字号至少要有一级小标题的量（TYPE.subhead），否则正文自己就先平了；
      //   ② 最大和最小要拉开 1.25 倍；
      //   ③ 至少三级字号（14/16/18 这种台阶），一级字号铺满整封等于没有层次。
      // 图片本身另有约束（见 [头图]：每封必须引用自己那张标题牌，deadline 还要引用每张日期牌）。
      if (hi < TYPE.subhead) problems.push(`[层次] ${style.id}/${data.kind}: 最大字号只有 ${hi}px，正文里连一级小标题都没有（最低 ${TYPE.subhead}px）`);
      if (hi < lo * 1.25) problems.push(`[层次] ${style.id}/${data.kind}: 最大字号 ${hi}px 和最小字号 ${lo}px 拉不开，整封没有主次`);
      const steps = new Set(sizes).size;
      if (steps < 3) problems.push(`[层次] ${style.id}/${data.kind}: 正文只有 ${steps} 级字号，分不出主次（至少三级）`);
    } else {
      problems.push(`[层次] ${style.id}/${data.kind}: 一个字号都没声明`);
    }
    if (families.size > 2) problems.push(`[层次] ${style.id}/${data.kind}: 用了 ${families.size} 套字体，日系传单最多 2 套`);

    const at = `[对齐] ${style.id}/${data.kind}`;
    // 多列排版：前面的单元格必须写像素列宽，否则右列的左边界量不出来，对齐就没人管。
    // 列宽只要落在 4 的倍数的细网格上——因为每一栏内部自成小页面（见 insets），
    // 栏位边界不必对齐 24+n×16；三格等宽的 200px 色带才是实际需要的。
    $("tr").each((_, tr) => {
      const cells = $(tr)
        .children("td,th")
        .toArray();
      if (cells.length < 2) return;
      for (const cell of cells.slice(0, -1)) {
        const w = columnWidth(cell as never);
        if (w === null) problems.push(`${at}: 多列排版里前面的单元格没写像素列宽，量不出对齐`);
        else if (w % 8 !== 0) problems.push(`${at}: 列宽 ${w}px 不是 8 的倍数`);
      }
    });

    for (const [left, texts] of insets(html)) {
      if (left < PAD_X) problems.push(`${at}: 左边界 ${left}px 小于页面留白 ${PAD_X}px（${texts[0]}…）`);
      else if ((left - PAD_X) % INDENT !== 0) problems.push(`${at}: 左边界 ${left}px 不在 ${PAD_X}+n×${INDENT} 网格上（${texts[0]}…）`);
      else if (left > PAD_X + 3 * INDENT) problems.push(`${at}: 左边界 ${left}px 缩进超过三级（${texts[0]}…）`);
    }
  }

  for (const data of SAMPLES) {
    const where = `[收发] ${style.id}/${data.kind}`;
    const { html, text, subject, preheader } = style.render(data);
    const bad = [
      [/<style[\s>]/i, "<style>"],
      [/<script[\s>]/i, "<script>"],
      [/<link[\s>]/i, "<link>"],
      [/@media/i, "@media"],
      [/display\s*:\s*(flex|grid)/i, "flex/grid"],
      [/position\s*:\s*(fixed|absolute|sticky)/i, "position"],
      [/\son[a-z]+\s*=/i, "内联事件"],
      [/javascript:/i, "javascript: URL"],
      [/https?:\/\/fonts\./i, "外部字体"],
      [/\bfont\s*:/i, "font 简写"],
    ] as const;
    for (const [re, what] of bad) if (re.test(html)) problems.push(`${where}: 出现 ${what}`);
    if (!/max-width\s*:\s*600px/.test(html)) problems.push(`${where}: 没有 600px 封顶`);
    if (!visibleText(html).includes(SAMPLE_SITE.name)) problems.push(`${where}: HTML 里没有站名`);
    if (!text.includes(SAMPLE_SITE.name)) problems.push(`${where}: 纯文本里没有站名`);
    if (/<[a-z/]/i.test(text)) problems.push(`${where}: 纯文本里还有标签`);
    if (/[\u200b\u200c\u200d\ufeff]/.test(html + text + subject + preheader)) problems.push(`${where}: 出现零宽字符`);
    if (subject.trim().length === 0) problems.push(`${where}: 主题为空`);
    if (preheader.trim().length === 0) problems.push(`${where}: 预览行为空`);
    if (subject.trim() === preheader.trim()) problems.push(`${where}: 主题和预览行一样`);
    if (subject.length > 90) problems.push(`${where}: 主题 ${subject.length} 字，会被截断`);
    if (text.length < 120) problems.push(`${where}: 纯文本只有 ${text.length} 字，太短`);
    if (/AIHOT|AI 评分|AI评分/.test(html + text + subject)) problems.push(`${where}: 出现上游文案`);
  }

  for (const data of SAMPLES) {
    const where = `[头图] ${style.id}/${data.kind}`;
    const { html } = style.render({ ...data, hero: HERO_SAMPLE } as EmailData);
    const $ = load(html);
    const img = $("img").first();
    if (img.length === 0) {
      problems.push(`${where}: 给了 hero 却没画 <img>——这一版每封都要通栏头图`);
    } else {
      const alt = img.attr("alt");
      if (!alt) problems.push(`${where}: <img> 没有 alt（图片默认被屏蔽，读者就只剩一片空白）`);
      else if (!alt.includes(HERO_SAMPLE.caption)) problems.push(`${where}: <img> 的 alt 里没有主角「${HERO_SAMPLE.caption}」`);
      // width/height 属性是给不支持 CSS 的客户端留的，缺了图片会先撑满再跳回来。
      if (img.attr("width") !== String(HERO_SAMPLE.width) || img.attr("height") !== String(HERO_SAMPLE.height)) {
        problems.push(`${where}: <img> 要写死 width="${HERO_SAMPLE.width}" height="${HERO_SAMPLE.height}"，实得 ${img.attr("width")}×${img.attr("height")}`);
      }
      const src = img.attr("src") ?? "";
      if (src !== HERO_SAMPLE.src) problems.push(`${where}: <img src> 不是 hero.src（${src.slice(0, 60)}）`);
      if (!/^https?:\/\//.test(src)) problems.push(`${where}: 头图地址不是 http(s)`);
    }
    if (!html.includes(HERO_SAMPLE.bg)) problems.push(`${where}: 那一格没有铺 hero.bg（${HERO_SAMPLE.bg}），图片没加载时会闪白`);

    // 大标题牌：见出し交给图片之后，这一张就是整封的版面主角，缺了整封就只剩小字。
    // 三种信三张牌，不许混用——「截止提醒」出现在日报里比没有标题更糟。
    const plate = titleHandle(data.kind, SITE.url).src;
    if (!html.includes(plate)) problems.push(`${where}: 没引用这一封自己的标题牌（${plate}）`);
    // 日期牌：截止雷达每天一张，缺一天读者就不知道那一条是哪天。
    if (data.kind === "deadline") {
      for (const day of data.days) {
        const stamp = dateHandle(day.date, SITE.url)?.src;
        if (stamp && !html.includes(stamp)) problems.push(`${where}: ${day.date} 那天没有日期牌（${stamp}）`);
      }
    }
  }

  for (const data of EVIL_SAMPLES) {
    const where = `[转义] ${style.id}/${data.kind}`;
    const { html } = style.render(data);
    if (/<script/i.test(html)) problems.push(`${where}: 恶意串没被转义`);
    if (/javascript:/i.test(html)) problems.push(`${where}: 放行了 javascript: URL`);
    if (html.includes(NASTY)) problems.push(`${where}: 原始恶意串出现在输出里`);
    // 头图是外部可控数据（token 在 URL 里），所以它也要过同一道转义关。
    const withEvilHero = style.render({ ...data, hero: EVIL_HERO } as EmailData).html;
    if (/javascript:/i.test(withEvilHero)) problems.push(`${where}: 恶意 hero.src 被原样放行`);
    if (/<script/i.test(withEvilHero) || withEvilHero.includes(NASTY)) problems.push(`${where}: 恶意 hero 的 alt/caption 没被转义`);
  }

  return problems;
}

// 单独量一套风格（写新模板时用）：
//
//   bun -e 'import { checkStyle } from "<repo>/tests/email-rules.ts";
//     const m = await import("<repo>/industry/email/styles/新风格.ts");
//     const p = checkStyle(m.default); console.log(p.length ? p.slice(0,30).join("\n") : "OK");'
//
// 一次性看全部：把 registry 换成目录扫描即可。
