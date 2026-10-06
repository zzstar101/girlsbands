import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { DEADLINE_LABELS, TIMEZONE_OFFSETS, type DeadlineView, type Timezone } from "@girlsbands/contracts/site";
import { FanOnlyBadge } from "../../components/ui/FanOnlyBadge";
import { subjectOfId } from "./bands";
import { clockText, md } from "./deadlines";

export function daysAway(day: string, from: string) {
  return Math.max(0, Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
}

/** Split-flap digits: each character is keyed by its value, so a change remounts the tile and replays the flip. */
function Flaps({ text }: { text: string }) {
  return <>{[...text].map((ch, i) => <b key={`${i}-${ch}`} className="flap">{ch}</b>)}</>;
}

export function Countdown({ at, timezone, from, flip = false }: { at: string; timezone: Timezone; from: string; flip?: boolean }) {
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
  const seconds = Math.max(0, Math.floor((Date.parse(`${at}:00${TIMEZONE_OFFSETS[timezone]}`) - now) / 1000));
  if (!seconds) return <span className="countdown">已到时间</span>;
  const [hh, mm, ss] = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60].map((n) => String(n).padStart(2, '0'));
  if (flip) return <span className="countdown flip" role="timer" aria-label={`距离日程时间 ${Math.floor(seconds / 86400)}天 ${hh}:${mm}:${ss}`}><span aria-hidden="true">{Math.floor(seconds / 86400)}天 <Flaps text={hh} /><i>:</i><Flaps text={mm} /><i>:</i><span className="seconds"><Flaps text={ss} /></span></span></span>;
  return <span className="countdown" aria-label="距离日程时间">{Math.floor(seconds / 86400)}天 {hh}:{mm}:<span className="seconds">{ss}</span></span>;
}

export function Ticket({ item, from }: { item: DeadlineView; from: string }) {
  const band = item.subjects.map(subjectOfId).find((s) => s?.kind === 'band') ?? item.subjects.map(subjectOfId).find(Boolean);
  const closing = item.kind === 'lottery_end' || item.kind === 'stream_end';
  return <Link to={`/items/${item.itemId}`} className={`ticket ${item.soon ? 'soon' : ''}`} style={{ '--c': band?.accent ?? 'var(--pink)' } as CSSProperties}>
    <div className="t-main"><div className="t-top"><span className={`kind ${closing ? 'act' : ''}`}>{DEADLINE_LABELS[item.kind].label}</span><FanOnlyBadge organizer={item.organizer} /><span className="band">{band?.label}</span></div>
      <div className="t-title">{item.title}</div><div className="t-when mono">{md(item.day)} {clockText(item.localTime, item.timezone)}</div><Countdown at={item.at} timezone={item.timezone} from={from} flip />
      <span className="punch" aria-hidden="true">入場</span>
    </div><div className="t-stub"><span className="d">D-</span><span className="n">{daysAway(item.day, from)}</span><span className="meta">{item.soon ? '48 小时内' : '天后'}</span></div>
  </Link>;
}
