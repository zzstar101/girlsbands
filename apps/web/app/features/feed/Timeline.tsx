// The day-grouped feed (精选 home, topics): a time rail with cards on desktop, rows under grey day bars on
// phones. Keeps its place across back navigation and loads further pages. There is no "new items"
// prompt: readers refresh for the latest head (feedback #1199) — on phones also by tapping the tab again.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigation } from "react-router";
import { Collapse } from "../../components/ui/Presence";
import type { TimelineCard, TimelineFilters, TimelineResponse, DeadlinesResponse } from "@girlsbands/contracts/site";
import { FeedItem } from "./FeedItem";
import { IconChevronDown } from "../../components/icons";
import { RingMark } from "../../components/Logo";
import { EmptyState } from "../../components/ui/Page";
import { beijingDate, beijingTime, beijingWeekday } from "@girlsbands/contracts/time";
import { monthDay, weekdayShort } from "../../lib/format";
import { isHydrated } from "../../lib/hydration";
import { markRead, useReadSet } from "../../lib/local-state";
import { filterParams, listPath } from "../../lib/seo";
import { isReload, readSnapshot, restoreAnchor, saveSnapshot, useSaveOnLeave } from "../../lib/restore";

const AUTO_BATCHES = 3;

interface ListState {
  version: 2;
  cards: TimelineCard[];
  nextCursor: string | null;
  dayCounts: Record<string, number>;
  collapsed: string[];
  batches: number;
}

function fromResponse(r: TimelineResponse): ListState {
  return { version: 2, cards: r.cards, nextCursor: r.nextCursor, dayCounts: r.dayCounts, collapsed: [], batches: 1 };
}

/** Date as a printed headline; folding remains available on every screen. */
export function DayHeader({ day, today, count, collapsed, onToggle, aside }: { day: string; today: string; count: number | null; collapsed?: boolean; onToggle?: () => void; aside?: React.ReactNode }) {
  const date = day.slice(5).replace('-', '.');
  const weekday = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }).toUpperCase();
  return <div className="day flyer-day">
    {onToggle ? <button type="button" aria-expanded={!collapsed} aria-label={`${collapsed ? '展开' : '收起'}${monthDay(day)}`} onClick={onToggle} className="date">{date}</button> : <time dateTime={day} className="date">{date}</time>}
    <span className="wk">{weekday}</span>{day === today && <span className="today">今天</span>}<span className="rule" aria-hidden="true" />
    <span className="count">{count !== null && <><b>{count}</b> 条</>}{aside}</span>{onToggle && <button type="button" onClick={onToggle} aria-label={`${collapsed ? '展开' : '收起'}${monthDay(day)}`} aria-expanded={!collapsed}><IconChevronDown size={15} className={collapsed ? '-rotate-90' : ''} /></button>}
  </div>;
}

export function TimelineSlot({ at, children, fresh = false, delay = 0, dataKey }: { at: string; children: React.ReactNode; fresh?: boolean; delay?: number; dataKey?: string }) {
  return <li data-card-key={dataKey} className={`timeline-slot ${fresh ? 'animate-fade-up' : ''}`} style={fresh ? { animationDelay: `${delay}ms` } : undefined}>
    <time dateTime={at} className="slot-time">{beijingTime(at)}</time>{children}
  </li>;
}

export function Timeline({ initial, filters, dates }: { initial: TimelineResponse; filters: TimelineFilters; dates?: DeadlinesResponse }) {
  const location = useLocation();
  const navigation = useNavigation();
  const readSet = useReadSet();
  const historyKey = location.key;

  // Back navigation (client side): restore synchronously from the snapshot. A full reload restores
  // after hydration so the first client render matches the server HTML.
  const [state, setState] = useState<ListState>(() => {
    if (isHydrated()) {
      const snap = readSnapshot<ListState>(historyKey);
      if (snap?.data.version === 2 && snap.data.cards.length > 0) return snap.data;
    }
    return fromResponse(initial);
  });
  const restoredRef = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [freshKeys, setFreshKeys] = useState<Set<string>>(() => new Set());
  const stateRef = useRef(state);
  stateRef.current = state;

  // Filters (i.e. the loader data) changed. A page still loading for the old filters is cancelled, and a
  // response that arrives anyway is dropped (it belongs to another list and cursor). Back or forward to a
  // filter already visited restores what that history entry had loaded and folded; a new one starts over.
  const filterKey = listPath("/api/site/timeline", filterParams(filters));
  const lastFilterKey = useRef(filterKey);
  const pageRequest = useRef<AbortController | null>(null);
  useEffect(() => () => pageRequest.current?.abort(), []);
  useLayoutEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      pageRequest.current?.abort();
      pageRequest.current = null;
      setLoadingMore(false);
      setLoadError(false);
      const snap = readSnapshot<ListState>(historyKey);
      if (snap?.data.version === 2 && snap.data.cards.length > 0) {
        setState(snap.data);
        restoreAnchor(snap.anchor, snap.scrollY);
      } else {
        setState(fromResponse(initial));
      }
    }
  }, [filterKey, initial, historyKey]);

  // The same list with new data (the tab tapped again at the top, or the brand tapped): start over from
  // the fresh head. A change of filters is handled above.
  const lastData = useRef({ initial, filterKey });
  useLayoutEffect(() => {
    const prev = lastData.current;
    lastData.current = { initial, filterKey };
    if (prev.initial === initial || prev.filterKey !== filterKey) return;
    pageRequest.current?.abort();
    pageRequest.current = null;
    setLoadingMore(false);
    setLoadError(false);
    setState(fromResponse(initial));
  }, [initial, filterKey]);

  useLayoutEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const snap = readSnapshot<ListState>(historyKey);
    if (!isHydrated()) {
      // A full load keeps the server's fresh list when the reader reloaded; after a back/forward
      // that reloaded the document, it restores the saved list and position.
      if (snap?.data.version === 2 && snap.data.cards.length > 0 && !isReload()) {
        setState(snap.data);
        requestAnimationFrame(() => restoreAnchor(snap.anchor, snap.scrollY));
      }
      return;
    }
    if (snap?.data.version === 2 && snap.data.cards.length > 0) restoreAnchor(snap.anchor, snap.scrollY);
  }, [historyKey]);

  // Save the snapshot whenever we leave this history entry.
  useEffect(() => {
    if (navigation.state === "loading" && navigation.location && navigation.location.key !== historyKey) {
      saveSnapshot(historyKey, stateRef.current);
    }
  }, [navigation.state, navigation.location, historyKey]);
  useSaveOnLeave(historyKey, () => stateRef.current);

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (!s.nextCursor || pageRequest.current) return;
    const key = listPath("/api/site/timeline", filterParams(filters));
    const controller = new AbortController();
    pageRequest.current = controller;
    const current = () => lastFilterKey.current === key && !controller.signal.aborted;
    setLoadingMore(true);
    setLoadError(false);
    try {
      const res = await fetch(listPath("/api/site/timeline", { ...filterParams(filters), cursor: s.nextCursor }), { signal: controller.signal });
      if (res.status === 400) {
        // Cursor no longer fits: start over from the head.
        const head = await fetch(key, { signal: controller.signal });
        if (!head.ok) throw new Error(String(head.status));
        if (current()) setState(fromResponse((await head.json()) as TimelineResponse));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as TimelineResponse;
      if (!current()) return;
      setState((prev) => {
        const seen = new Set(prev.cards.map((c) => c.key));
        const added = page.cards.filter((c) => !seen.has(c.key));
        setFreshKeys(new Set(added.map((c) => c.key)));
        return {
          ...prev,
          cards: [...prev.cards, ...added],
          nextCursor: page.nextCursor,
          dayCounts: { ...prev.dayCounts, ...page.dayCounts },
          batches: prev.batches + 1,
        };
      });
    } catch {
      if (current()) setLoadError(true);
    } finally {
      if (pageRequest.current === controller) {
        pageRequest.current = null;
        setLoadingMore(false);
      }
    }
  }, [filters]);

  // Auto-load a few batches when the sentinel nears the viewport, then hand over to a button.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !state.nextCursor || state.batches >= AUTO_BATCHES) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [state.nextCursor, state.batches, loadMore]);

  const today = beijingDate(Date.now());
  const days = useMemo(() => {
    const out: Array<{ day: string; cards: TimelineCard[] }> = [];
    for (const c of state.cards) {
      const d = beijingDate(c.anchorAt);
      const last = out[out.length - 1];
      if (last && last.day === d) last.cards.push(c);
      else out.push({ day: d, cards: [c] });
    }
    return out;
  }, [state.cards]);

  const toggleDay = (day: string) =>
    setState((s) => ({ ...s, collapsed: s.collapsed.includes(day) ? s.collapsed.filter((d) => d !== day) : [...s.collapsed, day] }));

  let order = 0;
  return (
    <div className="relative">
      {days.length === 0 && (
        <div className="lg:card">
          <EmptyState title="这个筛选下还没有精选内容">换个类别看看，或者去全部动态里找找。</EmptyState>
        </div>
      )}

      {days.map(({ day, cards }) => {
        const collapsed = state.collapsed.includes(day);
        const count = state.dayCounts[day] ?? cards.length;
        return (
          <section key={day} aria-label={day} className="lg:mb-1">
            <DayHeader day={day} today={today} count={count} collapsed={collapsed} onToggle={() => toggleDay(day)} />
            <Collapse open={!collapsed}>
                <ol className="lg:pt-1">
                  {cards.map((c) => {
                    const fresh = freshKeys.has(c.key);
                    const delay = fresh ? Math.min(order++, 10) * 40 : 0;
                    return (
                      <TimelineSlot key={c.key} dataKey={c.key} at={c.anchorAt} fresh={fresh} delay={delay}>
                        <FeedItem item={c.item} group={c.group} filters={filters} read={readSet.has(c.item.id)} onOpen={markRead} at={c.anchorAt} deadline={dates?.days.flatMap((d) => d.items).find((d) => d.itemId === c.item.id)} deadlineFrom={dates?.from} headliner={c.headliner} change={c.change} />
                      </TimelineSlot>
                    );
                  })}
                </ol>
            </Collapse>
          </section>
        );
      })}

      <div ref={sentinel} aria-hidden="true" />
      <FeedEnd loading={loadingMore} error={loadError} hasMore={!!state.nextCursor} manual={state.batches >= AUTO_BATCHES} empty={state.cards.length === 0} onMore={loadMore} />
    </div>
  );
}

/** The foot of a paged list: loading, retry, "加载更多" after a few automatic pages, or the end. */
function FeedEnd({ loading, error, hasMore, manual, empty, onMore }: { loading: boolean; error: boolean; hasMore: boolean; manual: boolean; empty: boolean; onMore: () => void }) {
  return (
    <div className="flex justify-center py-6">
      {loading ? (
        <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-4">
          <RingMark className="size-4 text-accent" spinning /> 正在加载
        </span>
      ) : error ? (
        <button type="button" onClick={onMore} className="h-9 rounded-full border border-hot/30 px-4 text-[13px] text-hot hover:bg-hot-soft">
          加载失败，点此重试
        </button>
      ) : hasMore ? (
        manual && (
          <button type="button" onClick={onMore} className="h-9 rounded-full border border-line-strong bg-surface px-5 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-4 hover:text-ink">
            加载更多
          </button>
        )
      ) : (
        !empty && <span className="text-[12px] text-ink-4">已经到底了</span>
      )}
    </div>
  );
}
