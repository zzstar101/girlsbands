// 邮件里的两张「栅格卡片图」：标题图（1104×218）与日期图（128×160）。
//
// 为什么是图片而不是 HTML：邮件客户端只肯用收件人机器上的系统字体，Dela Gothic One 这类显示字体
// 没有系统版本，只能预渲染成 PNG 再 <img> 进邮件。几何逐字对齐用户认可的样张
// `.data/event-mail-v1/build-types.ts`（第 12 行标题图、第 16 行日期图）：字号、字距、行高、
// marginTop、配色都照抄，改了就不再是用户挑中的那版。
//
// 两张图都走 render.ts 的 renderPng()，它按 name 做磁盘缓存与 inflight 去重——所以 name 里必须
// 带**全部参数 + 模板版本**：只改 ETag 不改 name 的话，磁盘上那张旧图会一直被发出去。
//
// 字体：日文大字走 Dela Gothic One（DISPLAY_FAMILY），中文小字走 Noto Sans SC（CN_FAMILY），
// 日期图的「10月」走 Noto Sans JP（JP_FAMILY）。satori 缺字不报错、只画豆腐块或悄悄回退，
// 所以字库覆盖由 tests/og-fonts.test.ts 钉住。
import { createHash } from "node:crypto";
import { CN_FAMILY, DISPLAY_FAMILY, JP_FAMILY, h, renderPng, type Node } from "./render.ts";

/** 几何、字号、文案，改任何一项都要 +1：它既进 ETag，也进磁盘缓存键。 */
export const CARD_TEMPLATE_VERSION = "mail-card-2026-10-04.1";

const PAPER = "#ffffff";
const INK = "#202126";
const MUTED = "#73747c";

export const TITLE_W = 1104;
export const TITLE_H = 218;
export const DATE_W = 128;
export const DATE_H = 160;

/** 三种邮件的标题：日文大字 + 中文小字。字符串同时是字库断言的数据源（build-og-jp-font.ts）。 */
export const MAIL_TITLES = {
  deadline: { jp: "締切レーダー", cn: "截止提醒" },
  digest: { jp: "今日のニュース", cn: "每日精选" },
  confirm: { jp: "あと一歩。", cn: "确认订阅" },
} as const;
export type MailTitleId = keyof typeof MAIL_TITLES;
export const MAIL_TITLE_IDS = Object.keys(MAIL_TITLES) as MailTitleId[];

function titleTree(id: MailTitleId): Node {
  const t = MAIL_TITLES[id];
  return h(
    "div",
    { width: TITLE_W, height: TITLE_H, display: "flex", flexDirection: "column", backgroundColor: PAPER, color: INK },
    [
      // 108px 的日文大字是这张图的全部记忆点：Dela Gothic One 的粗黑字面 + 负字距。
      h("div", { fontFamily: DISPLAY_FAMILY, fontSize: 108, lineHeight: 1.2, letterSpacing: -4 }, t.jp),
      h("div", { fontFamily: CN_FAMILY, fontWeight: 700, fontSize: 36, marginTop: 14, letterSpacing: 2 }, t.cn),
    ],
  );
}

function dateTree(month: string, day: string): Node {
  return h(
    "div",
    { width: DATE_W, height: DATE_H, display: "flex", flexDirection: "column", backgroundColor: PAPER, color: INK },
    [
      h("div", { fontFamily: JP_FAMILY, fontSize: 28, color: MUTED }, `${month}月`),
      h("div", { fontFamily: DISPLAY_FAMILY, fontSize: 68, lineHeight: 1.1, marginTop: 8 }, day),
    ],
  );
}

/** 参数全部进哈希：换了参数就是换了图，ETag 与缓存键都得跟着变。 */
function cardEtag(...parts: string[]) {
  return createHash("sha256").update(CARD_TEMPLATE_VERSION).update(parts.join("\u0000")).digest("hex").slice(0, 24);
}

export function titleEtag(id: MailTitleId): string {
  return cardEtag("title", id, MAIL_TITLES[id].jp, MAIL_TITLES[id].cn);
}

export function dateEtag(month: string, day: string): string {
  return cardEtag("date", month, day);
}

/** `deadline.png` → `deadline`；其它一律 null（路由据此 404）。 */
export function parseTitleFile(file: string): MailTitleId | null {
  const id = file.endsWith(".png") ? file.slice(0, -4) : "";
  return (MAIL_TITLE_IDS as readonly string[]).includes(id) ? (id as MailTitleId) : null;
}

/** `10-04.png` → `{month:"10", day:"04"}`；格式不符或不是真实存在的一天都返回 null。 */
export function parseDateFile(file: string): { month: string; day: string } | null {
  const m = /^(\d{2})-(\d{2})\.png$/.exec(file);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month: m[1]!, day: m[2]! };
}

/** 标题图 PNG。缓存键带上 id 与模板版本，两张不同的图不会互相命中。 */
export async function renderTitle(id: MailTitleId): Promise<{ png: Buffer; etag: string }> {
  const etag = titleEtag(id);
  const png = await renderPng(`email-title-${id}-${CARD_TEMPLATE_VERSION}`, { width: TITLE_W, height: TITLE_H }, async () => titleTree(id));
  return { png, etag };
}

/** 日期图 PNG（`month`/`day` 都是两位字符串，如 `"10"`/`"04"`）。 */
export async function renderDate(month: string, day: string): Promise<{ png: Buffer; etag: string }> {
  const etag = dateEtag(month, day);
  const png = await renderPng(`email-date-${month}-${day}-${CARD_TEMPLATE_VERSION}`, { width: DATE_W, height: DATE_H }, async () => dateTree(month, day));
  return { png, etag };
}
