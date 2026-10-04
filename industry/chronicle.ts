// 主题页“大事记”的行业规则。通用的几步在框架里（packages/backend/src/publication/topic-chronicle.ts）：
// 从近 12 个月已公开的精选里，按这里的规则定类型，比精选分门槛，把同一件事并成一个节点，按每月名额取舍，
// 再写成事件名；企划／乐队主题只收这个主体自己的（看事实主体，没有主体时看标题在发布动作之前先点名谁），
// 方向主题（Live、票务……）收标题点名这个方向、分数够门槛的。内容形态主题不出页面，也不设大事记。
// 换行业时改这个文件：节点类型（名称、门槛、名额、画在哪一行）、发布动作、一篇报道算哪类节点。
// 合并同一场公演、写事件名两项可选，删掉就用框架的做法：只合并标题或事件名相同的，事件名取标题的第一句。
// 乐队编年史还可以接上人工整理的历史：industry/chronicles/{主题 slug}.json，格式见 docs/customize.md。

import { ENTITIES } from "./taxonomy.ts";

/** 主题的分组（topics.json 的 group）：企划与乐队、情报领域、内容形态。 */
type Group = "band" | "company" | "field" | "genre";

/** 一类节点。 */
export interface ChronicleKind {
  /** 卡片和时间轴上的类型名。 */
  label: string;
  /** 企划／乐队的编年史里排在时间轴上方一行（Live：公演），标记最醒目；其余类型在下方一行。 */
  above?: true;
  /** 主题自己推出的事（Live：公演与票务），用强调色标记；企划／乐队主题只收这个主体自己发布的。其余类型算新闻，只收以这个主体为主体的。 */
  launch?: true;
  /** 企划／乐队主题收这类节点的精选分门槛和每月名额（各类型分开取，互不挤占）；不写就不收。 */
  company?: { min: number; perMonth: number };
  /** 方向主题收这类节点的精选分门槛（这些主题每月按重要程度取前 5 件）；不写就不收。 */
  other?: { min: number };
}

/** 规则读到的一篇入选报道。 */
export interface ChronicleItem {
  title: string;
  /** 外文报道的原标题。 */
  originalTitle: string | null;
  category: string | null;
  tags: string[];
  /** 属于这个行业最受关注的那类消息（taxonomy.ts 的 RELEASE：开售与抽选）。 */
  release: boolean;
  /** 结构化抽取出的事实动作，比如 announce、perform。 */
  factAction: string | null;
}

/** 一个候选节点：代表报道、事件名和它的全部报道。 */
export interface ChronicleEvent {
  kind: string;
  label: string;
  head: { title: string };
  reports: ReadonlyArray<{ title: string }>;
}

export interface ChronicleRules {
  /** 节点类型。企划／乐队主题的搜索摘要按这里的先后列出。 */
  kinds: Record<string, ChronicleKind>;
  /** 发布动作。企划／乐队主题遇到没有事实主体的报道，看标题在它之前先点名的是哪个主体。 */
  launchVerb: RegExp;
  /** 一篇报道在这一组主题里算哪类节点；不论分数高低都不算节点时返回 null（汇总、榜单、传闻……）。 */
  kindOf(item: ChronicleItem, group: Group): string | null;
  /** 可选：同一周、同一类型的两个节点是不是同一件事（归组漏掉的同一场公演或同一张碟）。 */
  sameEvent?(a: ChronicleEvent, b: ChronicleEvent): boolean;
  /** 可选：节点在时间轴上的名字（“8th ONE-MAN LIVE『凛音の理』”），由代表报道的标题得出。 */
  eventName?(title: string, kind: string, topic: { slug: string; orgNames: readonly string[] }): string;
}

// ── 哪些报道算节点 ──────────────────────────────────────────────────────────────────────

/** 分类到节点类型的对应；taxonomy.ts 的 other 和未分类不算节点。 */
const KIND_BY_CATEGORY: Record<string, string> = {
  live: "live",
  ticket: "ticket",
  release: "release",
  merch: "merch",
  stream: "stream",
  collab: "collab",
  member: "member",
  notice: "notice",
  media: "media",
};

/** 汇总、榜单和传闻不是“大事记”：它们是编辑内容或未经确认的消息。 */
const NOT_A_MILESTONE = [
  /まとめ|特集|プレイリスト|歌单|汇总|盘点|合集|ランキング|排行榜|おすすめ|名盤/, // 汇总
  /噂|传闻|リーク|泄露|未確認|未确认|かもしれ|らしい/, // 没有确认
  /^(?:本日|今日)(?:の)?(?:一曲|1曲|1枚)/, // 日常栏目
  /(?:グッズ|商品)紹介|ディスコグラフィ/, // 商品目录
];
/** 电视、广播和生放送是“成员上了节目”这类事件；杂志专栏和播客闲聊不是。 */
const BROADCAST = /テレビ|\bTV\b|ラジオ|广播|电视|生放送|生配信|出演/;
/** 回顾、复盘、评测这类稿子讲的是已经发生过的事，不是新的事件；动作词按这个行业的写法列全。 */
const COMMENTARY_ACTION = /^(?:opinion|analysis|commentary|prediction|tutorial|recap|review|介绍|讲解|分享|评测|测评|回顾|复盘)/i;

/** 报道讲的是哪类节点：分类决定类型，企划／乐队主题再按上面两条排除掉不算事的。 */
function kindOf(item: ChronicleItem, group: Group): string | null {
  // 已经发生的事的回顾不是节点。分类本身已经涵盖了 RELEASE（开售与抽选）那一档，
  // 所以 item.release 不用在这里再看一遍。
  if (COMMENTARY_ACTION.test(item.factAction ?? "")) return null;
  const kind = KIND_BY_CATEGORY[item.category ?? ""] ?? null;
  if (!kind || NOT_A_MILESTONE.some((p) => p.test(item.title))) return null;
  if (kind === "media" && (group === "company" || group === "band") && !BROADCAST.test(`${item.title} ${item.originalTitle ?? ""}`)) return null;
  return kind;
}

// ── 同一场公演 ──────────────────────────────────────────────────────────────────────────

const plain = (title: string) => title.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");

/** 去掉公布动作后仍然太短的标签不比，免得两条无关消息因为都是“Live”并在一起。 */
const SHORT = 6;

/** 去掉公布动作后同一个名字：“… 開催決定”和“… を開催”是同一场公演。 */
function sameEvent(a: ChronicleEvent, b: ChronicleEvent): boolean {
  const [x, y] = [a.label, b.label].map((label) => plain(label.replace(TRAILING, "").replace(DANGLING, "")));
  return x.length >= SHORT && x === y;
}

// ── 事件名 ──────────────────────────────────────────────────────────────────────────────
// 大事记写事件名（“8th ONE-MAN LIVE『凛音の理』”“新单曲《名前のない歌》”），新闻标题留给报道本身。
// 公演名、碟名和会场名一律照抄原标题，不翻译、不改写。

/**
 * 标题第一个分句在哪里结束：逗号（数字里的不算）、冒号、分号、句号、破折号或竖线，以及成句的叹号问号。
 * 日文顿号「、」与中文逗号都算边界——日文标题常用「トゲナシトゲアリ、8th … 開催決定、チケットは…」，
 * 不切会把后半句一起写进事件名。连续叹号只算最后一个之前不算边界（“MyGO!!!!!”“バンドリ！”是名字的一部分），
 * 所以叹号前面还是叹号时不切。
 */
const CLAUSE = /[、，：；。？｜|]|(?<![!！])[!！](?=\s|$|\p{Script=Han})|(?<![?？])[?？](?=\s|$|\p{Script=Han})|(?<!\d),|,(?!\d)|[:;](?=\s|$|\p{Script=Han})|——|\s[-—–]\s/u;
/**
 * 标题末尾的公布动作，写事件名时去掉：告知动词本身，或带上了“開催／発売／リリース／配信／受付／販売／予約”的说法
 * ——“8th ONE-MAN LIVE を開催”“新シングル リリース決定”“FC先行受付開始”都算。只是“開催／発売／受付”这类本身
 * 就是事件名一部分的词要求前面不是汉字，免得把“生配信”“先行受付”“一般発売”吃掉一半；“開始／決定”这类纯动词照删。
 * 助词里带上“の”，日文的通知才去得干净：“開催中止のお知らせ”剩下的应是“開催中止”，不是“開催中止の”。
 * “ライブ配信”整词算进去，免得只删“配信”留下一个孤零零的“ライブ”。
 */
const TRAILING = /(?:\s*(?:にて|に|で|へ|と|が|を|は|も|の|、|，))?\s*(?:正式に|ついに|いよいよ)?\s*(?:(?<![\p{Script=Han}])(?:開催|开催|举办|举行|発売|发售|リリース|ライブ配信|配信|受付|販売|予約)(?:が)?(?:決定|决定|开始|開始|解禁|スタート|します|しました|いたします|致します|お知らせ)?|(?:決定|决定|开始|開始|解禁|スタート|します|しました|いたします|致します|お知らせ))(?:\s*(?:しました|いたしました|します|いたします|する|した))?\s*[！!。.]?\s*$/u;
/** 去掉公布动作后剩下的连接词。 */
const DANGLING = /[\s、，,]+(?:にて|に|で|へ|と|が|を|は|も|の)*[\s、，,]*$/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * 行业里所有主体的名字（含别名和俗称），长的先试，免得短名抢在长名前面。
 * 方向／形态主题（“ワンマン”“票务”）不剥主体名——页面上要看出这是谁的 Live——所以事件名要把名字连着抄回去。
 */
const NAMED = [...new Set(Object.values(ENTITIES).flatMap((e) => [e.name, ...e.aliases, ...(e.otherNames ?? [])]))]
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join("|");
/** 标题开头的主体名和它后面的助词、标点，整段（“トゲナシトゲアリ、”“Ave Mujica ”）照抄回事件名。 */
const ANY_OPENING = NAMED ? new RegExp(`^(?:${NAMED})\\s*(?:が|は|の|、|，|[：:]|\\s)`, "u") : null;

type Topic = { slug: string; orgNames: readonly string[] };
const subjectForms = new Map<string, RegExp | null>();
/** 标题开头的这个主体自己的名字（“トゲナシトゲアリ、8th ONE-MAN LIVE…”）。 */
function subjectOpening(t: Topic): RegExp | null {
  if (!subjectForms.has(t.slug)) {
    const names = [...t.orgNames].sort((a, b) => b.length - a.length).map(escape).join("|");
    subjectForms.set(t.slug, names ? new RegExp(`^(?:${names})\\s*(?:が|は|の|、|，|[：:]|\\s)`, "u") : null);
  }
  return subjectForms.get(t.slug)!;
}

/** 说事件的那个分句：碰到逗号、冒号就断开，取第一句（“【速報】”这类标签留在里面不影响阅读）。 */
const namingClause = (title: string) => title.split(CLAUSE).map((c) => c.replace(/\s*[（(][^（）()]*[）)]\s*$/u, "").trim()).filter(Boolean)[0] ?? title.trim();

/**
 * 事件名：去掉开头的主体名和末尾的公布动作，剩下的照抄，不改写、不翻译。
 * 主体名先整条剥掉再切分句：乐队名自带叹号（MyGO!!!!!、バンドリ！），先切分句会把名字切碎。
 * 主题自己的名字不抄回来（页面本身就是它的），别的名字和方向／形态主题里的名字要连着写回事件名。
 */
function eventName(title: string, _kind: string, t: Topic): string {
  const trimmed = title.trim();
  const own = subjectOpening(t)?.exec(trimmed);
  const opening = own ?? ANY_OPENING?.exec(trimmed) ?? null;
  const prefix = own || !opening ? "" : opening[0].replace(/\s+/g, " ");
  const clause = namingClause(opening ? trimmed.slice(opening[0].length) : trimmed);
  const rest = clause.replace(TRAILING, "").replace(DANGLING, "").trim();
  return prefix + ([...rest].length >= 2 ? rest : clause);
}

export const CHRONICLE: ChronicleRules = {
  kinds: {
    live: { label: "Live", above: true, launch: true, company: { min: 60, perMonth: 4 }, other: { min: 65 } },
    release: { label: "发售", above: true, launch: true, company: { min: 60, perMonth: 4 }, other: { min: 65 } },
    ticket: { label: "票务", launch: true, company: { min: 58, perMonth: 4 }, other: { min: 65 } },
    stream: { label: "直播", launch: true, company: { min: 62, perMonth: 2 }, other: { min: 68 } },
    merch: { label: "周边", launch: true, company: { min: 62, perMonth: 2 }, other: { min: 70 } },
    collab: { label: "联动", launch: true, company: { min: 65, perMonth: 2 }, other: { min: 70 } },
    member: { label: "成员", company: { min: 68, perMonth: 2 }, other: { min: 72 } },
    notice: { label: "通知", company: { min: 65, perMonth: 2 }, other: { min: 70 } },
    media: { label: "媒体", company: { min: 75, perMonth: 1 }, other: { min: 75 } },
  },
  launchVerb: /公布|发布|发表|宣布|公开|开催|開催|举办|举行|决定|決定|解禁|発売|发售|上线|配信|受付|开始|開始|预约|予約|登場|登场|出演|決定/,
  kindOf,
  sameEvent,
  eventName,
};
