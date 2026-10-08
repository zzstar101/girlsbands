// /seiyuu：声优日常。成员个人 X 账号里站里收下的帖子（日常和工作告知都在），像刷 X 一样按时间
// 倒序往下翻。顶上按乐队筛；点头像或名字只看这一个人。翻到底自动接着读下一页（cursor），
// 不分页码。被预筛拦下的帖子不在这里，数据见 packages/backend/src/publication/seiyuu.ts。
import { useEffect, useRef, useState } from "react";
import type { SeiyuuPost, SeiyuuResponse } from "@girlsbands/contracts/site";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { Link, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/seiyuu";
import { edgeTtl, loadOr404 } from "../lib/api.server";
import { listPath, pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { bandLogo } from "../components/ui/BandTip";
import { EmptyState } from "../components/ui/Page";
import { SourceAvatar } from "../components/ui/SourceAvatar";
import { SeiyuuPostCard, personName } from "../features/seiyuu/SeiyuuPostCard";
import { XLogo } from "../features/item/XPostCard";

// トゲナシトゲアリ 的字标一半是白的，浅底上看不见（同 BandEqualizer 的 DARK_PLATE）。
const DARK_PLATE = new Set(["togenashi-togeari"]);

/**
 * 乐队筛选：一排乐队 logo，不写字（站主 2026-10-08）。始终只占一行（站主：不要两行），放不下就横向滑；
 * 宽屏上鼠标竖滚轮也换成横滑，两头渐隐提示还有。选中的那块描黑边、顶上一道乐队色，进页面时滚到可见处。
 * 没有 logo 的乐队才退回文字。
 */
function BandFilter({ bands, active }: { bands: SeiyuuResponse["bands"]; active: string }) {
  const rail = useRef<HTMLElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const sync = () => setEdge({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const max = el.scrollWidth - el.clientWidth;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return; // 到头了就让页面照常滚
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("resize", sync);
    return () => { el.removeEventListener("scroll", sync); el.removeEventListener("wheel", wheel); window.removeEventListener("resize", sync); };
  }, [active, bands.length]);
  const fade = `linear-gradient(to right, ${edge.start ? "transparent" : "#000"}, #000 28px, #000 calc(100% - 28px), ${edge.end ? "transparent" : "#000"})`;
  const tile = (on: boolean) =>
    `flex h-8 shrink-0 items-center justify-center border-t-2 px-2 transition-[opacity,box-shadow] ${
      on ? "opacity-100 shadow-[0_0_0_2px_var(--ink)]" : "opacity-75 shadow-[0_0_0_1px_var(--line)] hover:opacity-100"
    }`;
  return (
    <nav ref={rail} aria-label="按乐队筛选" style={{ maskImage: fade, WebkitMaskImage: fade }}
      className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pb-1 pt-0.5 [scrollbar-width:none] lg:mx-0 lg:px-0.5 [&::-webkit-scrollbar]:hidden">
      <div className="flex w-max gap-1.5">
        <Link to="/seiyuu" replace aria-current={active === "all" ? "page" : undefined}
          className={`${tile(active === "all")} border-t-[#141216] bg-[var(--paper)] text-[12px] font-bold text-[#141216]`}>
          全部
        </Link>
        {bands.map((b) => {
          const logo = bandLogo(b.id);
          const accent = ENTITIES[b.id]?.accent ?? "var(--ink)";
          const dark = !!logo && (logo.onDark || DARK_PLATE.has(b.id));
          return (
            <Link key={b.id} to={listPath("/seiyuu", { band: b.id })} replace title={b.name} aria-label={b.name}
              aria-current={active === b.id ? "page" : undefined}
              className={`${tile(active === b.id)} ${dark ? "bg-[#141216]" : "bg-[var(--paper)]"}`} style={{ borderTopColor: accent }}>
              {logo
                ? <img src={logo.src} width={logo.width} height={logo.height} alt="" loading="lazy" className="h-5 w-auto max-w-[72px] object-contain" />
                : <span className="text-[12px] font-bold text-ink">{b.name}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export const handle: Screen = { home: "feed", name: "声优日常" };

export function headers() {
  return edgeTtl(60);
}

function readQuery(params: URLSearchParams) {
  return {
    band: params.get("band")?.trim() || null,
    account: params.get("account")?.trim() || null,
    cursor: params.get("cursor")?.trim() || null,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const q = readQuery(new URL(request.url).searchParams);
  const data = await loadOr404<SeiyuuResponse>(listPath("/api/site/seiyuu", q), { signal: request.signal });
  return { data };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const f = loaderData?.data.filters;
  const info = loaderData?.data.accountInfo;
  const who = (info ? personName(info.name) : null) ?? (f?.band ? (ENTITIES[f.band]?.displayTag ?? ENTITIES[f.band]?.name) : null);
  return pageMeta({
    title: who ? `${who} · 声优日常` : "声优日常",
    description: "乐队成员与声优个人 X 账号的日常和告知，中文翻译，按时间倒序，像刷 X 一样往下翻。",
    path: "/seiyuu",
    // 筛选页与翻页只是同一条时间线的切片，不单独收录。
    noindex: !!(f?.band || f?.account),
  });
}

/** 翻到底时接着读下一页：哨兵进入视口就取 cursor 那一页，接在已有的帖子后面。 */
function useEndless(first: SeiyuuResponse, key: string) {
  const fetcher = useFetcher<typeof loader>();
  const [posts, setPosts] = useState<SeiyuuPost[]>(first.posts);
  const [cursor, setCursor] = useState<string | null>(first.nextCursor);
  const asked = useRef<string | null>(null);

  // 换了乐队或人：从头来过。
  useEffect(() => {
    setPosts(first.posts);
    setCursor(first.nextCursor);
    asked.current = null;
  }, [key, first]);

  useEffect(() => {
    const next = fetcher.data?.data;
    if (!next || fetcher.state !== "idle" || asked.current === null) return;
    const seen = new Set(posts.map((p) => p.id));
    setPosts((prev) => [...prev, ...next.posts.filter((p) => !seen.has(p.id))]);
    setCursor(next.nextCursor);
    asked.current = null;
    // posts 只用来去重，不跟它重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  const more = () => {
    if (!cursor || fetcher.state !== "idle" || asked.current === cursor) return;
    asked.current = cursor;
    const f = first.filters;
    fetcher.load(listPath("/seiyuu", { band: f.band, account: f.account, cursor }));
  };

  return { posts, cursor, loading: fetcher.state !== "idle", more };
}

function Sentinel({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && cb.current(), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex justify-center py-5">
      <button type="button" onClick={onVisible} disabled={loading} className="text-[13px] font-semibold text-ink-4 transition-colors hover:text-accent disabled:opacity-60">
        {loading ? "正在加载…" : "加载更多"}
      </button>
    </div>
  );
}

/** 只看一个人时的页头：大头像、名字、@ 和去 X 主页的链接。 */
function AccountHeader({ account }: { account: NonNullable<SeiyuuResponse["accountInfo"]> }) {
  const band = ENTITIES[account.band];
  return (
    <div className="card mb-4 flex items-center gap-3.5 p-4" style={{ ["--x-accent" as string]: band?.accent ?? "var(--accent)" }}>
      <span className="x-avatar shrink-0">
        <span className="flex rounded-full">
          <SourceAvatar name={personName(account.name)} avatarUrl={account.avatarUrl} size={56} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[18px] font-bold text-ink">{personName(account.name)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-4">
          {account.handle && <span>@{account.handle}</span>}
          {band && (
            <Link viewTransition to={`/topics/${account.band}`} className="font-semibold transition-colors hover:text-accent">
              {band.displayTag ?? band.name}
            </Link>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 text-[12.5px] font-semibold">
        {account.handle && (
          <a href={`https://x.com/${account.handle}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink-3 transition-colors hover:text-ink">
            X 主页 <XLogo size={11} />
          </a>
        )}
        <Link viewTransition to={listPath("/seiyuu", { band: account.band })} className="text-accent transition-colors hover:text-accent-ink">
          看整支乐队 →
        </Link>
      </div>
    </div>
  );
}

export default function SeiyuuRoute() {
  const { data } = useLoaderData<typeof loader>();
  const { band, account } = data.filters;
  const key = `${band ?? ""}|${account ?? ""}`;
  const { posts, cursor, loading, more } = useEndless(data, key);
  const active = account ? (data.accountInfo?.band ?? band ?? "all") : (band ?? "all");

  return (
    <div className="pb-8">
      <PhoneBar title="声优日常" />
      <header className="pb-4 pt-3 lg:pt-1">
        <h1 data-page-title="" className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">声优日常</h1>
        <p className="mt-1.5 max-w-[760px] text-pretty text-[13.5px] leading-relaxed text-ink-3">
          成员个人 X 账号的日常与告知，按时间倒序，日文帖子默认显示中文翻译。点头像只看这一个人。
        </p>
      </header>

      <div className="mb-3">
        <BandFilter bands={data.bands} active={active} />
      </div>

      {data.accountInfo && <AccountHeader account={data.accountInfo} />}

      <div className="mx-auto max-w-[640px] lg:mx-0">
        {posts.length === 0 ? (
          <div className="lg:card">
            <EmptyState title={account ? "这个账号还没有收录的帖子" : "暂时还没有收录的帖子"}>
              成员个人号的新帖子经过筛选后会出现在这里。
            </EmptyState>
          </div>
        ) : (
          <div className="-mx-4 overflow-hidden border-y border-line bg-[var(--surface)] sm:mx-0 sm:card">
            {posts.map((p) => (
              <SeiyuuPostCard key={p.id} post={p} />
            ))}
          </div>
        )}
        {cursor ? (
          <Sentinel onVisible={more} loading={loading} />
        ) : (
          posts.length > 0 && <p className="py-5 text-center text-[12.5px] text-ink-4">已经到底了</p>
        )}
      </div>
    </div>
  );
}
