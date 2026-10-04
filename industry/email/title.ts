// 邮件里那两块「文字做成图片」的牌：大标题牌和日期牌。
//
// 为什么是图片：邮件正文不能加载外部字体，也没有可靠的字体回退——同一个 Dela Gothic One
// 在 Gmail、Outlook、iOS 邮件里会变成三种样子。所以标题和日期由 API 用 satori 现画成 PNG，
// 正文里只放 <img>。代价是图片被屏蔽时什么都看不到，所以 alt 必须写全（这里是中文标题和日期）。
//
// 这里只生成地址和尺寸，不负责画；画在 apps/api/src/og/title.ts，路由在 apps/api/src/routes/og.ts。
// 尺寸是「画布尺寸的一半」：画布 1104×218 显示 552×109，画布 128×160 显示 64×80。

/** 大标题牌的三种，和邮件三种一一对应。 */
export type TitleKind = "confirm" | "deadline" | "digest";

export interface ImageHandle {
  /** 绝对地址。 */
  src: string;
  /** 图片被屏蔽时读者看到的字，所以是中文全称而不是文件名。 */
  alt: string;
  width: number;
  height: number;
}

/** 画布尺寸与显示尺寸。显示尺寸 = 画布 ÷ 2。 */
export const TITLE_CANVAS = { width: 1104, height: 218 } as const;
export const TITLE_SIZE = { width: 552, height: 109 } as const;
export const DATE_CANVAS = { width: 128, height: 160 } as const;
export const DATE_SIZE = { width: 64, height: 80 } as const;

const TITLE_ALT: Record<TitleKind, string> = {
  confirm: "确认订阅",
  deadline: "截止提醒",
  digest: "每日精选",
};

/**
 * `2026-10-04` → `10-04`。日期牌一天一张，文件名就是月-日。
 * 不是合法日期就返回 null（绝不抛：邮件不能因为一条脏数据整封崩掉）。
 */
export function dateStamp(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(cleanDate(date));
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[2]}-${m[3]}`;
}

export function titleHandle(kind: TitleKind, siteUrl: string): ImageHandle {
  return {
    src: `${siteUrl}/og/email/title/${kind}.png`,
    alt: TITLE_ALT[kind],
    ...TITLE_SIZE,
  };
}

/**
 * 日期牌。数据里的日期不合法（缺了、写错了）就返回 null，由调用方决定「没有日期牌也照发」。
 */
export function dateHandle(date: string, siteUrl: string): ImageHandle | null {
  const stamp = dateStamp(date);
  if (!stamp) return null;
  const [month, day] = stamp.split("-") as [string, string];
  return {
    src: `${siteUrl}/og/email/date/${stamp}.png`,
    alt: `${month}/${day}`,
    ...DATE_SIZE,
  };
}

/** 日期必须先过这一关：去掉零宽字符、控制字符和空白，再交给正则。 */
function cleanDate(date: string): string {
  return (date ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\ufeff]/g, "").trim();
}
