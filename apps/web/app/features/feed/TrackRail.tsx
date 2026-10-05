import { Link } from "react-router";

const TRACKS = [
  { key: 'live', code: 'LIVE', label: '演出', blurb: '新公演、巡演、对盘与海外场' },
  { key: 'ticket', code: 'TICKET', label: '票务', blurb: '先行受理、抽选、一般发售、追加席' },
  { key: 'release', code: 'RELEASE', label: '发售与周边', blurb: 'CD、BD、店铺特典与周边' },
  { key: 'notice', code: 'NOTICE', label: '变更通知', blurb: '延期、中止与会场变更' },
];
export function TrackRail({ className = "", counts }: { className?: string; counts?: Record<string, number> }) {
  return <nav aria-label="追踪入口" className={`tracks ${className}`}>{TRACKS.map((t) => <Link key={t.key} to={`/topics/${t.key}`} className={`track ${t.key === 'ticket' ? 'act' : ''}`}>
    <span className="code">{t.code}</span>{counts && <span className="new" title="近七天消息数">{counts[t.key] ?? 0}</span>}
    <span><span className="label">{t.label}</span><span className="blurb block">{t.blurb}</span></span>
  </Link>)}</nav>;
}
