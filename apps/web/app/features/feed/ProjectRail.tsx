import { Link } from "react-router";
import { FRANCHISES, seriesOf } from "@girlsbands/industry/taxonomy";
import { IconArrowRight } from "../../components/icons";
import { subjectOfId } from "./bands";

/**
 * The three franchises the site covers, above the tracking rail. Each card is that project's page, which
 * carries its bands' news as well, so this is the first thing a reader who follows one series taps.
 * The band count comes from the series definition in `industry/taxonomy.ts`, never from a hand-kept list.
 */
export function ProjectRail({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="企划入口" className={`grid grid-cols-1 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3 ${className}`}>
      {FRANCHISES.map((id) => {
        // SERIES only ever names entities, so the lookup cannot miss.
        const subject = subjectOfId(id)!;
        const bands = seriesOf(id).filter((member) => subjectOfId(member)?.kind === "band").length;
        return (
          <Link key={id} viewTransition to={`/topics/${id}`} className="group flex flex-col justify-between bg-surface p-3 transition-colors hover:bg-bg-sunk lg:p-4">
            <span className="flex items-center justify-between">
              <span className="block h-[3px] w-8 rounded-full" style={{ background: subject.accent ?? undefined }} />
              <span className="font-mono text-[10.5px] font-semibold tracking-[0.12em] text-ink-4">{bands} BANDS</span>
            </span>
            <span className="mt-3 block">
              <span className="flex items-center gap-1 text-[15px] font-bold text-ink lg:text-[16.5px]">
                {subject.label}
                <IconArrowRight size={13} className="opacity-0 transition-opacity group-hover:opacity-60" />
              </span>
              <span className="mt-0.5 block text-[12px] leading-[1.5] text-ink-4">企划与旗下乐队的全部动态</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
