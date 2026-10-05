// One report in a feed. Desktop (≥ 961px): a card beside the time rail. Phones: a compact row with the
// time in the source line, the bookmark at hand, the reason in one line and duplicate reports behind one
// button that opens a sheet. One markup, two presentations.
//
// A card is set like a poster: who it is about and what kind of event it is come first, then the
// headline, then the reading value. The band comes from the item's own tags, so a card with no band
// attribution shows none rather than guessing one.
import { memo, useEffect, useRef, type CSSProperties } from "react";
import { Link } from "react-router";
import { IntentLink } from "../../components/ui/IntentLink";
import { CoverImage } from "../../components/ui/CoverImage";
import type { GroupInfo, FeedItemSummary, TimelineFilters, DeadlineView } from "@girlsbands/contracts/site";
import { SameEventBadge, SelectedBadge } from "../../components/ui/Badge";
import { ArtistLine } from "../../components/ui/ArtistBadge";
import { EventTypeBadge } from "../../components/ui/EventTypeBadge";
import { ScoreLabel } from "../../components/ui/Score";
import { beijingTime } from "@girlsbands/contracts/time";
import { daysAway } from "./Ticket";
import { DEADLINE_LABELS } from "@girlsbands/contracts/site";
import { BandLogo } from "../../components/ui/BandTip";
import { clockText, md } from "./deadlines";
import { subjectsOfItem } from "./bands";
import { MediaThumbs, SourceLine, StarButton } from "./parts";
import { GroupButton, GroupSources } from "./ReadingGroup";
import { QuotedLine } from "../item/QuotedPost";
import { rememberPreview } from "../item/preview";

export interface FeedItemProps {
  item: FeedItemSummary;
  group?: GroupInfo | null;
  filters?: TimelineFilters;
  read?: boolean;
  onOpen?: (id: string) => void;
  /** Show tags under the text (全部动态, topics, search). */
  showTags?: boolean;
  /** The time the item sits at in its list; phones show it in the source line (desktop: on the rail). */
  at?: string;
  deadline?: DeadlineView;
  deadlineFrom?: string;
  headliner?: boolean;
}

export const FeedItem = memo(function FeedItem({ item, group, filters, read = false, onOpen, showTags = false, at, deadline, deadlineFrom, headliner = false }: FeedItemProps) {
  deadline ??= item.dates?.[0];
  deadlineFrom ??= item.datesFrom;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      el.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], { duration: 550, easing: 'cubic-bezier(.25,1,.5,1)' });
      observer.disconnect();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.id]);
  const isX = item.channel === "x" && !!item.x;
  // X 帖的图由帖子自己带（MediaThumbs），卡片左侧这一张只给别的公告用。
  const cover = isX ? null : item.cover;
  const open = () => {
    rememberPreview(item);
    onOpen?.(item.id);
  };
  const showSources = !!group && (group.additionalSourceCount > 0 || group.reportCount > 1);
  const tags = showTags ? item.tags.slice(0, 3) : [];
  const subjects = subjectsOfItem(item);

  return (
    <article ref={ref} className={`flyer-card relative min-w-0 ${headliner ? "headliner" : ""}`} data-item-id={item.id} style={{ "--k1": subjects[0]?.accent ?? "transparent" } as CSSProperties}>
      <span className="spine" aria-hidden="true">{subjects.map((s) => <i key={s.id} style={{ background: s.accent ?? "var(--pink)" }} />)}</span>
      {headliner && <><div className="hl-dots halftone" aria-hidden="true" /><div className="lineup"><span className="lineup-k">LINEUP<br />出演</span>{subjects.map((s) => <Link key={s.id} to={`/topics/${s.id}`} style={{ "--c": s.accent } as CSSProperties} aria-label={s.label}><BandLogo id={s.id} /></Link>)}{!subjects.length && <span className="px-4 py-3 text-[12px] font-bold">今日头条</span>}</div></>}
      <header className="flex min-h-[22px] items-center gap-1.5 text-[12.5px] leading-[18px] text-ink-4 lg:min-h-[18px] lg:gap-2">
        <EventTypeBadge category={item.category} /><ArtistLine subjects={subjects} /><SourceLine item={item} className="feed-source text-ink-4" />
        {at && (
          <time dateTime={at} className="mono shrink-0 text-[12px] lg:hidden">
            · {beijingTime(at)}
          </time>
        )}
        {item.selected && (
          <span className="hidden lg:inline-flex">
            {item.sameEvent ? <SameEventBadge /> : <SelectedBadge />}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 lg:gap-1.5">
          <span className="hidden lg:inline-flex">
            <ScoreLabel score={item.score} />
          </span>
          <span className="lg:hidden">
            <ScoreLabel score={item.score} compact />
          </span>
          <span className="-my-[11px] -mr-3 inline-flex lg:-my-1 lg:mr-0">
            <StarButton item={item} className="size-11 lg:size-[26px]" />
          </span>
        </span>
      </header>

      {isX ? (
        <p className={`mt-1.5 whitespace-pre-line text-[15px] leading-[1.75] line-clamp-5 lg:mt-2 lg:line-clamp-4 ${read ? "text-ink-4" : "text-ink"}`}>
          <IntentLink viewTransition to={`/items/${item.id}`} onClick={open} className="after:absolute after:inset-0 after:content-['']">
            {item.summary ?? item.title}
          </IntentLink>
        </p>
      ) : (
        // 公告自己带图时，标题与摘要缩到左边一条缩略图旁边；没图时这一层不产生任何样式。
        <div className={cover ? "mt-1.5 flex items-start gap-3 lg:mt-2 lg:gap-4" : undefined}>
          {cover && <CoverImage cover={cover} sizes="(min-width: 1024px) 120px, 84px" className="h-[60px] w-[84px] shrink-0 rounded-md object-cover lg:h-[84px] lg:w-[120px]" />}
          <div className={cover ? "min-w-0 flex-1" : undefined}>
            <h3 className={`${cover ? "" : "mt-1.5 lg:mt-2 "}line-clamp-2 text-[16.5px] font-extrabold leading-[1.45] tracking-[-0.01em] lg:line-clamp-none lg:text-[19px] lg:leading-[1.4] ${read ? "text-ink-4" : "text-ink"}`}>
              <IntentLink viewTransition to={`/items/${item.id}`} onClick={open} className="after:absolute after:inset-0 after:content-['']">
                {item.title}
              </IntentLink>
            </h3>
            {item.summary && <p className="mt-1 line-clamp-2 text-[14.5px] leading-[1.7] text-ink-3 lg:mt-2 lg:line-clamp-3 lg:text-[15px] lg:leading-[1.75]">{item.summary}</p>}
          </div>
        </div>
      )}

      {isX && item.x!.media.length > 0 && <MediaThumbs media={item.x!.media} className="mt-2.5" />}
      {isX && item.x!.quoted?.text && <QuotedLine quoted={item.x!.quoted} />}

      {tags.length > 0 && (
        <div className="relative z-10 mt-2 hidden flex-wrap gap-x-2.5 gap-y-1 text-[12px] text-ink-4 lg:flex">
          {tags.map((t) => (
            <Link key={t} to={`/all?tag=${encodeURIComponent(t)}`} className="hover:text-accent">
              #{t}
            </Link>
          ))}
        </div>
      )}

      {item.sameEvent && (
        <p className="relative z-10 mt-2 line-clamp-1 text-[12.5px] text-ink-4">
          同一新闻，精选展示
          <Link viewTransition to={`/items/${item.sameEvent.id}`} className="text-ink-3 transition-colors hover:text-accent">
            《{item.sameEvent.title}》
          </Link>
        </p>
      )}
      {group && showSources && (
        <div className="mt-2 hidden lg:block">
          <GroupSources group={group} filters={filters} parentId={item.id} />
        </div>
      )}

      {deadline && <div className="feed-date"><span className={deadline.soon ? "date-soon" : "date-later"}>{deadlineFrom ? `D-${daysAway(deadline.day, deadlineFrom)}` : md(deadline.day)}</span>{DEADLINE_LABELS[deadline.kind].label} · {md(deadline.day)} {clockText(deadline.localTime, deadline.timezone)}</div>}
      {item.reason && (
        <div className="feed-reason mt-1 lg:mt-3 lg:border-t lg:border-dashed lg:border-line-strong lg:pt-3">
          <p className="line-clamp-1 text-[13px] leading-[1.65] text-note lg:line-clamp-none lg:leading-[1.75]">
            <span className="meta mr-1.5">■ 看点</span>
            {item.reason}
          </p>
        </div>
      )}

      {/* Phones: duplicate reports open in a sheet. */}
      {group && showSources && <GroupButton group={group} filters={filters} parentId={item.id} />}
    </article>
  );
});
