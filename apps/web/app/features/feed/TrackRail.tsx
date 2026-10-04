import { Link } from "react-router";
import { IconArrowRight } from "../../components/icons";

/**
 * The four things a fan comes to check, in the order the product cares about them. The slugs are
 * permanent topic identities declared in `industry/topics.json`; adding a fifth is a config change plus
 * one row here, and nothing else on the page depends on the count.
 */
const TRACKS: Array<{ to: string; code: string; label: string; blurb: string; tone: string }> = [
  { to: "/topics/live", code: "LIVE", label: "Live 与活动", blurb: "新 Live、巡演、对盘、海外公演", tone: "text-accent" },
  { to: "/topics/ticket", code: "TICKET", label: "票务与抽选", blurb: "先行受理、抽选、一般贩售、追加席", tone: "text-hot" },
  { to: "/topics/release", code: "RELEASE", label: "发售与周边", blurb: "新碟、初回限定盘、店铺特典", tone: "text-accent" },
  { to: "/topics/notice", code: "NOTICE", label: "官方通知", blurb: "中止、延期、会场与日程变更", tone: "text-hot" },
];

/** The entry points to the tracking pages, as a hairline rail rather than a row of cards. */
export function TrackRail({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="追踪入口" className={`grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-4 ${className}`}>
      {TRACKS.map((t) => (
        <Link key={t.to} viewTransition to={t.to} className="group flex min-h-[86px] flex-col justify-between bg-surface p-3 transition-colors hover:bg-bg-sunk lg:min-h-[104px] lg:p-4">
          <span className={`font-mono text-[10.5px] font-semibold tracking-[0.12em] ${t.tone}`}>{t.code}</span>
          <span className="mt-2 block">
            <span className="flex items-center gap-1 text-[14.5px] font-bold text-ink lg:text-[15.5px]">
              {t.label}
              <IconArrowRight size={13} className="opacity-0 transition-opacity group-hover:opacity-60" />
            </span>
            <span className="mt-0.5 block text-[12px] leading-[1.5] text-ink-4">{t.blurb}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
