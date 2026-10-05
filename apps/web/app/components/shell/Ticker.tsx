import { Link } from "react-router";
import type { DeadlineView } from "@girlsbands/contracts/site";
import { DEADLINE_LABELS } from "@girlsbands/contracts/site";
import { clock, md } from "../../features/feed/deadlines";

export function Ticker({ items }: { items: DeadlineView[] }) {
  if (!items.length) return null;
  const rows = items.slice(0, 8);
  return <div className="ticker" aria-label="近期日程，日本时间"><span className="ticker-label">NEXT <i /></span><div className="ticker-inner">
    {[0, 1].map((copy) => <div className="ticker-row" key={copy} aria-hidden={copy === 1 || undefined}>{rows.map((d, i) => copy === 0
      ? <Link key={i} to={`/items/${d.itemId}`}><b>{md(d.day)} {clock(d.at)} JST</b> · {DEADLINE_LABELS[d.kind].label} · {d.title}</Link>
      : <span key={i}><b>{md(d.day)} {clock(d.at)} JST</b> · {DEADLINE_LABELS[d.kind].label} · {d.title}</span>)}</div>)}
  </div></div>;
}
