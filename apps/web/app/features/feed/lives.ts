// 演出在读者眼里只剩一个问题：「什么时候、到哪一步了」。阶段由 api 读时算出来（存下来的过一夜就过时），
// 这里只负责给它一个说法和一种颜色；演出页面与主题页的演出栏读同一份，两个地方不会各叫各的。
import type { LiveStage } from "@girlsbands/contracts/site";

export const LIVE_STAGES: Record<LiveStage, { label: string; tone: "neutral" | "accent" | "amber" | "hot" }> = {
  announced: { label: "已公布", tone: "neutral" },
  ticketing: { label: "受理中", tone: "amber" },
  on_sale: { label: "已开售", tone: "accent" },
  live_day: { label: "今天开演", tone: "hot" },
  finished: { label: "已结束", tone: "neutral" },
  cancelled: { label: "已取消", tone: "hot" },
  postponed: { label: "已延期", tone: "amber" },
};

/** 已经过去的场次不再报「还剩几天」。 */
export function openStage(stage: LiveStage): boolean {
  return stage !== "finished" && stage !== "cancelled";
}
