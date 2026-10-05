// 一张碟在读者眼里是三个问题：这是什么、什么时候出、里面有什么。说法的字来自契约（页脚、提醒信用的是
// 同一批），配色是网站自己的事 —— 与 `feed/tickets.ts` 的 `ROUND_KINDS` 同一套写法。
import {
  RELEASE_EDITION_LABELS, RELEASE_KIND_LABELS, RELEASE_SERIAL_LABELS,
  type ReleaseEditionKind, type ReleaseKind, type ReleaseSerialKind,
} from "@girlsbands/contracts/site";

export const RELEASE_KINDS: Record<ReleaseKind, { label: string; className: string }> = {
  single: { label: RELEASE_KIND_LABELS.single, className: "text-accent" },
  album: { label: RELEASE_KIND_LABELS.album, className: "text-accent" },
  ep: { label: RELEASE_KIND_LABELS.ep, className: "text-accent" },
  bluray: { label: RELEASE_KIND_LABELS.bluray, className: "text-band" },
  dvd: { label: RELEASE_KIND_LABELS.dvd, className: "text-band" },
  digital: { label: RELEASE_KIND_LABELS.digital, className: "text-ink-3" },
  merch: { label: RELEASE_KIND_LABELS.merch, className: "text-ink-3" },
  other: { label: RELEASE_KIND_LABELS.other, className: "text-ink-4" },
};

/** 版本名照抄原文（初回限定盤 A / 通常盤），这里只给它的类别一个说法。 */
export const EDITION_KINDS: Record<ReleaseEditionKind, string> = {
  regular: RELEASE_EDITION_LABELS.regular,
  limited: RELEASE_EDITION_LABELS.limited,
  first_press: RELEASE_EDITION_LABELS.first_press,
  other: RELEASE_EDITION_LABELS.other,
};

export const SERIAL_KINDS: Record<ReleaseSerialKind, { label: string; className: string }> = {
  lottery: { label: RELEASE_SERIAL_LABELS.lottery, className: "text-amber" },
  preorder: { label: RELEASE_SERIAL_LABELS.preorder, className: "text-ink-3" },
  streaming: { label: RELEASE_SERIAL_LABELS.streaming, className: "text-ink-3" },
  other: { label: RELEASE_SERIAL_LABELS.other, className: "text-ink-4" },
};

/** ¥3,300 —— 公告没写价格就不显示（`priceYen` 是 null 就是没写）。 */
export function priceText(priceYen: number | null): string | null {
  return priceYen === null ? null : `¥${priceYen.toLocaleString("en-US")}`;
}

/** 还有几天发售：`D-33`，当天是「今天发售」，过了就是「已发售 N 天」。没有发售日就是 null。 */
export function releaseProgress(daysLeft: number | null): string | null {
  if (daysLeft === null) return null;
  if (daysLeft > 0) return `D-${daysLeft}`;
  return daysLeft === 0 ? "今天发售" : `已发售 ${-daysLeft} 天`;
}
