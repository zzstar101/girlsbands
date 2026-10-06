// 日历: one month of dated points for a project or one of its bands. The topic pages carry the same
// calendar next to their news; this page is only the calendar, with a switch between projects and bands,
// because a reader who opens 日历 wants dates, not another news list.
import type { ReactNode } from "react";
import { Link, useLoaderData } from "react-router";
import type { CalendarResponse } from "@girlsbands/contracts/site";
import { ENTITIES, FRANCHISES, seriesKeyOf, seriesOf } from "@girlsbands/industry/taxonomy";
import type { Route } from "./+types/calendar";
import { edgeTtl, loadOr404 } from "../lib/api.server";
import { pageMeta, titled } from "../lib/seo";
import { subjectOfId } from "../features/feed/bands";
import { MonthCalendar, eventAccent } from "../features/topic/Calendar";
import { PhoneBar } from "../components/shell/PhoneBar";
import { IconCalendar } from "../components/icons";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { home: "ticket", name: "日历" };

const DEFAULT_SUBJECT = FRANCHISES[0]!;

function href(subject: string, month?: string | null): string {
  const sp = new URLSearchParams();
  if (subject !== DEFAULT_SUBJECT) sp.set("subject", subject);
  if (month) sp.set("month", month);
  const q = sp.toString();
  return `/calendar${q ? `?${q}` : ""}`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const subject = url.searchParams.get("subject")?.trim() || DEFAULT_SUBJECT;
  const month = url.searchParams.get("month");
  const calendar = await loadOr404<CalendarResponse>(
    `/api/site/calendar/${encodeURIComponent(subject)}${month ? `?month=${encodeURIComponent(month)}` : ""}`,
    { signal: request.signal },
  );
  return { calendar, subject, month };
}

export function headers() {
  return edgeTtl(300);
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: titled("日历") }, { name: "robots", content: "noindex" }];
  const name = subjectOfId(loaderData.subject)?.label ?? loaderData.subject;
  return pageMeta({
    title: `${name} 日历`,
    description: `${name}一个月内的演出、发售、抽选与截止日期，按月份排在日历上，可订阅到自己的日历应用。`,
    path: href(loaderData.subject, loaderData.month),
    // The default view is the canonical one; other subjects and months are the same rows filtered.
    noindex: Boolean(loaderData.month) || loaderData.subject !== DEFAULT_SUBJECT,
  });
}

function Chip({ to, active, accent, children }: { to: string; active: boolean; accent?: string | null; children: ReactNode }) {
  return (
    <Link
      to={to}
      preventScrollReset
      aria-current={active ? "true" : undefined}
      style={active && accent ? { backgroundColor: accent, borderColor: accent } : !active && accent ? { borderLeftColor: accent } : undefined}
      className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
        active ? "border-band bg-band text-white" : `border-line text-ink-3 hover:text-ink ${accent ? "border-l-[3px]" : ""}`
      }`}
    >
      {children}
    </Link>
  );
}

export default function CalendarPage() {
  const { calendar, subject } = useLoaderData<typeof loader>();
  const project = seriesKeyOf(subject) ?? subject;
  const bands = seriesOf(project).filter((id) => id !== project && ENTITIES[id]?.kind === "band");
  const current = subjectOfId(subject);
  // Who shows up this month, for the legend: the colours on the grid are theirs.
  const present = new Map<string, number>();
  for (const day of calendar.days) {
    for (const d of day.items) {
      const id = d.subjects.find((s) => subjectOfId(s)?.kind === "band") ?? d.subjects[0];
      if (id && eventAccent(d)) present.set(id, (present.get(id) ?? 0) + 1);
    }
  }
  const ics = `/calendar/${subject}.ics`;
  return (
    <div className="pb-10">
      <PhoneBar
        title="日历"
        large
        sub={<>{current?.label ?? subject} · 共 {calendar.total} 个有日期的节点</>}
        actions={
          <a href={ics} aria-label="订阅日历" title="订阅日历（.ics）" className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors active:bg-bg-sunk">
            <IconCalendar size={18} />
          </a>
        }
      />
      <header className="hidden pb-5 pt-1 lg:block">
        <p className="text-[12px] font-semibold tracking-[0.08em] text-band">日程一览</p>
        <h1 className="mt-1.5 text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">{current?.label ?? subject} 日历</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-3">演出、发售、抽选与截止，按公告写的当地时间排在月历上。颜色是乐队的应援色。</p>
      </header>

      <div className="mb-6 space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-8 text-[12px] text-ink-4">企划</span>
          {FRANCHISES.map((id) => (
            <Chip key={id} to={href(id)} active={project === id && subject === id} accent={ENTITIES[id].accent}>
              {ENTITIES[id].displayTag ?? ENTITIES[id].name}
            </Chip>
          ))}
        </div>
        {bands.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-8 text-[12px] text-ink-4">乐队</span>
            <Chip to={href(project)} active={subject === project}>全部</Chip>
            {bands.map((id) => (
              <Chip key={id} to={href(id)} active={subject === id} accent={ENTITIES[id].accent}>
                {subjectOfId(id)?.label ?? ENTITIES[id].name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <MonthCalendar data={calendar} monthHref={(m) => href(subject, m)} icsHref={ics} agenda />

      {present.size > 1 && (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-3">
          <span className="text-ink-4">本月</span>
          {[...present].sort((a, b) => b[1] - a[1]).map(([id, n]) => (
            <span key={id} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5" style={{ background: subjectOfId(id)?.accent ?? "var(--ink-4)" }} />
              {subjectOfId(id)?.label ?? id} <span className="num text-ink-4">{n}</span>
            </span>
          ))}
        </p>
      )}

      <p className="mt-6 text-[12.5px] leading-[1.75] text-ink-4">
        只看接下来 30 天、按剩余时间排？去
        <Link to="/deadlines" className="mx-0.5 text-band hover:underline">截止雷达</Link>
        。想看这个企划的新闻，去
        <Link to={`/topics/${subject}`} className="mx-0.5 text-band hover:underline">{current?.label ?? subject} 的主题页</Link>
        。
      </p>
    </div>
  );
}
