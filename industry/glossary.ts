// 翻译受控词表：专名在中文侧只有这几种写法，模型不许自己造一个。
//
// 为什么有这个文件：`prompts/translate-body.md` 早就写了「企划、乐队、成员、公演、会场、商店、
// 票务平台与碟名照抄原文」，可是模型手里没有名单时就自己音译——トゲナシトゲアリ 写成「无刺有刺」、
// ぴあアリーナMM 写成「Pia Arena MM」。规则管不住的地方，名单管得住。
//
// 每一条是一组可接受的写法，**第一个是本站倾向使用的写法**。站主 2026-10 拍了板：中文圈有通用名
// 就用通用名，不管官不官方（後藤ひとり → 后藤一里、高松燈 → 高松灯）。所以有中文名的条目第一个
// 就是中文名，没有的中文名就照抄日文原文——**不要在这里自己音译**，也不要为了顺眼把
// `ぴあアリーナMM` 改写成 `Pia Arena MM`。
//
// 范围是站主 2026-10 定的：企划与乐队、成员、会场、演出名、票务平台、碟名。前五类里能列举的
// 都在这里；**演出名和碟名每篇都不一样，列不完**，靠提示词里的类规则（translate-body.md 第 6 条）
// 兜住。
//
// 企划与乐队不在这里重复维护，直接从 `taxonomy.ts` 的 `ENTITIES` 生成；成员名与会场名两批
// 数据量大（成员 162 条、会场 135 条），各自单独一个文件，都是逐条带来源的研究产物。
import { ENTITIES } from "./taxonomy.ts";
import { MEMBERS, PROJECT_CAST } from "./glossary-members.ts";
import { VENUES } from "./glossary-venues.ts";

export type GlossaryKind = "project" | "band" | "work" | "member" | "venue" | "platform";

export interface GlossaryEntry {
  kind: GlossaryKind;
  /**
   * 这个专名在原文里可能出现的写法：日文、假名、罗马字、缩写、中文通用名。
   * **第一个是本站倾向使用的写法**，提示词里让模型优先用它；其余写法只要出现，就当同一个名字。
   */
  forms: readonly string[];
}

const KIND_LABELS: Record<GlossaryKind, string> = {
  project: "企划",
  band: "乐队",
  work: "作品",
  member: "成员",
  venue: "会场",
  platform: "票务平台",
};

/**
 * 作品名不是主体名。`ENTITIES` 为了让结构抽取模型把「ぼざろ」的文章归到 結束バンド 名下，
 * 把作品名放进了 `otherNames`；词表说的是「这些名字照抄」，把作品名挂在乐队那一组会读成
 * 「ぼざろ 就是 結束バンド」。所以这里剔出去，另立一条作品条目。
 */
const WORK_TITLES = new Set(["ぼっち・ざ・ろっく！", "ぼざろ", "Bocchi the Rock!"]);

const entityEntries: GlossaryEntry[] = Object.values(ENTITIES).map((entity) => {
  const forms = [entity.name, ...(entity.otherNames ?? []), ...entity.aliases].filter((n) => n && !WORK_TITLES.has(n));
  return { kind: entity.kind === "project" ? "project" : "band", forms: [...new Set(forms)] };
});

/** 站里覆盖的作品本身（不是乐队）。第一个写法是本站倾向使用的：作品在中文圈有通用中文名。 */
const WORKS: GlossaryEntry[] = [
  { kind: "work", forms: ["孤独摇滚", "ぼっち・ざ・ろっく！", "ぼざろ", "Bocchi the Rock!"] },
  { kind: "work", forms: ["ガールズバンドクライ", "Girls Band Cry"] },
];

/**
 * 票务平台。中日两侧都要，因为国内源和日本源都会出现，而且同一个平台常有好几种写法。
 * 官网域名写在旁边，方便以后核对（不参与匹配）。
 */
const PLATFORMS: GlossaryEntry[] = [
  // 日本
  { kind: "platform", forms: ["イープラス", "e+", "eplus"] }, // eplus.jp
  // 不单收「ぴあ」：它会命中「ぴあアリーナMM」这种会场名，把会场误判成票务平台。
  { kind: "platform", forms: ["チケットぴあ", "t.pia.jp"] }, // t.pia.jp
  { kind: "platform", forms: ["ローソンチケット", "ローチケ", "LEncore"] }, // l-tike.com
  { kind: "platform", forms: ["楽天チケット"] }, // ticket.rakuten.co.jp
  { kind: "platform", forms: ["チケットボード"] }, // ticketboard.jp
  { kind: "platform", forms: ["CNプレイガイド"] }, // cnplayguide.com
  { kind: "platform", forms: ["セブンチケット"] }, // 7ticket.jp
  { kind: "platform", forms: ["LivePocket", "ライブポケット"] }, // t.livepocket.jp
  { kind: "platform", forms: ["ZAIKO", "ザイコ"] }, // zaiko.io
  { kind: "platform", forms: ["カンフェティ"] }, // confetti-web.com
  { kind: "platform", forms: ["イベントレジスト"] }, // eventregist.com
  // 中国大陆
  { kind: "platform", forms: ["大麦", "大麦网"] }, // damai.cn
  { kind: "platform", forms: ["猫眼", "猫眼演出", "猫眼电影"] }, // maoyan.com
  { kind: "platform", forms: ["秀动", "ShowStart"] }, // showstart.com
  { kind: "platform", forms: ["正在现场"] },
  { kind: "platform", forms: ["摩天轮票务", "摩天轮"] },
  { kind: "platform", forms: ["票牛"] },
  { kind: "platform", forms: ["B站会员购", "哔哩哔哩会员购", "bilibili会员购", "会员购"] }, // show.bilibili.com
  { kind: "platform", forms: ["无差别同人站", "同人站", "CPP"] }, // 国内的 ONLY 活动主要在这里开票
];

/**
 * 一条写法值不值得进提示词。
 *
 * 短假名是最容易误命中的：`あい` 会命中 `あいだ`、`りん` 会命中 `りんご`、`アイ` 会命中 `アイドル`，
 * 而词表里恰好有一批两三个假名的成员读音。汉字哪怕两个字也很挑（`理名`、`凪都`、`大麦` 撞不上
 * 别的词），所以规则是：**含汉字的两个字起，纯假名或拉丁的三个字起**（拉丁另外还要贴边界，
 * 见 `contains`）。代价是丢掉 `e+` 与 `Ai` 这种过短的写法，它们各自的条目还有别的写法兜着。
 */
export function usable(form: string): boolean {
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(form)) return form.length >= 2;
  return form.length >= 3;
}

export const GLOSSARY: readonly GlossaryEntry[] = [...entityEntries, ...WORKS, ...MEMBERS, ...PROJECT_CAST, ...VENUES, ...PLATFORMS]
  .map((entry) => ({ kind: entry.kind, forms: entry.forms.filter(usable) }))
  .filter((entry) => entry.forms.length > 0);

/**
 * 词表数据的版本：改了任何一条写法就变，让回执和提示词版本跟着失效。
 * 用 FNV-1a 而不是 node:crypto —— `industry/` 也会被打进浏览器包，那里没有 node 模块。
 */
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

export const GLOSSARY_VERSION = `glossary-${GLOSSARY.length}-${fnv(JSON.stringify(GLOSSARY))}`;

/**
 * NFKC + 小写 + 去掉所有空白 + 去掉撇号，让全角/半角、有空格/没空格、`Poppin'Party` 与
 * `Poppin Party` 都能对上。撇号在这些名字里只是装饰，去掉不会把两个名字混成一个。
 */
export const fold = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/['\u2018\u2019\u02bc`\u00b4]/g, "");

/** 纯 ASCII 的写法要贴边界，否则 `RAS`、`e+` 会命中别的词中间。含日文汉字的写法不必。 */
export function contains(hay: string, form: string): boolean {
  const needle = fold(form);
  if (!needle) return false;
  const ascii = /^[\x00-\x7f]+$/.test(needle);
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    if (!ascii) return true;
    const before = at === 0 ? "" : hay[at - 1]!;
    const after = hay[at + needle.length] ?? "";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
  }
  return false;
}

/** 这段原文里出现过的词表条目。没出现的条目不必塞进提示词。 */
export function glossaryHits(text: string, kinds?: readonly GlossaryKind[]): GlossaryEntry[] {
  const hay = fold(text);
  if (!hay) return [];
  return GLOSSARY.filter((entry) => (!kinds || kinds.includes(entry.kind)) && entry.forms.some((form) => contains(hay, form)));
}

/**
 * 注入提示词的词表块。只列出这段原文真的出现的专名；一个都没命中就返回空串。
 * 写法是「一组写法用 / 隔开，第一个是本站在用的，条目之间用 ；」——不写 `A → B` 的箭头，
 * 因为指令是「用这一组里的写法」，不是「改写成另一个名字」。
 *
 * 说「优先第一个」而不是「必须第一个」：会场的第一种写法是规范化过的名字
 * （`Zepp Haneda (TOKYO)`），原文只写 `Zepp Haneda` 时照原文写才对。
 */
export function glossaryBlock(text: string, kinds?: readonly GlossaryKind[]): string {
  const hits = glossaryHits(text, kinds);
  if (hits.length === 0) return "";
  const byKind = new Map<GlossaryKind, string[]>();
  for (const entry of hits) {
    const list = byKind.get(entry.kind) ?? [];
    list.push([...entry.forms].join(" / "));
    byKind.set(entry.kind, list);
  }
  const lines = [...byKind].map(([kind, list]) => `- ${KIND_LABELS[kind]}：${list.join("；")}`);
  return [
    "【受控词表：下面这些专名只能用同一组里列出的写法（优先第一个），不要自己音译、意译或另起名字】",
    ...lines,
  ].join("\n");
}
