import { useId } from "react";

export function IssueSeal({ day }: { day: string }) {
  const id = useId();
  return <svg className="issue-seal" viewBox="0 0 140 140" aria-hidden="true">
    <defs><path id={id} d="M70 12a58 58 0 1 1-.01 0" /></defs>
    <g className="seal-ring"><text><textPath href={`#${id}`} textLength="354">GIRLSBANDS · 少女乐队's · GIRLSBANDS · 少女乐队's · </textPath></text></g>
    <text x="70" y="72" textAnchor="middle" className="seal-date">{day.slice(5).replace('-', '.')}</text><text x="70" y="92" textAnchor="middle" className="seal-label">ISSUE</text>
  </svg>;
}
