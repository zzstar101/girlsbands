import { seriesOf } from "@girlsbands/industry/taxonomy";
import type { loader as rootLoader } from "../root";
import type { CSSProperties } from "react";
import { SITE } from "@girlsbands/industry/site";
import { Link, redirect, useLoaderData, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/topic";
import type { CalendarResponse, CoverView, TopicPage, TopicScope } from "@girlsbands/contracts/site";
import { tracksAsSubject } from "@girlsbands/contracts/site";
import { edgeTtl, loadOr404 } from "../lib/api.server";
import { breadcrumbLd, pageMeta, titled, topicLd } from "../lib/seo";
import { DayList, Pagination } from "../features/feed/DayList";
import { parentOf, subjectOfId } from "../features/feed/bands";
import { FollowButton } from "../features/feed/FollowButton";
import { BandLogo } from "../components/ui/BandTip";
import { BrandMark } from "../components/ui/BrandMark";
import { PillTabs } from "../components/ui/Tabs";
import { ChronicleBand, ChronicleRail } from "../features/topic/Chronicle";
import { memberPath, membersOfSubject } from "../features/topic/member";
import { MonthCalendar } from "../features/topic/Calendar";
import { EmptyState } from "../components/ui/Page";
import { IconArrowLeft } from "../components/icons";
import { Badge } from "../components/ui/Badge";
import { CoverImage } from "../components/ui/CoverImage";
import { LIVE_STAGES, openStage } from "../features/feed/lives";
import { RELEASE_KINDS } from "../features/feed/releases";
import { beijingDate } from "@girlsbands/contracts/time";
import { monthDay, monthDayTime, weekdayShort } from "../lib/format";
import { PhoneBar } from "../components/shell/PhoneBar";
import { ReportProblem } from "../features/feedback/ReportProblem";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { home: "feed" };

/** Selected items of a topic: shared caches keep the page as long as its api answer (one minute). */
export function headers() {
  return edgeTtl(60);
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const page = params.page ? Number(params.page) : 1;
  if (params.page !== undefined && (!/^\d+$/.test(params.page) || page < 1)) throw new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  // Page 1 lives at the topic's own address (308), with whatever view the reader had chosen.
  if (params.page === "1") throw redirect(`/topics/${params.slug}${url.search}`, 308);
  const scope: TopicScope = url.searchParams.get("scope") === "all" ? "all" : "picked";
  const data = await loadOr404<TopicPage>(`/api/site/topics/${encodeURIComponent(params.slug)}?page=${page}&scope=${scope}`, { signal: request.signal });
  // A project's or a band's month calendar. A direction has none: its dates are everyone's, and they are
  // on the radar. A month outside the calendar's strip is a 404, the same as any other missing page.
  const month = url.searchParams.get("month");
  const calendar = tracksAsSubject(data.topic.group)
    ? await loadOr404<CalendarResponse>(`/api/site/calendar/${encodeURIComponent(params.slug)}${month ? `?month=${encodeURIComponent(month)}` : ""}`, { signal: request.signal })
    : null;
  return { data, calendar, scope };
}

/** The search snippet: when the topic last changed and its biggest recent events, then what it covers. */
function description(data: TopicPage): string {
  const { topic, highlights } = data;
  const news = highlights.slice(0, 2).map((e) => e.title.replace(/[。.]$/u, "")).join("；");
  const text = news && topic.latest ? `${monthDay(beijingDate(topic.latest.at))}更新：${news}。${topic.definition}` : topic.definition;
  return text.length > 150 ? `${text.slice(0, 149)}…` : text;
}

function hasChronicle(data: TopicPage): boolean {
  return tracksAsSubject(data.topic.group) ? data.milestones.length > 0 : data.chronicle.some((month) => month.events.length > 0);
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: titled("主题不存在") }, { name: "robots", content: "noindex" }];
  const { data, scope } = loaderData;
  const { topic, page } = data;
  const all = scope === "all";
  const base = page > 1 ? `/topics/${topic.slug}/page/${page}` : `/topics/${topic.slug}`;
  // 精选 is the topic's own page; 全部 is one view of it, so it keeps the canonical to itself.
  const path = all ? `${base}?scope=all` : base;
  const parent = tracksAsSubject(topic.group) ? parentOf(topic.slug) : null;
  const text = page > 1 ? `${topic.name}的${all ? "全部收录" : "精选归档"}第 ${page} 页。${topic.definition}` : description(data);
  const crumbs = breadcrumbLd([
    { name: SITE.name, path: "/" },
    ...(parent ? [{ name: parent.label, path: `/topics/${parent.id}` }] : []),
    { name: topic.name, path: `/topics/${topic.slug}` },
  ]);
  return pageMeta({
    title: `${topic.name} ${all ? "全部动态" : "最新动态"}${page > 1 ? ` · 第 ${page} 页` : hasChronicle(data) ? "与大事记" : ""}`,
    description: text,
    path,
    image: `/og/topics/${topic.slug}.png`,
    noindex: !topic.indexable || all,
    jsonLd: page > 1
      ? crumbs
      : [
          topicLd({
            path,
            name: `${topic.name} 最新动态`,
            description: text,
            dateModified: topic.latest?.at ?? null,
            // A company's band runs oldest first; the list puts the newest first, as the rail does.
            events: data.milestones.length
              ? [...data.milestones].reverse().map((ms) => ({ title: ms.title, href: ms.href }))
              : data.chronicle.flatMap((m) => m.events.map((e) => ({ title: e.label, href: e.href }))),
          }),
          crumbs,
        ],
  });
}

/** 列表行首的小图：44×32 裁切；公告没图就什么都不画（不占位）。 */
function RowCover({ cover }: { cover: CoverView | null }) {
  return <CoverImage cover={cover} sizes="44px" className="h-[32px] w-[44px] shrink-0 rounded object-cover" />;
}

/**
 * 这个企划/乐队接下来的演出。月历回答「这个月有什么」，这一段回答「哪一场、到哪一步、还剩几天」——
 * 两处读的是同一批日期（api 的 lives 与 calendar 都出自 facts 的 deadlines），不会各算各的。
 */
function LiveSection({ lives }: { lives: TopicPage["lives"] }) {
  return (
    <section id="lives" className="card mb-8 scroll-mt-16 p-5 lg:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-[650] text-ink">演出</h2>
        <span className="text-[12px] text-ink-4">近期 {lives.length} 场</span>
      </div>
      <ol className="mt-2 divide-y divide-line-soft">
        {lives.map((l) => {
          const stage = LIVE_STAGES[l.stage];
          return (
            <li key={l.publicId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <RowCover cover={l.cover} />
              <span className="num w-[104px] shrink-0 text-[13px] text-ink-2">{monthDay(l.startsOn)}（{weekdayShort(l.startsOn)}）</span>
              <Link viewTransition to={`/live/${l.publicId}`} prefetch="intent" className="min-w-0 flex-1 truncate text-[14.5px] font-[650] text-ink transition-colors hover:text-accent">
                {l.title}
              </Link>
              {l.venue && <span className="hidden max-w-[180px] truncate text-[12.5px] text-ink-4 sm:inline">{l.venue}</span>}
              <span className="num shrink-0 text-[12.5px] text-ink-3">{l.startsTime ?? "时间未定"}</span>
              <Badge tone={stage.tone}>{stage.label}</Badge>
              <span className="num w-[44px] shrink-0 text-right text-[12px] text-ink-4">{openStage(l.stage) && l.daysLeft !== null ? `D-${l.daysLeft}` : ""}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * 这个企划/乐队在卖的东西。月历回答「哪一天卖」，这一段回答「是什么、有几个版本、有没有序列号」——
 * 与演出那段读的是同一批行（`releasesForSubject`），只是换了个问法。
 */
function ReleaseSection({ releases }: { releases: TopicPage["releases"] }) {
  return (
    <section id="releases" className="card mb-8 scroll-mt-16 p-5 lg:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-[650] text-ink">发售</h2>
        <span className="text-[12px] text-ink-4">近期 {releases.length} 张</span>
      </div>
      <ol className="mt-2 divide-y divide-line-soft">
        {releases.map((r) => {
          const kind = RELEASE_KINDS[r.kind];
          return (
            <li key={r.publicId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <RowCover cover={r.cover} />
              <span className="num w-[104px] shrink-0 text-[13px] text-ink-2">
                {r.releaseOn ? `${monthDay(r.releaseOn)}（${weekdayShort(r.releaseOn)}）` : "日期未定"}
              </span>
              <Link viewTransition to={`/release/${r.publicId}`} prefetch="intent" className="min-w-0 flex-1 truncate text-[14.5px] font-[650] text-ink transition-colors hover:text-accent">
                {r.title}
              </Link>
              <span className={`shrink-0 text-[12.5px] font-semibold ${kind.className}`}>{kind.label}</span>
              <span className="shrink-0 text-[12px] text-ink-4">{r.editionCount > 0 ? `${r.editionCount} 个版本` : "版本未定"}</span>
              <span className="w-[56px] shrink-0 text-right text-[12px] text-ink-4">{r.hasSerial ? "有序列号" : ""}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * 这支乐队/这个企划的角色。成员不是采集主体，名单是静态的（industry/members.ts），这里只把它们
 * 摆出来；企划页按乐队分组，乐队页就一组（队名与页头重复，不画）。默认收起，放在动态之后。
 */
function MemberSection({ subject }: { subject: string }) {
  const bands = membersOfSubject(subject);
  if (bands.length === 0) return null;
  return (
    <details id="members" className="card group/members mt-8 scroll-mt-16 p-5 lg:p-6">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-[650] text-ink">
          角色 <span className="text-[12.5px] font-normal text-ink-4">{bands.length > 1 ? `${bands.length} 支乐队 · ` : ""}{bands.reduce((n, b) => n + b.members.length, 0)} 人 · <span className="group-open/members:hidden">展开</span><span className="hidden group-open/members:inline">收起</span></span>
        </h2>
        <Link viewTransition to="/members" className="text-[12.5px] font-semibold text-accent hover:text-accent-ink">
          全部角色 →
        </Link>
      </summary>
      {bands.map((band, i) => (
        <div key={band.id} className={i > 0 ? "mt-3 border-t border-line-soft pt-3" : "mt-2"}>
          {bands.length > 1 && (
            <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-3">
              <span aria-hidden="true" className="size-2.5 shrink-0" style={{ background: band.accent ?? "var(--ink-4)" }} />
              <Link viewTransition to={`/topics/${band.id}`} className="transition-colors hover:text-accent">
                {band.name}
              </Link>
            </p>
          )}
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {band.members.map((m) => (
              <li key={m.id}>
                <Link viewTransition to={memberPath(m.id)} prefetch="intent" className="inline-flex items-baseline gap-1.5 text-[14px] text-ink-2 transition-colors hover:text-accent">
                  {m.name}
                  {m.role && <span className="text-[11.5px] text-ink-4">{m.role}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

export default function TopicRoute() {
  const { data, calendar, scope } = useLoaderData<typeof loader>();
  const home = useRouteLoaderData<typeof rootLoader>("root")?.home;
  const { topic, items, page, pageCount, pageSize } = data;
  const all = scope === "all";
  const subject = tracksAsSubject(topic.group);
  /** The topic at page `p`, carrying the chosen view (and month) along. */
  const href = (p: number, patch: { scope?: TopicScope; month?: string | null } = {}) => {
    const sp = new URLSearchParams();
    if ((patch.scope ?? scope) === "all") sp.set("scope", "all");
    const month = patch.month === undefined ? null : patch.month;
    if (month) sp.set("month", month);
    const q = sp.toString();
    return `${p <= 1 ? `/topics/${topic.slug}` : `/topics/${topic.slug}/page/${p}`}${q ? `?${q}` : ""}`;
  };
  const first = (page - 1) * pageSize + 1;
  const last = first + items.length - 1;
  const shown = all ? topic.poolTotal : topic.total;
  const parent = subject ? parentOf(topic.slug) : null;
  const back = parent ? { to: `/topics/${parent.id}`, label: parent.label } : { to: "/", label: "首页" };
  // A band or project page carries that band's own accent, on rules and links only — never the page.
  const band = subject ? subjectOfId(topic.slug) : null;
  const style = band?.accent ? ({ "--band-accent": band.accent, "--accent": band.accent, "--pink": band.accent } as CSSProperties) : undefined;
  return (
    <div className="pb-6" style={style}>
      <PhoneBar back={back} title={topic.name} />
      <Link to={back.to} className="hidden items-center gap-1.5 py-2 text-[13px] text-ink-3 transition-colors hover:text-accent lg:inline-flex">
        <IconArrowLeft size={14} /> 返回{back.label}
      </Link>
      <header className={`${band ? "topic-poster" : ""} flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-5 pt-3 lg:pt-1`}>
        <div className="min-w-0 max-w-[760px]">
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-band">
            <span aria-hidden="true" className="h-[2px] w-6 flex-none rounded-full bg-band" />
            {topic.groupName}
          </p>
          <h1 data-page-title="" className="mt-1.5 flex items-center gap-3 text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">
            {band ? <BandLogo id={band.id} /> : topic.brand && <BrandMark brand={topic.brand} size={34} />}
            <span>
              {topic.name}{" "}
              <span className="whitespace-nowrap font-semibold text-ink-4">{all ? "全部动态" : "最新动态"}</span>
            </span>
          </h1>
          <p className="mt-1.5 text-pretty text-[13.5px] leading-relaxed text-ink-3">{topic.definition}</p>
          <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-4">
            <span>
              <span className="num font-semibold text-ink-2">{topic.total.toLocaleString("zh-CN")}</span> 条精选
            </span>
            <span>
              近 30 天 <span className="num font-semibold text-ink-2">{topic.recent.toLocaleString("zh-CN")}</span> 条
            </span>
            <span>
              共收录 <span className="num font-semibold text-ink-2">{topic.poolTotal.toLocaleString("zh-CN")}</span> 条
            </span>
          </p>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-ink-4">
          {band && <FollowButton subject={band} />}
          {topic.latest && (
            <span>
              <time dateTime={topic.latest.at} className="num">{monthDayTime(topic.latest.at)}</time> 更新
            </span>
          )}
        </div>
      </header>

      {band && home && <div className="topic-figures"><span><b>{band.kind === 'band' ? home.bandWeek[band.id] ?? 0 : Object.entries(home.bandWeek).filter(([id]) => seriesOf(band.id).includes(id)).reduce((n, [, count]) => n + count, 0)}</b> 近 7 天消息</span><span><b>{band.kind === 'band' ? home.bandMonthDeadlines[band.id] ?? 0 : home.projects[band.id]?.deadlines ?? 0}</b> 30 天内截止</span></div>}
      {page === 1 && calendar && (
        <div id="calendar" className="scroll-mt-16"><MonthCalendar data={calendar} monthHref={(m) => href(1, { month: m })} icsHref={`/calendar/${topic.slug}.ics`} className="mb-8" /></div>
      )}

      {page === 1 && data.lives.length > 0 && <LiveSection lives={data.lives} />}

      {page === 1 && data.releases.length > 0 && <ReleaseSection releases={data.releases} />}

      {page === 1 && hasChronicle(data) && (
        <div key={topic.slug} className="mb-8">
          {subject ? <ChronicleBand milestones={data.milestones} kinds={data.kinds} /> : <ChronicleRail months={data.chronicle} kinds={data.kinds} />}
        </div>
      )}

      <h2 className="sr-only">{all ? `${topic.name}的全部动态` : `${topic.name}的精选`}{page > 1 ? ` · 第 ${page} 页` : ""}</h2>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <PillTabs
          size="sm"
          layoutId="topic-scope"
          label="看精选或全部"
          active={scope}
          items={[
            { key: "picked", label: "精选", to: href(1, { scope: "picked" }), count: topic.total },
            { key: "all", label: "全部", to: href(1, { scope: "all" }), count: topic.poolTotal },
          ]}
        />
        <span className="text-[12px] text-ink-4">{all ? "这个主题收录的全部消息，含未选入头条的" : "经过筛选、值得一读的消息"}</span>
        {band && (
          <Link viewTransition to={`/all?category=daily&subjects=${band.id}`} className="ml-auto text-[12.5px] font-semibold text-accent transition-colors hover:text-accent-ink">
            成员日常 →
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <div className="lg:card">
          <EmptyState title={all ? "这个主题暂时还没有收录内容" : "这个主题暂时还没有精选内容"} />
        </div>
      ) : (
        <DayList items={items} headerAside={<span className="num whitespace-nowrap">第 {first}–{last} 条<span className="hidden sm:inline"> · 共 {shown.toLocaleString("zh-CN")} 条</span></span>} />
      )}
      <Pagination page={page} pageCount={pageCount} href={(p) => href(p)} />
      {/* The cast is reference, not news: folded away under the timeline instead of between the dates and it. */}
      {page === 1 && band && <MemberSection subject={topic.slug} />}
      <p className="mt-6 border-t border-line-soft pt-4 text-[12.5px] text-ink-4">
        <ReportProblem kind="topic" id={topic.slug} what={topic.name} />
      </p>
    </div>
  );
}
