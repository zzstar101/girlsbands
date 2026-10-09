// Live 板块顶上的两个视图：「Live」只看演出当天，「全部日程」是原来的日历（抽选、发售、周边……都在，能订阅 .ics）。
import { Link } from "react-router";

export function LiveSwitch({ active }: { active: "live" | "all" }) {
  const item = (on: boolean) =>
    `px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${on ? "bg-ink text-bg" : "text-ink-3 hover:text-ink"}`;
  return (
    <nav aria-label="Live 板块" className="mb-3 inline-flex overflow-hidden rounded-full border border-line">
      <Link to="/live" prefetch="intent" aria-current={active === "live" ? "page" : undefined} className={item(active === "live")}>Live</Link>
      <Link to="/calendar" prefetch="intent" aria-current={active === "all" ? "page" : undefined} className={item(active === "all")}>全部日程</Link>
    </nav>
  );
}
