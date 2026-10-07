// 邮件头图第二版：网站自己的宣传图，不再用乐队。
//
// 站主 2026-10-08：头图「不用乐队的，用跟网站关联的，类似宣传图」。所以这一张跟首页大字报同一套：
// 网站 logo、ISSUE 日期章、一句专为邮件写的口号（小字引子 + 胶带黄大字）、底下一条企划名胶带。
// 配色走网站白纸主题的淡粉，不用米色。
//
// 这里只生成地址和 alt；画在 apps/api/src/og/promo.ts，路由 /og/email/promo/<kind>-<YYYY-MM-DD>.png。
// 地址即内容（种类 + 日期），不查库，旧信永远指向它当年那张图。
import type { HeroHandle } from "./hero.ts";
import type { TitleKind } from "./title.ts";

export const PROMO_CANVAS = { width: 1200, height: 450 } as const;
export const PROMO_SIZE = { width: 600, height: 225 } as const;
/** 图片没加载时那一格的底色：和画布的淡粉一致，不闪白。 */
export const PROMO_BG = "#ffe4ee";

/**
 * 每种信一句口号：小字引子 + 胶带大字。专为邮件写的，不复用首页 hero（站主 2026-10-08）。
 * 大字控制在 4 个字左右，600 宽的手机屏上也读得清。
 */
export const PROMO_LINES: Record<TitleKind, { kicker: string; big: string }> = {
  digest: { kicker: "今天的少女乐队", big: "一封看完" },
  deadline: { kicker: "截止日不等人", big: "倒数开始" },
  confirm: { kicker: "欢迎入场", big: "就差一步" },
};

const KINDS = new Set<string>(["digest", "deadline", "confirm"]);

/** `2026-10-08` 才放行，其余当没有日期（确认信没有日期）。 */
function dateOnly(date: string | null | undefined): string {
  const s = (date ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function promoHandle(kind: TitleKind, date: string | null | undefined, siteUrl: string, siteName: string): HeroHandle {
  const d = dateOnly(date);
  const line = PROMO_LINES[kind];
  const caption = `${line.kicker}，${line.big}`;
  return {
    src: `${siteUrl.replace(/\/+$/, "")}/og/email/promo/${kind}${d ? `-${d}` : ""}.png`,
    alt: `${siteName} · ${caption}`,
    ...PROMO_SIZE,
    bg: PROMO_BG,
    caption,
  };
}

/** 路由那端：`digest-2026-10-08.png` → { kind, date }；坏文件名一律 null。 */
export function parsePromoFile(file: string): { kind: TitleKind; date: string } | null {
  const m = /^(digest|deadline|confirm)(?:-(\d{4})-(\d{2})-(\d{2}))?\.png$/.exec(file);
  if (!m || !KINDS.has(m[1]!)) return null;
  if (m[2]) {
    const month = Number(m[3]);
    const day = Number(m[4]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  }
  return { kind: m[1] as TitleKind, date: m[2] ? `${m[2]}-${m[3]}-${m[4]}` : "" };
}
