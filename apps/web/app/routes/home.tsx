import { data as withHeaders, redirect, useLoaderData, useRouteLoaderData, Link } from "react-router";
import type { Route } from "./+types/home";
import type { ActionCenterResponse, TimelineResponse } from "@girlsbands/contracts/site";
import { FRANCHISES, ENTITIES } from "@girlsbands/industry/taxonomy";
import type { loader as rootLoader } from "../root";
import type { HomeResponse } from "@girlsbands/contracts/site";
import { BandEqualizer } from "../features/feed/BandEqualizer";
import { Ticket } from "../features/feed/Ticket";
import { ActionCenter } from "../features/feed/ActionCenter";
import { SubscribeBlock } from "../features/feed/SubscribeBlock";
import { Count } from "../components/ui/Count";
import { IssueSeal } from "../components/ui/IssueSeal";
import { Ticker } from "../components/shell/Ticker";
import { apiDeadlineCache, loadOr404 } from "../lib/api.server";
import { filterParams, itemListLd, listPath, pageMeta, readFilters, siteLd } from "../lib/seo";
import type { Screen } from "../components/shell/screens";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Timeline } from "../features/feed/Timeline";
import { HotTopics } from "../features/feed/HotTopics";
import { TrackRail } from "../features/feed/TrackRail";
import { ProjectRail } from "../features/feed/ProjectRail";
import { ActiveFilters, CategoryTabs, FeedBar, SearchField } from "../features/feed/Filters";

export const handle: Screen = { tab: "featured", name: "首页" };

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const filters = readFilters(url.searchParams);
  const upstream = new Headers();
  const actionsUpstream = new Headers();
  // The action center reads the near window only; the timeline's 30 days of dates still come from the root loader.
  const [data, actions] = await Promise.all([
    loadOr404<TimelineResponse>(listPath("/api/site/timeline", filterParams(filters)), { responseHeaders: upstream, signal: request.signal }),
    loadOr404<ActionCenterResponse>("/api/site/actions?horizon=14", { responseHeaders: actionsUpstream, signal: request.signal }),
  ]);
  return withHeaders({ data, filters, actions }, { headers: apiDeadlineCache(60, Date.now(), upstream, actionsUpstream) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const path = listPath("/", loaderData ? filterParams(loaderData.filters) : {});
  const titles = loaderData?.data.cards.map((c) => c.item.title) ?? [];
  return pageMeta({ path, jsonLd: path === "/" ? [...siteLd(), itemListLd("/", "精选", titles)] : undefined });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

function HomeHero({ home }: { home: HomeResponse }) {
  const tickets = home.deadlines.days.flatMap((d) => d.items).slice(0, 3);
  return <header className="hero">
    <div className="beams" aria-hidden="true"><span className="beam b1" /><span className="beam b2" /></div><div className="hero-dots halftone" aria-hidden="true" />
    <div>
      <div className="issue"><span className="vol">ISSUE {home.today.slice(5).replace('-', '.')}</span><time className="meta" dateTime={home.computedAt}>更新于 {new Date(home.computedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false })} JST</time></div>
      <h1><span className="ln"><span>今天 <em className="n"><Count value={home.stats.today} /></em> 条</span></span><span className="live zh"><span className="flick">新消息</span></span>{home.stats.soon > 0 && <span className="hero-deadline"><em className="n"><Count value={home.stats.soon} delay={80} /></em> 个截止在 <em className="n">48</em> 小时内</span>}</h1>
      <p className="project-names">{FRANCHISES.map((id) => ENTITIES[id].name).join(' / ')}</p>
      <p className="hero-lede">收录 {home.stats.bands} 支乐队的官方消息、票务信息和国内同人活动，翻译成中文，按日期整理。所有日期都标注当地时间。</p>
      <IssueSeal day={home.today} /><div className="stats">{[[home.stats.weekDeadlines, '本周截止'], [home.stats.monthDates, '30 天内日程'], [home.stats.bands, '收录乐队'], [home.stats.sources, '信源']].map(([n, label], i) => <div className="stat" key={label}><span className="n"><Count value={Number(n)} delay={i * 80} /></span><div className="l">{label}</div></div>)}</div>
    </div>
    <section className="nextup"><div className="nextup-head"><h2>NEXT UP <span className="text-[14px] font-sans font-bold">近期日程</span></h2><Link to="/deadlines">日程列表</Link></div><div className="tickets">{tickets.map((item, i) => <Ticket key={`${item.itemId}-${item.at}-${i}`} item={item} from={home.deadlines.from} />)}{!tickets.length && <p className="border-y border-line py-6 text-ink-3">未来 30 天暂无已收录日程。</p>}</div></section>
  </header>;
}

export default function Home() {
  const { data, filters, actions } = useLoaderData<typeof loader>();
  const home = useRouteLoaderData<typeof rootLoader>('root')?.home;
  const sliced = Boolean(filters.tag || filters.category || filters.channel !== "all");
  return <div className="pb-6 flyer-home">
    <FeedBar base="/" category={filters.category} channel={filters.channel} />
    <ActiveFilters base="/" category={filters.category} channel={filters.channel} tag={filters.tag} />
    {home && !sliced && <><Ticker items={home.deadlines.days.flatMap((d) => d.items)} /><HomeHero home={home} />
      <SectionHeader title="乐队" kicker="BANDS" aside={<span className="text-[12px] text-ink-4">近 7 天</span>} />
      <BandEqualizer counts={home.bandWeek} /><ProjectRail projects={home.projects} /><TrackRail counts={home.trackCounts} />
    </>}
    <div className={`body-grid ${sliced ? 'sliced' : ''}`}>
      <section className="min-w-0"><SectionHeader title={filters.tag ? `#${filters.tag}` : '最新消息'} kicker="LATEST" />
        <div className="feed-filters"><CategoryTabs base="/" category={filters.category} channel={filters.channel} layoutId="home-cat-desk" className="min-w-0" /><SearchField keep={{ category: filters.category }} /></div>
        <Timeline initial={data} filters={data.filters} dates={home?.deadlines} />
      </section>
      <aside className="feed-aside"><ActionCenter data={actions} />{data.hot && <HotTopics entries={data.hot} />}<SubscribeBlock /></aside>
    </div>
  </div>;
}
