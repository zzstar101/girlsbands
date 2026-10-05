import { Link } from "react-router";
import type { HotStripEntry } from "@girlsbands/contracts/site";
import { IconArrowRight, IconMinus, IconTrendDown, IconTrendUp } from "../../components/icons";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { Faces } from "../hot/Faces";

// As on the original list: the top three in the ranking colours at the heaviest weight.
const RANK_COLOR = ["text-[15px] font-black text-rank-1", "text-[15px] font-black text-rank-2", "text-[15px] font-black text-rank-3"];

function hrefOf(e: HotStripEntry): string {
  return e.storyPublicId ? `/story/${e.storyPublicId}` : e.itemId ? `/items/${e.itemId}` : "/hot";
}

/** Where the heat is heading, as a small arrow (a "新" mark for a story new to the ranking). */
function TrendMark({ trend }: { trend: HotStripEntry["trend"] }) {
  if (trend === "up") return <IconTrendUp size={14} strokeWidth={2.2} className="text-hot" aria-label="热度上升" />;
  if (trend === "down") return <IconTrendDown size={14} strokeWidth={2.2} className="text-ink-4" aria-label="热度回落" />;
  if (trend === "new") return <span className="rounded-full bg-accent-soft px-1.5 text-[10.5px] font-semibold leading-4 text-accent">新</span>;
  if (trend === "unknown") return null; // sources behind on collection: no comparison to show
  return <IconMinus size={14} strokeWidth={2.2} className="text-ink-4" aria-label="热度持平" />;
}

/**
 * The top of the hot ranking, kept quiet and clearly below the tracking entry points: ranks and titles on
 * hairlines, then fixed-width columns so every row lines up — who is talking (精选组 faces, from sm),
 * "N 热度" and an arrow for where it is heading. Phones show the top three in one line each, so the feed
 * starts on the first screen. No glow and no card: heat is a number here, not a decoration.
 */
export function HotTopics({ entries }: { entries: HotStripEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="hot-topics" className="mb-5 lg:mb-7">
      <SectionHeader
        id="hot-topics"
        kicker="TRENDING"
        title="热议"
        aside={
          <Link to="/hot" className="group inline-flex items-center gap-1 transition-colors hover:text-accent">
            完整榜单 <IconArrowRight size={13} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        }
      />
      <ol className="hot-strip border-b border-line-soft">
        {entries.slice(0, 5).map((e, i) => (
          <li key={e.rank} className={`border-t border-line-soft ${i >= 3 ? "max-sm:hidden" : ""}`}>
            <Link viewTransition
              to={hrefOf(e)}
              className="group grid min-h-10 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 py-2 transition-colors hover:bg-bg-sunk/60 active:bg-bg-sunk sm:min-h-0 sm:grid-cols-[22px_minmax(0,1fr)_120px_64px_20px] sm:gap-x-4 dark:hover:bg-bg-muted/40"
            >
              <span className={`hot-rank rank-${e.rank} text-center leading-none`}>{e.rank}</span>
              <span className="line-clamp-1 min-w-0 text-[14.5px] font-semibold leading-[1.5] text-ink transition-colors group-hover:text-accent lg:text-[14px]">{e.title}</span>
              <span className="hot-faces hidden justify-end sm:flex">
                <Faces participants={e.participants} total={e.participantCount} size={20} interactive={false} />
              </span>
              <span className="hot-metrics flex items-center justify-end gap-2.5 sm:contents">
                <span className="whitespace-nowrap text-right text-[12.5px] text-ink-4" title="热度指数">
                  <span className="num text-[13.5px] font-semibold text-ink-2">{Math.round(e.heat)}</span> 热度
                </span>
                <span className="flex w-5 justify-center">
                  <TrendMark trend={e.trend} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
