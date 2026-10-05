// Feed filters: the channel and category choice (a row of tabs on desktop, a sheet behind the bar's filter
// button on phones), the phone bar of 精选 and 全部, the 只看关注 scope, and search.
import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigate, useNavigation, useSearchParams } from "react-router";
import { CATEGORY_KEYS, CATEGORY_LABELS, CHANNEL_LABELS, type CategoryKey, type ChannelKey } from "@girlsbands/contracts/taxonomy";
import { SITE } from "@girlsbands/industry/site";
import { IconCheck, IconClose, IconFilter, IconHeart, IconSearch } from "../../components/icons";
import { PillTabs } from "../../components/ui/Tabs";
import { Sheet } from "../../components/ui/Sheet";
import { ThemeSwitch } from "../../components/shell/ThemeSwitch";
import { Wordmark } from "../../components/Logo";
import { BarButton, PhoneBar } from "../../components/shell/PhoneBar";
import { useFollows } from "../../lib/local-state";
import { openSearch } from "../search/SearchOverlay";

/** Same page with some query parameters changed (paging state dropped). */
function hrefWith(base: string, params: URLSearchParams, patch: Record<string, string | null>) {
  const sp = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  sp.delete("page");
  sp.delete("cursor");
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * The feed's one filter (精选 and 全部动态 alike): none, 一手, or a category. One choice at a time: picking
 * 一手 clears the category and picking a category clears 一手. Older 资讯 / X links still filter; the
 * choice then shows as none.
 */
function filterOptions(base: string, params: URLSearchParams, noneLabel: string) {
  return [
    { key: "all", label: noneLabel, to: hrefWith(base, params, { category: null, channel: null }) },
    { key: "firstParty", label: CHANNEL_LABELS.firstParty, to: hrefWith(base, params, { category: null, channel: "firstParty" }) },
    ...CATEGORY_KEYS.map((k) => ({ key: k, label: CATEGORY_LABELS[k], to: hrefWith(base, params, { category: k, channel: null }) })),
  ];
}

function filterKey(category: CategoryKey | null, channel: ChannelKey): string {
  return channel === "firstParty" ? "firstParty" : (category ?? "all");
}

/**
 * 只看关注: the follow list lives in this browser alone, so switching it on carries its ids into the
 * address and the server filters by them. Switching it off drops the parameter. Following nothing yet
 * means no filtering at all — the switch then explains itself instead of serving an empty page.
 * Returns whether the address changed (so a sheet can close itself).
 */
function useFollowToggle(base: string, subjects: string[]) {
  const follows = useFollows();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [hint, setHint] = useState(false);
  const on = subjects.length > 0;
  const toggle = (): boolean => {
    if (on) {
      setHint(false);
      void navigate(hrefWith(base, params, { subjects: null }));
      return true;
    }
    if (!follows.length) {
      setHint(true);
      return false;
    }
    void navigate(hrefWith(base, params, { subjects: [...follows].sort().join(",") }));
    return true;
  };
  return { on, toggle, hint };
}

/** The nudge shown when 只看关注 is switched on before anything is followed. */
function FollowHint({ className = "" }: { className?: string }) {
  return <p className={`text-[12.5px] leading-relaxed text-ink-3 ${className}`}>
    还没有关注任何乐队。去<Link to="/#bands" className="text-accent hover:underline">首页的乐队列表</Link>或企划页点「关注」，这里就只显示它们的内容。
  </p>;
}

/** Desktop: 只看关注 as a button beside the filter tabs. */
export function FollowToggle({ base, subjects, className = "" }: { base: string; subjects: string[]; className?: string }) {
  const { on, toggle, hint } = useFollowToggle(base, subjects);
  return <div className={`relative shrink-0 ${className}`}>
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title={on ? "取消只看关注" : "只看关注的乐队"}
      className={`inline-flex h-[42px] items-center gap-1.5 rounded-control px-3.5 text-[13.5px] font-medium transition-colors ${on ? "bg-accent-soft text-accent" : "bg-bg-sunk text-ink-2 hover:text-ink dark:bg-bg-muted/60"}`}
    >
      <IconHeart size={15} />
      只看关注
    </button>
    {hint && <div className="absolute left-0 top-[46px] z-30 w-72 rounded-tile border border-line-soft bg-surface p-3 shadow-lg">
      <FollowHint />
    </div>}
  </div>;
}

/** Desktop: the filter as a row of tabs beside the search field. */
export function CategoryTabs({ base, category, channel = "all", layoutId, className = "" }: { base: string; category: CategoryKey | null; channel?: ChannelKey; layoutId: string; className?: string }) {
  const [params] = useSearchParams();
  return <PillTabs items={filterOptions(base, params, "全部")} active={filterKey(category, channel)} layoutId={layoutId} label="筛选" className={className} />;
}

/**
 * The phone bar of 精选 and 全部: the brand, the 精选 | 全部 switch (a filter in use carries over), and
 * buttons for the filter sheet and search.
 */
export function FeedBar({ base, category, channel, subjects }: { base: "/" | "/all"; category: CategoryKey | null; channel: ChannelKey; subjects: string[] }) {
  const [params] = useSearchParams();
  const [sheet, setSheet] = useState(false);
  const scope = (to: string) => hrefWith(to, params, { q: null, tab: null, search: null });
  const filtered = filterKey(category, channel) !== "all" || subjects.length > 0;
  return (
    <>
      <PhoneBar
        leading={
          <Link to="/" aria-label={`${SITE.name} 首页`} className="flex h-11 items-center pl-2.5 pr-2 text-ink">
            <Wordmark size={16} />
          </Link>
        }
        center={null}
        actions={
          <>
            <BarButton label={filtered ? "筛选（已选）" : "筛选"} on={filtered} onClick={() => setSheet(true)}>
              <IconFilter size={21} />
              {filtered && <span aria-hidden="true" className="absolute right-[9px] top-[9px] size-[7px] rounded-control bg-accent ring-2 ring-bg" />}
            </BarButton>
            <SearchButton /><ThemeSwitch className="phone-theme" />
          </>
        }
      />
      <FilterSheet open={sheet} onClose={() => setSheet(false)} base={base} active={filterKey(category, channel)} subjects={subjects} />
    </>
  );
}

/** Phones: the filter as a sheet of options, the one in use ticked; choosing one applies it. */
function FilterSheet({ open, onClose, base, active, subjects }: { open: boolean; onClose: () => void; base: string; active: string; subjects: string[] }) {
  const [params] = useSearchParams();
  const { on, toggle, hint } = useFollowToggle(base, subjects);
  return (
    <Sheet open={open} onClose={onClose} title="筛选">
      <ul className="mx-4 divide-y divide-line-soft">
        {filterOptions(base, params, "不限").map((o) => {
          const chosen = o.key === active;
          return (
            <li key={o.key}>
              <Link
                to={o.to}
                onClick={onClose}
                aria-current={chosen ? "true" : undefined}
                className={`-mx-2 flex h-12 items-center justify-between rounded-tile px-2 text-[16px] transition-colors active:bg-bg-sunk ${chosen ? "font-semibold text-accent" : "text-ink"}`}
              >
                {o.label}
                {chosen && <IconCheck size={19} strokeWidth={2.2} />}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mx-4 mt-3 border-t border-line-soft pt-1">
        <button
          type="button"
          aria-pressed={on}
          onClick={() => {
            if (toggle()) onClose();
          }}
          className={`-mx-2 flex h-12 w-[calc(100%+1rem)] items-center justify-between rounded-tile px-2 text-left text-[16px] transition-colors active:bg-bg-sunk ${on ? "font-semibold text-accent" : "text-ink"}`}
        >
          只看关注
          {on && <IconCheck size={19} strokeWidth={2.2} />}
        </button>
        {hint && <FollowHint className="pb-3" />}
      </div>
    </Sheet>
  );
}

/** Phones: the filter, the 只看关注 scope and tag in use as chips under the bar; each one clears itself when tapped. */
export function ActiveFilters({ base, category, channel, tag, subjects }: { base: string; category: CategoryKey | null; channel: ChannelKey; tag: string | null; subjects: string[] }) {
  const [params] = useSearchParams();
  const label = channel === "firstParty" ? CHANNEL_LABELS.firstParty : category ? CATEGORY_LABELS[category] : null;
  if (!label && !tag && !subjects.length) return null;
  const chip = "inline-flex min-h-11 max-w-full items-center gap-1 rounded-control bg-accent-soft pl-3 pr-2 text-[13px] font-medium text-accent transition-opacity active:opacity-60";
  return (
    <div className="flex flex-wrap gap-2 pb-3 pt-1 lg:hidden">
      {subjects.length > 0 && (
        <Link to={hrefWith(base, params, { subjects: null })} aria-label="取消筛选：只看关注" className={chip}>
          只看关注
          <IconClose size={14} strokeWidth={2} />
        </Link>
      )}
      {label && (
        <Link to={hrefWith(base, params, { category: null, channel: null })} aria-label={`取消筛选：${label}`} className={chip}>
          只看{label}
          <IconClose size={14} strokeWidth={2} />
        </Link>
      )}
      {tag && (
        <Link to={hrefWith(base, params, { tag: null })} aria-label={`取消标签：${tag}`} className={chip}>
          <span className="truncate">#{tag}</span>
          <IconClose size={14} strokeWidth={2} className="shrink-0" />
        </Link>
      )}
    </div>
  );
}

/** Phones: the magnifier in a bar; the search opens over the page with the keyboard up. */
function SearchButton() {
  return (
    <BarButton label="搜索" onClick={(event) => openSearch("", event.currentTarget)}>
      <IconSearch size={21} />
    </BarButton>
  );
}

function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

/** Desktop search field (GET /all?q=…): at the end of the filter row as the same grey track, at the height of md tabs, with a "/" hint. */
export function SearchField({ defaultValue = "", keep = {} }: { defaultValue?: string; keep?: Record<string, string | null> }) {
  const [value, setValue] = useState(defaultValue);
  const navigation = useNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(defaultValue), [defaultValue]);
  useSlashFocus(inputRef);
  const searching = navigation.state === "loading" && navigation.location?.pathname === "/all" && !!new URLSearchParams(navigation.location.search).get("q");
  const hidden = Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null));

  return (
    <Form method="get" action="/all" role="search" className="group relative w-full shrink-0 lg:w-60">
      {hidden}
      <label htmlFor="site-search" className="sr-only">
        搜索标题、摘要与正文
      </label>
      <IconSearch size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${searching ? "text-accent" : "text-ink-4 group-focus-within:text-ink-3"}`} />
      <input
        ref={inputRef}
        id="site-search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="搜索标题、摘要…"
        maxLength={200}
        autoComplete="off"
        className="h-[42px] w-full rounded-control bg-bg-sunk pl-10 pr-10 text-[14px] text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent dark:bg-bg-muted/60 dark:focus:bg-surface"
      />
      {value ? (
        <button
          type="button"
          aria-label="清空"
          onClick={() => {
            setValue("");
            inputRef.current?.focus();
          }}
          className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-control text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink"
        >
          <IconClose size={13} />
        </button>
      ) : (
        <kbd className="mono pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-mark border border-line-strong bg-surface px-1.5 text-[10.5px] leading-4 text-ink-4 lg:block">/</kbd>
      )}
    </Form>
  );
}
