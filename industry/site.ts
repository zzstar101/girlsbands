// 站点身份和读者看得到的文案。站名、行业词、首页标题、联系方式都在这里。
// 网页和后端都读它；改完重新构建（docker compose up --build）即可生效。
// 域名不在这里：部署时用环境变量 SITE_URL 设置。

export const SITE = {
  /** 站名：导航、页面标题、分享图、RSS、MCP、后台都用它。 */
  name: "少女乐队's",
  /**
   * 行业词：拼进默认说法里，比如“少女乐队日报”“少女乐队动态”。
   * 站名带撇号，不适合直接拼进句子，所以单列一个词。
   */
  subject: "少女乐队",
  /** 首页的完整标题（浏览器标签、搜索结果）。 */
  homeTitle: "少女乐队's — 少女乐队情报站 · Live / 抽选 / 发售",
  /** 一句话介绍：搜索引擎、分享卡片、RSS、llms.txt 会用。 */
  description: "盯住官方站点、官方社交账号与专业媒体，把一场 Live 的公布、先行抽选、一般发售、追加席串成一条时间线，标出马上要截止的抽选和预约。",
  /** 首页左上角和侧边栏下面的一行小字。 */
  tagline: "别错过下一场 Live",
  /** 界面语言（HTML lang、og:locale）。 */
  locale: "zh-CN",
  /** 默认域名，只在没设置 SITE_URL 时使用。 */
  defaultUrl: "http://localhost:3000",
  /**
   * MCP 工具名的前缀（小写字母、数字、下划线），工具会叫 girlsbands_get_latest、girlsbands_search……
   * 已经有人接入后就不要再改。
   */
  mcpPrefix: "girlsbands",
  /** 对外联系邮箱（选填）：使用规则、llms.txt、响应头里会写。 */
  contactEmail: "contact@girlsbands.com" as string | null,
  /** 页脚的一行小字（选填）。 */
  footerNote: "本站聚合各来源原文并译成中文，信息以官方发布为准",
  /** 中国大陆网站的 ICP 备案号（选填），填了就显示在页脚并链接到工信部备案系统。 */
  icp: null as string | null,
  /** 结构化数据里的网站运营者（搜索引擎用）。 */
  organization: {
    name: "少女乐队's",
    /** 创始人（选填）：{ name, url, description }。 */
    founder: null as null | { name: string; url?: string; description?: string },
  },
  /** 抓取信源时报上的名字（User-Agent 里用），不要冒用别的站。 */
  crawlerName: "GirlsBandsBot",
} as const;

/** 关于页的文案。数字（信源数、收录数、精选数、日报期数）来自站内实时统计，不用写在这里。 */
export const ABOUT = {
  kicker: `关于 ${SITE.name}`,
  /** 大标题：第一行正常颜色，第二行强调色。 */
  headline: ["一场 Live 从公布到开演，", "有十几次会错过的机会。"] as [string, string],
  /** 标题下面的一段话。{sources} 会换成实时的信源数。 */
  lead: `${SITE.name} 替你盯着 {sources} 个信源：官网、官方 X、票务页、唱片公司与商店，把同一场 Live 的公布、先行抽选、一般发售和追加席串成一条时间线，把快到期的抽选单独挑出来。免费，不用注册。`,
  /** 信源河动画下面的四个环节。 */
  steps: {
    collect: "官方站点、官方 X 账号、票务与商店页面、专业媒体都在看；有新公告的源 15 分钟就看一次。",
    store: "抓到的都存下来，同一场 Live 的先后进展归到同一个事件下；只计入讨论热度的账号也算在内。",
    select: "模型先看是不是这个企划的事、有没有可行动的信息（什么时候开卖、什么时候截止），再写中文标题与摘要；泛动漫新闻和没有新增信息的转载进不来。",
    publish: "每天 08:00 出日报，周一出周报，每月 1 日出月报；最要紧的抽选与发售可以推到飞书群。",
  },
  /**
   * 作者块（选填），null 就不显示。
   * avatarSourceId：一个 X 账号信源的 id，头像取它的（选填）。
   * 二维码在后台“设置”里上传，或者放进 industry/brand/contact/；没有二维码就不显示那张卡片。
   */
  maker: null as null | {
    name: string;
    greeting: string[];
    avatarSourceId?: string | null;
    wechat?: { title: string; note: string };
    feishu?: { title: string; note: string };
  },
  /** 页面底部的版权与下架说明（结尾会接“反馈页”的链接）。 */
  copyright: `${SITE.name} 把各来源的原文整篇收进站内并译成中文，原文与演出信息版权归各来源所有，一切以官方公告为准。如果你是来源方，希望更正、下架或调整展示方式，可以通过`,
} as const;

/** “少女乐队日报”这类说法：行业词和名词之间，英文词加空格，中文词不加。 */
export function withSubject(noun: string): string {
  return /[A-Za-z0-9]$/.test(SITE.subject) ? `${SITE.subject} ${noun}` : `${SITE.subject}${noun}`;
}

/** “按主题看少女乐队”“往期少女乐队日报”这类说法：行业词接在中文后面，英文词前加空格，中文词不加；noun 照 withSubject 接上。 */
export function subjectAfter(text: string, noun?: string): string {
  const gap = /^[A-Za-z0-9]/.test(SITE.subject) ? " " : "";
  return `${text}${gap}${noun ? withSubject(noun) : SITE.subject}`;
}
