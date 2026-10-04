import { data as withHeaders, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { TimelineResponse } from "@girlsbands/contracts/site";
import { SITE } from "@girlsbands/industry/site";
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
  const data = await loadOr404<TimelineResponse>(listPath("/api/site/timeline", filterParams(filters)), { responseHeaders: upstream, signal: request.signal });
  return withHeaders({ data, filters }, { headers: apiDeadlineCache(60, Date.now(), upstream) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const path = listPath("/", loaderData ? filterParams(loaderData.filters) : {});
  const titles = loaderData?.data.cards.map((c) => c.item.title) ?? [];
  return pageMeta({ path, jsonLd: path === "/" ? [...siteLd(), itemListLd("/", "精选", titles)] : undefined });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

/** The standing question, set as the page's own headline. The description is desktop-only so phones reach the feed sooner. */
function HomeHero() {
  return (
    <header className="border-b border-line pb-4 pt-1 lg:pb-6 lg:pt-2">
      <p className="meta uppercase">BAND INTELLIGENCE · LIVE · TICKET</p>
      <h1 className="mt-1.5 text-[25px] font-black leading-[1.15] tracking-[-0.025em] text-ink lg:mt-2 lg:text-[36px]">{SITE.tagline}</h1>
      <p className="mt-2 hidden max-w-[62ch] text-[14px] leading-[1.75] text-ink-3 lg:block">{SITE.description}</p>
    </header>
  );
}

export default function Home() {
  const { data, filters } = useLoaderData<typeof loader>();
  const title = filters.tag ? `#${filters.tag}` : "精选";
  // A category, channel or tag in the URL means the reader is inside one slice: the hero and the entry
  // rail give way to the slice's own heading. `channel` always has a value, so only a non-default one counts.
  const sliced = Boolean(filters.tag || filters.category || filters.channel !== "all");
  return (
    <div className="pb-6">
      {/* Phones: the bar (精选 | 全部, filter, search), the filter in use, the tracking entry points, the feed. */}
      <FeedBar base="/" category={filters.category} channel={filters.channel} />
      <ActiveFilters base="/" category={filters.category} channel={filters.channel} tag={filters.tag} />
      {!sliced && <HomeHero />}
      <div className="hidden lg:block">
        {sliced ? (
          <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">{title}</h1>
        ) : (
          <h2 className="mt-5 text-[15px] font-semibold text-ink">最新情报</h2>
        )}
        <div className={`flex items-center justify-between gap-4 ${sliced ? "mb-5 mt-4" : "mb-5 mt-3"}`}>
          <CategoryTabs base="/" category={filters.category} channel={filters.channel} layoutId="home-cat-desk" className="min-w-0" />
          <SearchField keep={{ category: filters.category }} />
        </div>
      </div>

      {!sliced && <ProjectRail className="mt-4 lg:mt-0" />}
      {!sliced && <TrackRail className="mt-3" />}

      {!sliced && (
        <div className="mb-3 lg:hidden">
          <SectionHeader kicker="LATEST" title="最新情报" />
        </div>
      )}

      <Timeline initial={data} filters={data.filters} />

      {/* Trending comes last on purpose: what the reader can still act on outranks what is merely being talked about. */}
      {data.hot && <HotTopics entries={data.hot} />}
    </div>
  );
}
