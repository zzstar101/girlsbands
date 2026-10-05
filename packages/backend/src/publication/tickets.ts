// 票务轮次的读取层：写入在 lives/tickets.ts（写属主是 lives/），这里只读回来给演出页与截止雷达用。
// 状态不落库，按日期与此刻算出来 —— 与 live_events 的阶段同一条规矩，算的东西不会过期。
//
// 站里没有读者账号，所以状态只描述「这条受理现在走到哪一步」，不猜「你中没中、付没付」。
import {
  LOTTERY_ROUND_KINDS, TICKET_ROUND_KINDS, TICKET_ROUND_LABELS,
  type DeadlineKind, type TicketRoundDate, type TicketRoundKind, type TicketRoundStatus, type TicketRoundView, type Timezone,
} from "@girlsbands/contracts/site";
import { sql } from "../db.ts";
import { deadlineInstant, isTimezone, splitDeadlineAt } from "../sources/timezone.ts";
import { hasItemPage } from "./rules.ts";

const KINDS: ReadonlySet<string> = new Set<string>(TICKET_ROUND_KINDS);

/** 只写了日期的那种截止：一整天都算数，到那一地的 23:59 为止；开始类节点反过来，从当天零点起。 */
const END_OF_DAY = "23:59";

/** 一天的绝对时刻：有日期没时刻就按槽位取当天首尾，与截止雷达的 soon 同一套算法。 */
function bound(at: string | null, timezone: Timezone, edge: "start" | "end"): number | null {
  const split = at === null ? null : splitDeadlineAt(at);
  if (!split) return null;
  return deadlineInstant(split.day, split.localTime ?? (edge === "end" ? END_OF_DAY : null), timezone);
}

/**
 * 这条受理现在到哪一步了。按绝对时刻比，不按日历比 —— 一条 23:59 截止的受理，在它自己那一地的那一天
 * 里都还开着；只写日期的截止日同样整天算数（读者最需要它的就是那一天）。付款期限优先于当落日：公告
 * 写了缴款期限时，读者的下一个动作是缴款。
 */
export function roundStatus(
  round: { applyStart: string | null; applyEnd: string | null; resultOn: string | null; paymentDueOn: string | null },
  timezone: Timezone,
  now: Date,
): TicketRoundStatus {
  const at = now.getTime();
  const start = bound(round.applyStart, timezone, "start");
  const end = bound(round.applyEnd, timezone, "end");
  const result = bound(round.resultOn, timezone, "start");
  const due = bound(round.paymentDueOn, timezone, "end");
  if (start !== null && at < start) return "announced";
  if (due !== null) return at >= due ? "closed" : "payment_open";
  if (result !== null) return at >= result ? "result_out" : "awaiting_result";
  if (end !== null) return at >= end ? "closed" : "open";
  return start !== null ? "open" : "closed";
}

/**
 * 轮次的一个日期在截止雷达里算是哪一种节点：抽选 / 先行受理用「受理开始、受理截止」，
 * 一般贩售与当日券用「一般发售、贩售截止」，当落日与缴款期限各自有名字。
 */
export function roundDeadlineKind(kind: TicketRoundKind, which: "start" | "end"): DeadlineKind {
  const lottery = LOTTERY_ROUND_KINDS.has(kind);
  if (which === "start") return lottery ? "lottery_start" : "sale_start";
  return lottery ? "lottery_end" : "sale_end";
}

/** 一条轮次上的四个日期槽位，顺序就是页面上的顺序。 */
export const ROUND_SLOTS = ["applyStart", "applyEnd", "resultOn", "paymentDueOn"] as const;
export type RoundSlot = (typeof ROUND_SLOTS)[number];

/** 这个槽位在截止雷达里算哪一种节点。 */
export function roundSlotKind(kind: TicketRoundKind, slot: RoundSlot): DeadlineKind {
  if (slot === "applyStart") return roundDeadlineKind(kind, "start");
  if (slot === "applyEnd") return roundDeadlineKind(kind, "end");
  return slot === "resultOn" ? "result" : "payment_deadline";
}

/** 雷达那一行的前缀：哪一种受理、在哪个平台。 */
export function roundNote(kind: TicketRoundKind, platform: string | null): string {
  const label = TICKET_ROUND_LABELS[kind];
  return platform ? `${label} · ${platform}` : label;
}

function roundDate(at: string | null): TicketRoundDate | null {
  if (at === null) return null;
  const split = splitDeadlineAt(at);
  return split ? { at, day: split.day, localTime: split.localTime } : null;
}

interface RoundRow {
  id: string;
  public_id: string;
  kind: string;
  platform: string | null;
  timezone: string | null;
  apply_start_at: string | null;
  apply_end_at: string | null;
  result_on: string | null;
  payment_due_on: string | null;
  first_seen_at: Date;
  item_id: string | null;
  title: string | null;
  visibility: string | null;
  source_mode: string | null;
}

/**
 * 一场演出的受理轮次，最早的一轮在前。`itemId` 指向第一次说出这条轮次的那篇公告 —— 那篇被下架或
 * 没有公开页面时留 null（日期仍然算数，只是没有能点进去的原文）。
 */
export async function roundsOf(liveEventId: number, now = new Date()): Promise<TicketRoundView[]> {
  const rows = await sql<RoundRow[]>`
    SELECT tr.id, tr.public_id, tr.kind, tr.platform, tr.timezone, tr.apply_start_at, tr.apply_end_at,
           tr.result_on, tr.payment_due_on, tr.first_seen_at, p.article_id AS item_id, p.title,
           p.visibility, s.participation_mode AS source_mode
    FROM ticket_rounds tr
    LEFT JOIN publications p ON p.article_id = tr.first_article_id
    LEFT JOIN sources s ON s.id = p.source_id
    WHERE tr.live_event_id = ${liveEventId}
    ORDER BY COALESCE(tr.apply_start_at, tr.apply_end_at, tr.result_on, tr.payment_due_on), tr.kind`;

  return rows.flatMap((row) => {
    if (!KINDS.has(row.kind)) return [];
    const timezone: Timezone = isTimezone(row.timezone) ? row.timezone : "Asia/Tokyo";
    const linked = row.item_id !== null && hasItemPage({ visibility: row.visibility ?? "withdrawn", sourceMode: row.source_mode ?? "" });
    return [{
      publicId: row.public_id,
      kind: row.kind as TicketRoundKind,
      platform: row.platform,
      timezone,
      status: roundStatus(
        { applyStart: row.apply_start_at, applyEnd: row.apply_end_at, resultOn: row.result_on, paymentDueOn: row.payment_due_on },
        timezone,
        now,
      ),
      applyStart: roundDate(row.apply_start_at),
      applyEnd: roundDate(row.apply_end_at),
      resultOn: roundDate(row.result_on),
      paymentDueOn: roundDate(row.payment_due_on),
      itemId: linked ? row.item_id : null,
      title: linked ? row.title : null,
      firstSeenAt: row.first_seen_at.toISOString(),
    }];
  });
}
