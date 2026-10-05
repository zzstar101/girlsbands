// 「这场演出现在走到哪一步」这条规则只有一份：公告自己说的取消 / 延期只是输入，开演日与票务日期说了算。
// 读取层（publication/lives.ts）用它渲染页面，散场之后的曲目单扫描（lives/setlists.ts）用它判断哪几场
// 已经结束了 —— 同一句话在两处各写一遍，迟早会分叉。
import type { DeadlineKind, DeadlineView, LiveStage, LiveStatus, Timezone } from "@girlsbands/contracts/site";
import { timezoneDate } from "@girlsbands/contracts/time";

/** 这些日期说明票务已经开始过：抽选开始/截止、一般发售。 */
const TICKET_KINDS = new Set<DeadlineKind>(["lottery_start", "lottery_end", "sale_start"]);

/** 判断阶段要的那几列；live_events 的一行本身就满足它。 */
export interface StageInput {
  status: LiveStatus;
  starts_on: string;
  ends_on: string | null;
  timezone: Timezone;
}

/** 读者看到的阶段：公告只是它的一个输入，开演日与票务日期说了算。派生而不存 —— 存下来的阶段过一夜就过时。 */
export function stageOf(row: StageInput, dates: DeadlineView[], now: Date): LiveStage {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "postponed") return "postponed";
  if (isFinished(row, now)) return "finished";
  const today = timezoneDate(row.timezone, now);
  if (row.starts_on <= today) return "live_day";
  if (dates.some((d) => d.kind === "sale_start" && d.day <= today)) return "on_sale";
  if (dates.some((d) => TICKET_KINDS.has(d.kind))) return "ticketing";
  return "announced";
}

/** 散场了：公告没说取消或延期，而最后一天（单日演出就是那一天）已经过去。 */
export function isFinished(row: StageInput, now: Date): boolean {
  return row.status === "scheduled" && (row.ends_on ?? row.starts_on) < timezoneDate(row.timezone, now);
}
