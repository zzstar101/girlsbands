import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { DEADLINE_LABELS, type DeadlineView } from "@girlsbands/contracts/site";
import { subjectOfId } from "./bands";
import { clock, md } from "./deadlines";

export function daysAway(day: string, from: string) {
  return Math.max(0, Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
}

export function Countdown({ at, from }: { at: string; from: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (at.length === 10) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number | undefined;
    const update = () => {
      window.clearInterval(timer);
      if (query.matches) setNow(null);
      else { setNow(Date.now()); timer = window.setInterval(() => setNow(Date.now()), 1000); }
    };
    update(); query.addEventListener('change', update);
    return () => { window.clearInterval(timer); query.removeEventListener('change', update); };
  }, [at]);
  if (at.length === 10 || now === null) return <span className="countdown">{daysAway(at.slice(0, 10), from) === 0 ? (at.length === 10 ? '今天 · 原文未注明时刻' : '今天') : `剩 ${daysAway(at.slice(0, 10), from)} 天`}</span>;
  const seconds = Math.max(0, Math.floor((Date.parse(`${at}:00+09:00`) - now) / 1000));
  if (!seconds) return <span className="countdown">已到时间</span>;
  return <span className="countdown" aria-label="距离日程时间">{Math.floor(seconds / 86400)}天 {String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:{String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:<span className="seconds">{String(seconds % 60).padStart(2, '0')}</span></span>;
}

export function Ticket({ item, from }: { item: DeadlineView; from: string }) {
  const band = item.subjects.map(subjectOfId).find((s) => s?.kind === 'band') ?? item.subjects.map(subjectOfId).find(Boolean);
  const closing = item.kind === 'lottery_end' || item.kind === 'stream_end';
  return <Link to={`/items/${item.itemId}`} className={`ticket ${item.soon ? 'soon' : ''}`} style={{ '--c': band?.accent ?? 'var(--pink)' } as CSSProperties}>
    <div className="t-main"><div className="t-top"><span className={`kind ${closing ? 'act' : ''}`}>{DEADLINE_LABELS[item.kind].label}</span><span className="band">{band?.label}</span></div>
      <div className="t-title">{item.title}</div><div className="t-when mono">{md(item.day)} {clock(item.at) ?? '全天'} JST</div><Countdown at={item.at} from={from} />
    </div><div className="t-stub"><span className="d">D-</span><span className="n">{daysAway(item.day, from)}</span><span className="meta">{item.soon ? '48 小时内' : '天后'}</span></div>
  </Link>;
}
