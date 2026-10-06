import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router";
import { DEADLINE_LABELS, type DeadlineKind, type DeadlineView, type HomeResponse, type TimelineCard } from "@girlsbands/contracts/site";
import { subjectOfId } from "./bands";
import { clockText, md } from "./deadlines";
import { Countdown, daysAway } from "./Ticket";

// 首页 hero 右半边（docs/design.md §细节）：四种放法先都做出来比较——海报墙、下一场大票、本周歌单、五周月历。
// 全部只用首页已经拿到的数据：时间线卡片（封面、分数）和 30 天日程。

type Mode = "wall" | "ticket" | "setlist" | "cal";
const MODES: Array<[Mode, string]> = [["wall", "海报墙"], ["ticket", "大票"], ["setlist", "歌单"], ["cal", "月历"]];

const bandOf = (subjects: string[]) => subjects.map(subjectOfId).find((s) => s?.kind === "band") ?? subjects.map(subjectOfId).find(Boolean) ?? null;
const accent = (subjects: string[]) => bandOf(subjects)?.accent ?? "var(--pink)";
const WEEK = ["一", "二", "三", "四", "五", "六", "日"];
const weekday = (day: string) => WEEK[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];

/** 1 海报墙：最近几条新闻的官方封面，像演出海报一样用胶带斜贴。
 * 每张按原图比例贴，不裁成竖版。位置按横竖分：竖图贴在左边和中间的大位置，横图叠在右侧，每张都露得出来。
 * 接口没给尺寸的图，等加载完用 naturalWidth/Height 补上（先按 3:4 占位）。 */
type Slot = { x: string; top: number; w: number; rot: number; z: number };
const TALL: Slot[] = [
  { x: "left: 0", top: 18, w: 34, rot: -4, z: 2 },
  { x: "left: 25%", top: 40, w: 32, rot: 2, z: 3 },
  { x: "left: 13%", top: 0, w: 27, rot: -1, z: 1 },
];
const WIDE: Slot[] = [
  { x: "right: 0", top: 0, w: 46, rot: 3, z: 2 },
  { x: "right: 5%", top: 108, w: 45, rot: -2.5, z: 4 },
  { x: "right: 0", top: 214, w: 46, rot: 1.5, z: 5 },
];
function PosterWall({ cards }: { cards: TimelineCard[] }) {
  const posters = cards.filter((c) => c.item.cover).slice(0, 5);
  const [loaded, setLoaded] = useState<Record<string, number>>({});
  // 图可能在页面接管前就加载完了（onLoad 不会再触发），所以挂载时也量一次
  const measure = (id: string, im: HTMLImageElement) => {
    if (!im.naturalWidth || !im.naturalHeight) return;
    const r = im.naturalWidth / im.naturalHeight;
    setLoaded((m) => (Math.abs((m[id] ?? 0) - r) < 0.01 ? m : { ...m, [id]: r }));
  };
  if (!posters.length) return <p className="hs-empty">最近没有带图的消息。</p>;
  const ars = posters.map(({ item }) => {
    const c = item.cover!;
    return Math.min(2, Math.max(0.5, loaded[item.id] ?? (c.width && c.height ? c.width / c.height : 3 / 4)));
  });
  // 横竖各自按顺序占位；某一类超过 3 张就去占另一类剩下的位置
  const tall = [...TALL], wide = [...WIDE];
  const slots = ars.map((ar) => (ar > 1.1 ? wide.shift() ?? tall.shift() : tall.shift() ?? wide.shift())!);
  return <div className="hs-wall">
    {posters.map(({ item }, i) => {
      const c = item.cover!, ar = ars[i]!, sl = slots[i]!;
      const [side, pos] = sl.x.split(": ") as ["left" | "right", string];
      return <Link key={item.id} to={`/items/${item.id}`} className={`poster-slot${ar > 1.1 ? " wide" : ""}`} title={item.title}
        style={{ "--c": accent(item.subjects), "--ar": ar, "--rot": `${sl.rot}deg`, "--z": sl.z, [side]: pos, top: sl.top, width: `${sl.w}%` } as CSSProperties}>
        <img src={c.url} srcSet={c.srcSet} sizes="240px" alt="" loading="lazy"
          ref={(im) => { if (im?.complete) measure(item.id, im); }} onLoad={(e) => measure(item.id, e.currentTarget)} />
        <span className="poster-cap"><b>{bandOf(item.subjects)?.label}</b>{item.title}</span>
      </Link>;
    })}
  </div>;
}

/** 2 下一场大票：30 天内最近的一场演出（没有演出就拿最近的日程），做成一张大门票。 */
function BigTicket({ home }: { home: HomeResponse }) {
  const all = home.deadlines.days.flatMap((d) => d.items);
  const item = all.find((d) => d.kind === "event") ?? all[0];
  if (!item) return <p className="hs-empty">未来 30 天暂无已收录日程。</p>;
  const band = bandOf(item.subjects);
  const left = daysAway(item.day, home.deadlines.from);
  return <Link to={`/items/${item.itemId}`} className="hs-ticket" style={{ "--c": band?.accent ?? "var(--pink)" } as CSSProperties}>
    <div className="bt-main">
      <div className="bt-top"><span>ADMIT ONE</span><span>{DEADLINE_LABELS[item.kind].label}</span><span>NO. {item.itemId.slice(0, 6).toUpperCase()}</span></div>
      <div className="bt-band">{band?.label ?? "LIVE"}</div>
      <div className="bt-title">{item.title}</div>
      <div className="bt-when"><span className="bt-date">{md(item.day)}</span><span className="bt-wd">{weekday(item.day)}<br />{clockText(item.localTime, item.timezone)}</span></div>
      <Countdown at={item.at} timezone={item.timezone} from={home.deadlines.from} flip />
      <span className="bt-code" aria-hidden="true" />
    </div>
    <div className="bt-stub"><span className="d">{left === 0 ? "TODAY" : "D-"}</span>{left > 0 && <span className="n">{left}</span>}<span className="meta">NEXT LIVE</span></div>
  </Link>;
}

/** 3 本周歌单：分数最高的几条，写成贴在墙上的 setlist；最后一条当安可。 */
function Setlist({ cards, today }: { cards: TimelineCard[]; today: string }) {
  const songs = [...cards].sort((a, b) => (b.item.score ?? 0) - (a.item.score ?? 0)).slice(0, 7);
  if (!songs.length) return <p className="hs-empty">这周还没有消息。</p>;
  return <div className="hs-setlist">
    <span className="tape" aria-hidden="true" />
    <div className="sl-head"><span>SETLIST</span><span className="mono">{today.slice(5).replace("-", ".")}</span></div>
    <ol>{songs.map(({ item }, i) => {
      const encore = i === songs.length - 1 && songs.length > 3;
      return <li key={item.id} className={encore ? "encore" : ""} style={{ "--c": accent(item.subjects) } as CSSProperties}>
        <span className="no">{encore ? "EN" : String(i + 1).padStart(2, "0")}</span>
        <Link to={`/items/${item.id}`}>{item.title}</Link>
      </li>;
    })}</ol>
  </div>;
}

const TONE: Partial<Record<DeadlineKind, string>> = { event: "ev", sale_start: "sale", release_start: "sale", merch_start: "sale", lottery_end: "due", sale_end: "due", payment_deadline: "due", stream_end: "due" };

/** 4 五周月历：从本周一起五周，有日程的日子按类型打点，悬停列出当天的事。 */
function MonthCal({ home }: { home: HomeResponse }) {
  const byDay = new Map(home.deadlines.days.map((d) => [d.date, d.items]));
  const today = home.deadlines.from;
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const monday = t0 - ((new Date(t0).getUTCDay() + 6) % 7) * 86_400_000;
  const days = Array.from({ length: 35 }, (_, i) => new Date(monday + i * 86_400_000).toISOString().slice(0, 10));
  const [open, setOpen] = useState<string | null>(null);
  const shown = open ?? days.find((d) => d >= today && byDay.has(d)) ?? null;
  return <div className="hs-cal">
    <div className="cal-grid" onMouseLeave={() => setOpen(null)}>
      {WEEK.map((w) => <span key={w} className="cal-wd">{w}</span>)}
      {days.map((d) => {
        const items: DeadlineView[] = byDay.get(d) ?? [];
        const first = d.endsWith("-01");
        return <button type="button" key={d} className={`cal-day ${d === today ? "today" : ""} ${d < today ? "past" : ""} ${d === shown ? "on" : ""} ${items.length ? "has" : ""}`}
          onMouseEnter={() => items.length && setOpen(d)} onFocus={() => items.length && setOpen(d)} disabled={!items.length}>
          <span className="cal-n">{first ? `${Number(d.slice(5, 7))}月` : Number(d.slice(8))}</span>
          <span className="cal-dots">{items.slice(0, 4).map((it, i) => <i key={i} className={TONE[it.kind] ?? "etc"} style={{ "--c": accent(it.subjects) } as CSSProperties} />)}</span>
        </button>;
      })}
    </div>
    <div className="cal-detail">
      {shown ? <>
        <div className="cal-when"><b>{md(shown)}</b> 周{weekday(shown)}</div>
        <ul>{(byDay.get(shown) ?? []).slice(0, 3).map((it, i) => <li key={i}><Link to={`/items/${it.itemId}`}><span className={`k ${TONE[it.kind] ?? "etc"}`}>{DEADLINE_LABELS[it.kind].label}</span>{it.title}</Link></li>)}</ul>
      </> : <p className="hs-empty">五周内暂无日程。</p>}
      <div className="cal-legend"><span><i className="ev" />演出</span><span><i className="sale" />开卖/发售</span><span><i className="due" />截止</span><Link to="/deadlines">全部日程 →</Link></div>
    </div>
  </div>;
}

// 四种每次打开随机一种（不和上次一样）；服务端先渲染海报墙并藏着，浏览器接管后抽好再淡入，避免闪一下。
const SIDE_KEY = "gb:hero-side";
export function HeroSide({ home, cards }: { home: HomeResponse; cards: TimelineCard[] }) {
  const [params] = useSearchParams();
  const forced = MODES.find(([m]) => m === params.get("hero"))?.[0];
  const [mode, setMode] = useState<Mode | null>(forced ?? null);
  const picked = useRef(false); // 开发模式下 effect 会跑两次，只抽一次，否则「不和上次一样」会失效
  useEffect(() => {
    if (forced || picked.current) return;
    picked.current = true;
    let last: string | null = null;
    try { last = localStorage.getItem(SIDE_KEY); } catch { /* 隐私模式 */ }
    const pool = MODES.map(([m]) => m).filter((m) => m !== last);
    const m = pool[Math.floor(Math.random() * pool.length)]!;
    try { localStorage.setItem(SIDE_KEY, m); } catch { /* 隐私模式 */ }
    setMode(m);
  }, [forced]);
  const shown = mode ?? "wall";
  return <section className={`hero-side is-${shown}${mode === null ? " is-pending" : ""}`}>
    <div className="hs-tabs" role="group" aria-label="换一种看法">{MODES.map(([m, label]) => <button key={m} type="button" aria-pressed={m === shown} onClick={() => setMode(m)}>{label}</button>)}</div>
    {shown === "wall" && <PosterWall cards={cards} />}
    {shown === "ticket" && <BigTicket home={home} />}
    {shown === "setlist" && <Setlist cards={cards} today={home.today} />}
    {shown === "cal" && <MonthCal home={home} />}
  </section>;
}
