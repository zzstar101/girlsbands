import type { ReactNode } from "react";

export function SectionHeader({ kicker, title, count, aside, id, className = "" }: { kicker?: string; title: string; count?: number | string; aside?: ReactNode; id?: string; className?: string }) {
  return <div className={`section-head ${className}`}>
    <h2 id={id}>{title}{count != null && <span className="ml-2 text-[13px] text-ink-4">{count}</span>}</h2>
    {kicker && <span className="en">{kicker}</span>}<span className="rule" aria-hidden="true" />
    {aside && <div className="aside-link">{aside}</div>}
  </div>;
}
