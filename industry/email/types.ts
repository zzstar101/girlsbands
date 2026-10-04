// 邮件模板的接口。网页之外，读者唯一直接看到我们排版的地方就是收件箱。
//
// 一个「风格」就是一组纯函数：拿到同一份数据，渲染出主题、预览行、HTML 和纯文本。
// 风格文件之间不许互相引用，也不许引入任何依赖——邮件客户端会剥掉 <style>、外部字体和
// 大部分现代 CSS，所以每个元素都要写行内 style，布局用 table，宽度 600px 封顶。
//
// 这里的数据是「读者视角」的，不是数据库行：日期已经排好序、乐队已经换成显示名、
// 分类已经换成中文。风格只负责排版，不负责查库。

import type { HeroHandle } from "./hero.ts";

/** 站点身份。模板里所有品牌信息都从这里取，不要写死。 */
export interface EmailSite {
  name: string;
  /** 行业词，比如「少女乐队」。 */
  subject: string;
  tagline: string;
  url: string;
  footerNote: string;
  /** 绝对地址；没有 Logo 时是空字符串，模板要能没有它。 */
  logoUrl: string;
  /** 品牌强调色（浅色底上用的深色版）。 */
  accent: string;
  /** 深色底上用的亮色强调。 */
  accentBright: string;
  /** 紧急色，只给「马上要截止」用。 */
  hot: string;
  /** 深色底、浅色底、文字色，风格可以不用，但不要自己另造一套品牌色。 */
  ink: string;
  inkSoft: string;
  /** 正文段落色（整段读的摘要）：比 ink 轻、比 inkSoft 重。 */
  inkBody: string;
  surface: string;
  bg: string;
  /** 分隔线：日期块之间、页脚上方。 */
  line: string;
  /** 更轻的分隔线：同一天里两条事件之间。 */
  lineSoft: string;
}

/** 确认订阅：唯一一封要求读者点链接的邮件。 */
export interface ConfirmData {
  kind: "confirm";
  site: EmailSite;
  email: string;
  confirmUrl: string;
  /** 想追的乐队显示名；空数组 = 全部。 */
  bands: string[];
  wantsDeadlines: boolean;
  wantsDigest: boolean;
  hero?: HeroHandle | null;
}

export interface DeadlineEntry {
  /** `2026-10-04` 或 `2026-10-04T23:59`，日本时间。 */
  at: string;
  /** 原文写了时间才有，比如 `23:59`。 */
  time: string | null;
  /** 这个日期对读者意味着什么：受理截止 / 受理开始 / 一般发售 / 演出当天 / 配信截止 / 结果公布。 */
  label: string;
  /** 原文里的说法，比如 `プレイガイド先行受付締切`。可能没有。 */
  note: string | null;
  title: string;
  url: string;
  /** 乐队显示名。可能没有。 */
  band: string | null;
  accent: string | null;
  source: string;
  /** 48 小时内。 */
  soon: boolean;
}

export interface DeadlineDay {
  date: string;
  /** `10/04`。 */
  label: string;
  /** `周六`。 */
  weekday: string;
  items: DeadlineEntry[];
}

/** 截止提醒：本站最有价值的一封。 */
export interface DeadlineData {
  kind: "deadline";
  site: EmailSite;
  email: string;
  days: DeadlineDay[];
  unsubscribeUrl: string;
  preferencesUrl: string;
  /**
   * 通栏头图：API 现画的 PNG（官方 logo + 应援色底 + 巨号日号），地址由 industry/email/hero.ts 生成。
   * 风格可以不用它；用了就必须把 `bg` 铺在那一格、把 `alt` 写进 img、把 `caption` 也画出来——
   * 客户端默认屏蔽图片，图挂了这封邮件也得成立。
   */
  hero?: HeroHandle | null;
}

export interface DigestItem {
  title: string;
  summary: string;
  url: string;
  /** 分类显示名：Live / 票务 / 发售 / 周边…… */
  category: string;
  /** 乐队显示名，可能为空。 */
  bands: string[];
  accents: string[];
  source: string;
  /** `10/04 12:00`。 */
  time: string;
  /** 来自一手信源（官网 / 官方 X）。 */
  official: boolean;
  /** 进了精选。 */
  selected: boolean;
}

/** 精选摘要：新精选合并成一封。 */
export interface DigestData {
  kind: "digest";
  site: EmailSite;
  email: string;
  /** `今天的情报` / `刚刚更新的 5 条`。 */
  heading: string;
  /** 一句话说明这封邮件为什么来。 */
  lead: string;
  items: DigestItem[];
  unsubscribeUrl: string;
  preferencesUrl: string;
  /** 通栏头图；同 DeadlineData.hero。 */
  hero?: HeroHandle | null;
}

export type EmailData = ConfirmData | DeadlineData | DigestData;

export interface RenderedEmail {
  subject: string;
  /** 收件箱里主题下面那行灰字。 */
  preheader: string;
  html: string;
  /** 纯文本版；只发 HTML 会被判垃圾邮件。 */
  text: string;
}

export interface EmailStyle {
  /** 文件名即 id，小写连字符。 */
  id: string;
  /** 给运营看的中文名字。 */
  name: string;
  /** 一句话说明这套风格想表达什么。 */
  description: string;
  render(data: EmailData): RenderedEmail;
}

/** 所有读者可见的文字都必须先过这一层。 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
