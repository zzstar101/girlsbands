// 一轮票务受理在读者眼里只剩两个问题：「现在到哪一步」「下一个日期是什么」。状态由 api 读时按日期算出来
// （存下来的过一夜就过时），这里只给它一个说法和一种颜色；演出页与将来的行动中心读同一份。
import { TICKET_ROUND_LABELS, type TicketRoundDate, type TicketRoundKind, type TicketRoundStatus, type TicketRoundView } from "@girlsbands/contracts/site";

/** 轮次的名字来自契约，颜色是网站自己的事 —— 与 `feed/deadlines.ts` 的 `DEADLINE_KINDS` 同一套写法。 */
export const ROUND_KINDS: Record<TicketRoundKind, { label: string; className: string }> = {
  fc: { label: TICKET_ROUND_LABELS.fc, className: "text-amber" },
  official: { label: TICKET_ROUND_LABELS.official, className: "text-amber" },
  cd_serial: { label: TICKET_ROUND_LABELS.cd_serial, className: "text-amber" },
  playguide: { label: TICKET_ROUND_LABELS.playguide, className: "text-amber" },
  general: { label: TICKET_ROUND_LABELS.general, className: "text-accent" },
  additional_seat: { label: TICKET_ROUND_LABELS.additional_seat, className: "text-hot" },
  day_of: { label: TICKET_ROUND_LABELS.day_of, className: "text-hot" },
  resale: { label: TICKET_ROUND_LABELS.resale, className: "text-ink-3" },
  streaming: { label: TICKET_ROUND_LABELS.streaming, className: "text-ink-3" },
};

export const ROUND_STATUS: Record<TicketRoundStatus, { label: string; tone: "neutral" | "accent" | "amber" | "hot" }> = {
  announced: { label: "还没开始", tone: "neutral" },
  open: { label: "受理中", tone: "accent" },
  awaiting_result: { label: "已截止", tone: "amber" },
  result_out: { label: "当落已出", tone: "amber" },
  payment_open: { label: "待缴款", tone: "hot" },
  closed: { label: "已结束", tone: "neutral" },
};

/** 四个日期槽位与它们在页面上的说法，顺序就是显示顺序。 */
const SLOTS = [
  { key: "applyStart", label: "受理开始" },
  { key: "applyEnd", label: "受理截止" },
  { key: "resultOn", label: "当落发表" },
  { key: "paymentDueOn", label: "缴款截止" },
] as const;

/** 这一轮写出来的日期，按槽位顺序 —— 公告没写的槽位不出现。 */
export function roundDates(round: TicketRoundView): Array<{ key: string; label: string; date: TicketRoundDate }> {
  return SLOTS.flatMap((s) => {
    const date = round[s.key];
    return date ? [{ key: s.key as string, label: s.label, date }] : [];
  });
}
