// 远征参考（/guide）：**本站不重写远征攻略**，只做指路。
//
// 为什么不写：远征知识（票务流程、入境、交通、现场礼仪）的半衰期是半年到一年，通用赴日事项
// 更是有人写得比我们全得多 —— 自己重写一遍只会多出一份过期更快的副本，还要一直维护。所以这一页
// 只做两件事：把现有写得最好的两份外部资料指出去，再给三个站内入口（截止雷达 / Live 与活动 /
// 日历订阅，见 apps/web/app/routes/guide.tsx）。
//
// 收录标准：公开可读、不要求登录、有作者或来源可查。链接挂了就直接删，不在这里放二手转述。
export interface GuideResource {
  id: string;
  title: string;
  /** 一句话说清它能解决什么问题（页面卡片与 OG 卡都用它）。 */
  summary: string;
  /** 谁写的、什么许可 —— 读者点出去之前该知道的事。 */
  source: string;
  href: string;
}

/** 这一页自己的地址；sitemap 与侧栏入口都读它。 */
export const GUIDE_PATH = "/guide";

export const GUIDE_RESOURCES: GuideResource[] = [
  {
    id: "genchi-wiki",
    title: "《现代远征攻略》",
    summary: "从签证、机票、酒店到进场与离场，一份公开的现地经验整理。",
    source: "飞书公开社区版 · 社区协作",
    href: "https://www.feishu.cn/community/article/wiki?id=7382098129484513283",
  },
  {
    id: "seatview",
    title: "SeatView 座位视角",
    summary: "按场馆的坐席图，每个点位一张实拍照片，买票前先看清视野。",
    source: "SeatView · 众包实拍（CC BY-NC 4.0）",
    href: "https://seat.genchi.top/",
  },
];
