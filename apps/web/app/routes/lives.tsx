// Live 板块：接下来要办的演出。上面一张月历（演出那天点上乐队色），下面按日期排的场次列表；
// 顶上一排乐队 logo 筛选，跟声优日常一样。只放演出当天 —— 抽选、发售在截止雷达和「全部日程」。
import type { CSSProperties } from "react";
import type { LiveCalendarResponse, LiveEventSummary } from "@girlsbands/contracts/site";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/lives";
import { edgeTtl, loadOr404 } from "../lib/api.server";
import { listPath, pageMeta } from "../lib/seo";
import { monthDay, weekdayShort } from "../lib/format";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { BandFilter } from "../components/ui/BandFilter";
import { Badge } from "../components/ui/Badge";
import { CoverImage } from "../components/ui/CoverImage";
import { EmptyState } from "../components/ui/Page";
import { IconChevronLeft, IconChevronRight } from "../components/icons";
import { LIVE_STAGES, openStage } from "../features/feed/lives";
import { LiveSwitch } from "../features/live/LiveSwitch";

export const handle: Screen = { tab: "live", name: "Live" };

export function headers() {
  return edgeTtl(300);
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function readQuery(params: URLSearchParams) {
  const band = params.get("band")?.trim() || null;
  const month = params.get("month")?.trim() || null;
  return { band: band && ENTITIES[band] ? band : null, month: month && MONTH.test(month) ? month : null };
}

function href(q: { band: string | null; month: string | null }) {
  return listPath("/live", { band: q.band, month: q.month });
}

export async function loader({ request }: Route.LoaderArgs) {
  const q = readQuery(new URL(request.url).searchParams);
  return await loadOr404<LiveCalendarResponse>(listPath("/api/site/lives", q), { signal: request.signal });
}

export function meta({ loaderData, location }: Route.MetaArgs) {
  const band = loaderData?.band ? ENTITIES[loaderData.band]?.name : null;
  const params = new URLSearchParams(location.search);
  return pageMeta({
    title: band ? `${band} 的 Live 日程` : "Live 日程",
    description: "少女乐队们接下来要办的演出：月历一眼看完，按日期列出会场、开演时间和购票进度。",
    path: "/live",
    noindex: params.has("band") || params.has("month"),
  });
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5, 7))} 月`;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function accentOf(subject: string): string {
  return ENTITIES[subject]?.accent ?? "var(--accent)";
}

function shortName(subject: string, fallback: string): string {
  return ENTITIES[subject]?.displayTag ?? ENTITIES[subject]?.name ?? fallback;
}

/** 一场演出占的日子（多日场每天都算）。 */
function daysOf(live: LiveEventSummary): string[] {
  const out: string[] = [];
  const end = live.endsOn && live.endsOn > live.startsOn ? live.endsOn : live.startsOn;
  for (let d = live.startsOn; d <= end && out.length < 62; ) {
    out.push(d);
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    d = t.toISOString().slice(0, 10);
  }
  return out;
}

function dateText(live: LiveEventSummary): string {
  const start = `${monthDay(live.startsOn)}（${weekdayShort(live.startsOn)}）`;
  if (!live.endsOn || live.endsOn === live.startsOn) return start;
  return `${start} – ${monthDay(live.endsOn)}（${weekdayShort(live.endsOn)}）`;
}

/** 月历：七列，演出那天放乐队色的点（宽屏写乐队名）。点一天跳到下面那一场。 */
function MonthGrid({ data, q }: { data: LiveCalendarResponse; q: { band: string | null } }) {
  const month = data.month;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = new Map<string, LiveEventSummary[]>();
  for (const live of data.lives) for (const day of daysOf(live)) if (day.startsWith(month)) byDay.set(day, [...(byDay.get(day) ?? []), live]);
  const upcoming = new Set(data.upcoming.map((l) => l.publicId));
  const arrow = "inline-flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink";
  return (
    <section aria-labelledby="live-month" className="card mb-5 p-3 sm:p-4 lg:p-5">
      <div className="mb-3 flex items-center justify-between">
        <Link to={href({ band: q.band, month: shiftMonth(month, -1) })} replace preventScrollReset aria-label="上个月" className={arrow}><IconChevronLeft size={18} /></Link>
        <h2 id="live-month" className="num text-[16px] font-semibold text-ink">{monthLabel(month)}</h2>
        <Link to={href({ band: q.band, month: shiftMonth(month, 1) })} replace preventScrollReset aria-label="下个月" className={arrow}><IconChevronRight size={18} /></Link>
      </div>
      <div className="grid grid-cols-7 text-center text-[11.5px] text-ink-4">
        {WEEKDAYS.map((w, i) => <div key={w} className={`pb-1.5 ${i >= 5 ? "text-accent" : ""}`}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-line-soft bg-[var(--line-soft)]">
        {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} className="bg-[var(--surface)]" />)}
        {Array.from({ length: total }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, "0")}`;
          const lives = byDay.get(day) ?? [];
          const isToday = day === data.today;
          const past = day < data.today;
          const first = lives[0];
          const target = first ? (upcoming.has(first.publicId) ? `#live-${first.publicId}` : `/live/${first.publicId}`) : null;
          const cell = (
            <>
              <span className={`num inline-flex size-6 items-center justify-center rounded-full text-[12.5px] ${isToday ? "bg-accent font-bold text-white" : past ? "text-ink-4" : "text-ink-2"}`}>{i + 1}</span>
              {lives.length > 0 && (
                <>
                  <span className="mt-1 flex flex-wrap justify-center gap-[3px] lg:hidden">
                    {lives.slice(0, 4).map((l) => <span key={l.publicId} className="size-[7px] rounded-full" style={{ background: accentOf(l.subject) }} />)}
                  </span>
                  <span className="mt-1 hidden w-full flex-col gap-[3px] lg:flex">
                    {lives.slice(0, 3).map((l) => (
                      <span key={l.publicId} className="truncate rounded-sm px-1 py-px text-left text-[11px] font-semibold leading-[1.35] text-white"
                        style={{ background: accentOf(l.subject) }} title={l.title}>
                        {shortName(l.subject, l.subjectName)}
                      </span>
                    ))}
                    {lives.length > 3 && <span className="text-[10.5px] text-ink-4">+{lives.length - 3}</span>}
                  </span>
                </>
              )}
            </>
          );
          const base = `flex min-h-[44px] flex-col items-center bg-[var(--surface)] px-0.5 py-1 lg:min-h-[84px] lg:items-start lg:px-1.5 ${past ? "opacity-60" : ""}`;
          return target
            ? target.startsWith("#")
              ? <a key={day} href={target} className={`${base} transition-colors hover:bg-bg-sunk`} title={lives.map((l) => l.title).join("\n")}>{cell}</a>
              : <Link key={day} to={target} prefetch="intent" className={`${base} transition-colors hover:bg-bg-sunk`} title={lives.map((l) => l.title).join("\n")}>{cell}</Link>
            : <div key={day} className={base}>{cell}</div>;
        })}
        {Array.from({ length: (7 - ((lead + total) % 7)) % 7 }, (_, i) => <div key={`a${i}`} className="bg-[var(--surface)]" />)}
      </div>
    </section>
  );
}

/** 一场演出：日期块 + 封面 + 名字、会场、开演、阶段。 */
function LiveRow({ live }: { live: LiveEventSummary }) {
  const stage = LIVE_STAGES[live.stage];
  const accent = accentOf(live.subject);
  return (
    <li id={`live-${live.publicId}`} className="scroll-mt-20">
      <Link viewTransition to={`/live/${live.publicId}`} prefetch="intent"
        className="group flex items-stretch gap-3 px-3 py-3 transition-colors hover:bg-bg-sunk sm:px-4"
        style={{ "--band": accent } as CSSProperties}>
        <div className="flex w-[52px] shrink-0 flex-col items-center justify-center border-l-[3px] pl-1 text-center" style={{ borderColor: accent }}>
          <span className="num text-[11px] leading-none text-ink-4">{Number(live.startsOn.slice(5, 7))} 月</span>
          <span className="num mt-0.5 text-[22px] font-bold leading-none text-ink">{Number(live.startsOn.slice(8, 10))}</span>
          <span className="mt-0.5 text-[11px] leading-none text-ink-4">{weekdayShort(live.startsOn)}</span>
        </div>
        <CoverImage cover={live.cover} sizes="96px" className="hidden h-[54px] w-[96px] shrink-0 self-center rounded object-cover sm:block" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="font-semibold" style={{ color: accent }}>{live.subjectName}</span>
            <Badge tone={stage.tone}>{stage.label}</Badge>
            {openStage(live.stage) && live.daysLeft !== null && live.daysLeft > 0 && <span className="num text-ink-4">D-{live.daysLeft}</span>}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[14.5px] font-[650] leading-snug text-ink transition-colors group-hover:text-accent">{live.title}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[12.5px] text-ink-3">
            <span className="num">{dateText(live)}{live.startsTime ? ` ${live.startsTime} 开演` : ""}</span>
            {live.venue && <span className="min-w-0 truncate">{live.venue}</span>}
          </div>
        </div>
      </Link>
    </li>
  );
}

export default function LivesRoute() {
  const data = useLoaderData<typeof loader>();
  const q = { band: data.band, month: null as string | null };
  const active = data.band ?? "all";
  const band = data.band ? ENTITIES[data.band] : null;
  return (
    <div className="pb-8">
      <PhoneBar title="Live" />
      <header className="pb-3 pt-3 lg:pt-1">
        <LiveSwitch active="live" />
        <h1 data-page-title="" className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">
          {band ? `${band.name} 的 Live` : "Live 日程"}
        </h1>
        <p className="mt-1.5 max-w-[760px] text-pretty text-[13.5px] leading-relaxed text-ink-3">
          接下来要办的演出，按日期排。抽选和发售看<Link to="/deadlines" className="text-accent hover:text-accent-ink">截止雷达</Link>，
          全部节点、订阅日历看<Link to="/calendar" className="text-accent hover:text-accent-ink">全部日程</Link>。
        </p>
      </header>
      <div className="mb-4">
        <BandFilter bands={data.bands} active={active} hrefOf={(b) => href({ band: b, month: null })} label="按乐队看演出" />
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="lg:sticky lg:top-4">
          <MonthGrid data={data} q={q} />
        </div>
        <section aria-labelledby="live-upcoming">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="live-upcoming" className="text-[16px] font-semibold text-ink">接下来的演出</h2>
            <span className="text-[12px] text-ink-4">{data.upcoming.length} 场</span>
          </div>
          {data.upcoming.length > 0
            ? <ol className="card divide-y divide-line-soft overflow-hidden">{data.upcoming.map((l) => <LiveRow key={l.publicId} live={l} />)}</ol>
            : <div className="card"><EmptyState title="暂时没有已公布日期的演出">新消息一出来就会排进来。</EmptyState></div>}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
            <Link to={data.band ? `/topics/${data.band}` : "/topics/live"} className="text-accent hover:text-accent-ink">Live 相关新闻 →</Link>
            <Link to="/calendar" className="text-ink-3 hover:text-ink">全部日程（含 .ics 订阅）→</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
