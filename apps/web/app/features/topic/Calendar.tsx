// A subject's 日程: the same dated rows the deadline radar reads, laid out on a JST month grid so a fan
// can see a whole month at once — announcements, 发售日, 周边开订, 演出当天 — and take it away as an .ics.
// The grid is desktop; phones get the same days as a list, because seven columns do not fit a phone.
import { Link } from "react-router";
import type { CalendarResponse, DeadlineView } from "@girlsbands/contracts/site";
import { IconChevronLeft, IconChevronRight, IconDownload } from "../../components/icons";
import { DEADLINE_KINDS, md } from "../feed/deadlines";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** The JST day of an instant, as `YYYY-MM-DD` — computed, so the server and the browser agree. */
function jstDay(instant: string): string {
  return new Date(Date.parse(instant) + 9 * 3_600_000).toISOString().slice(0, 10);
}

function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5, 7))} 月`;
}

/** How many blank cells before the 1st (weeks start Monday) and how many days the month has. */
function monthGrid(month: string): { lead: number; days: number } {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return { lead: (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7, days: new Date(Date.UTC(year, m, 0)).getUTCDate() };
}

/** One dated row: a kind-coloured dot and the title, which opens the report that stated the date. */
function Event({ d }: { d: DeadlineView }) {
  const kind = DEADLINE_KINDS[d.kind];
  const time = d.localTime;
  return (
    <Link to={`/items/${d.itemId}`} prefetch="intent" title={`${kind.label}${d.note ? ` · ${d.note}` : ""} · ${d.title}`} className="group/event flex items-start gap-1.5">
      <span aria-hidden="true" className={`mt-[5px] size-1.5 flex-none rounded-full bg-current ${kind.className}`} />
      <span className="min-w-0 text-[11.5px] leading-[1.45] text-ink-2 transition-colors group-hover/event:text-accent">
        {time && <span className="mono mr-1 text-ink-4">{time}</span>}
        {d.title}
      </span>
    </Link>
  );
}

type MonthHref = (month: string) => string;

/** The month's own controls: jump a month either way, or subscribe to the whole thing. */
function Nav({ data, monthHref, icsHref }: { data: CalendarResponse; monthHref: MonthHref; icsHref: string }) {
  const at = data.months.indexOf(data.month);
  const prev = at > 0 ? data.months[at - 1] : null;
  const next = at >= 0 && at < data.months.length - 1 ? data.months[at + 1] : null;
  const arrow = "inline-flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink dark:hover:bg-bg-muted/60";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex items-baseline gap-x-3">
        <h2 id="topic-calendar" className="text-[16px] font-semibold text-ink">日程</h2>
        <span className="text-[12px] text-ink-4">共 {data.total} 个有日期的节点</span>
      </div>
      <div className="flex items-center gap-2">
        <a
          href={icsHref}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12.5px] text-ink-3 transition-colors hover:border-band hover:text-band"
          title="订阅后日历应用会自动更新（.ics）"
        >
          <IconDownload size={14} /> 订阅日历
        </a>
        <nav aria-label="切换月份" className="flex items-center">
          {prev ? (
            <Link to={monthHref(prev)} aria-label={`上个月 ${monthLabel(prev)}`} className={arrow}>
              <IconChevronLeft size={16} />
            </Link>
          ) : (
            <span aria-hidden="true" className={`${arrow} opacity-30`}><IconChevronLeft size={16} /></span>
          )}
          <span className="mono min-w-[96px] text-center text-[13px] font-semibold text-ink">{monthLabel(data.month)}</span>
          {next ? (
            <Link to={monthHref(next)} aria-label={`下个月 ${monthLabel(next)}`} className={arrow}>
              <IconChevronRight size={16} />
            </Link>
          ) : (
            <span aria-hidden="true" className={`${arrow} opacity-30`}><IconChevronRight size={16} /></span>
          )}
        </nav>
      </div>
    </div>
  );
}

export function MonthCalendar({ data, monthHref, icsHref, className = "" }: { data: CalendarResponse; monthHref: MonthHref; icsHref: string; className?: string }) {
  const byDay = new Map(data.days.map((d) => [d.date, d.items]));
  const { lead, days } = monthGrid(data.month);
  const today = jstDay(data.computedAt);
  const cells = Array.from({ length: lead + days }, (_, i) => i - lead + 1);
  return (
    <section className={className} aria-label={`${monthLabel(data.month)}的日程`}>
      <Nav data={data} monthHref={monthHref} icsHref={icsHref} />

      {data.total === 0 ? (
        <p className="mt-3 rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-4">这个月没有已公布的日期。</p>
      ) : (
        <>
          <div className="mt-3 hidden grid-cols-7 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid">
            {WEEKDAYS.map((w) => (
              <div key={w} className="bg-bg-sunk px-2 py-1.5 text-center text-[11.5px] font-semibold text-ink-4">{w}</div>
            ))}
            {cells.map((n, i) => {
              if (n < 1) return <div key={`blank-${i}`} className="min-h-[108px] bg-surface" />;
              const day = `${data.month}-${String(n).padStart(2, "0")}`;
              const items = byDay.get(day) ?? [];
              const isToday = day === today;
              return (
                <div key={day} className={`min-h-[108px] bg-surface p-1.5 ${isToday ? "ring-1 ring-inset ring-band/40" : ""}`}>
                  <span className={`num text-[12px] font-semibold ${items.length ? "text-ink" : "text-ink-4"} ${isToday ? "text-band" : ""}`}>{n}</span>
                  <ul className="mt-1 space-y-1">
                    {items.slice(0, 3).map((d, j) => (
                      <li key={`${d.itemId}-${d.kind}-${j}`} className="line-clamp-2">
                        <Event d={d} />
                      </li>
                    ))}
                  </ul>
                  {items.length > 3 && <span className="num mt-0.5 block text-[11px] text-ink-4">还有 {items.length - 3} 件</span>}
                </div>
              );
            })}
          </div>

          <ol className="card divide-y divide-line-soft overflow-hidden lg:hidden">
            {data.days.map((day) => (
              <li key={day.date} className="flex gap-3 px-4 py-2.5">
                <span className="mono w-[46px] flex-none pt-0.5 text-[12.5px] font-semibold text-ink-2">{md(day.date)}</span>
                <ul className="min-w-0 space-y-1.5">
                  {day.items.map((d, i) => (
                    <li key={`${d.itemId}-${d.kind}-${i}`}>
                      <Event d={d} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
