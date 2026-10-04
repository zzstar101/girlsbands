import type { ReactNode } from "react";

/**
 * A section of the page, announced the way a magazine announces a column: a tracked-out kicker, a
 * strong title, an optional count or link on the right, and a hairline that closes the header instead
 * of a card. Sections are ranked by the order they appear in, so the header stays this quiet.
 */
export function SectionHeader({ kicker, title, count, aside, id, className = "" }: { kicker?: string; title: string; count?: number | string; aside?: ReactNode; id?: string; className?: string }) {
  return (
    <div className={`flex items-end gap-3 border-b border-line pb-2 ${className}`}>
      <div className="min-w-0 flex-1">
        {kicker && <p className="meta uppercase">{kicker}</p>}
        <h2 id={id} className="mt-1 text-[19px] font-bold leading-tight tracking-[-0.01em] text-ink">
          {title}
          {count != null && <span className="num ml-2 text-[13px] font-semibold text-ink-4">{count}</span>}
        </h2>
      </div>
      {aside && <div className="flex-none pb-0.5 text-[13px] text-ink-3">{aside}</div>}
    </div>
  );
}
