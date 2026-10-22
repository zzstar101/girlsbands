import { Link } from "react-router";
import type { ActionCenterResponse, DeadlineView } from "@girlsbands/contracts/site";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { ArtistLine } from "../../components/ui/ArtistBadge";
import { FanOnlyBadge } from "../../components/ui/FanOnlyBadge";
import { subjectOfId, type Subject } from "./bands";
import { Countdown, daysAway } from "./Ticket";
import { DEADLINE_KINDS, clockText, md } from "./deadlines";

/** How many rows each quiet group shows; the two "today" groups are the point, so they show more. */
const ROWS = 3;
const TODAY_ROWS = 5;

function Row({ d, from }: { d: DeadlineView; from: string }) {
  const kind = DEADLINE_KINDS[d.kind];
  return <li className={d.soon ? "soon" : ""}>
    <div className="dn"><b>{daysAway(d.day, from)}</b><span>{md(d.day)}</span></div>
    <div>
      <div className={`k ${kind.className}`}>{kind.label}<i>{clockText(d.localTime, d.timezone)}</i></div>
      <Countdown at={d.at} timezone={d.timezone} from={from} />
      <Link className="tt block" to={`/items/${d.itemId}`}><FanOnlyBadge organizer={d.organizer} className="mr-1.5 align-[1px]" />{d.title}</Link>
      <ArtistLine subjects={d.subjects.map(subjectOfId).filter((s): s is Subject => !!s)} className="mt-2" />
    </div>
  </li>;
}

function Group({ title, items, from, max }: { title: string; items: DeadlineView[]; from: string; max: number }) {
  if (items.length === 0) return null;
  // 标题写这一组真的印出来几条：截断时（今天有 11 条只印 5 张）写成「5 / 11」，别让人以为下面还有 6 张。
  const shown = Math.min(items.length, max);
  return <div className="mt-3.5 first:mt-0">
    <h3 className="text-[12px] font-extrabold tracking-[.04em] text-ink-3">{title}<span className="ml-1.5 font-normal text-ink-4">{items.length > max ? `${shown} / ${items.length}` : items.length}</span></h3>
    <ol className="radar">{items.slice(0, shown).map((d, i) => <Row key={`${d.itemId}-${d.at}-${i}`} d={d} from={from} />)}</ol>
  </div>;
}

/**
 * The home page's answer to 「现在该做什么」: the radar's own rows for the near days, split by what the
 * reader can still act on — a show today, a window closing today, something about to go on sale, then
 * everything else soonest first. Nothing here is a second date calculation: the rows, the day buckets and
 * the announcement's own clock all come from the same window the radar and the calendar read.
 */
export function ActionCenter({ data }: { data: ActionCenterResponse }) {
  const total = data.liveToday.length + data.dueToday.length + data.onSale.length + data.upcoming.length;
  return <section className="mb-5 lg:mb-7">
    <SectionHeader title="行动中心" kicker="ACTION" count={total} aside={<Link to="/deadlines">{md(data.from)}–{md(data.to)} 全部</Link>} />
    {total === 0 ? <p className="py-4 text-[13px] text-ink-3">这段时间内暂无已收录的日程。</p> : <>
      <Group title="今天有活动" items={data.liveToday} from={data.from} max={TODAY_ROWS} />
      <Group title="今天截止" items={data.dueToday} from={data.from} max={TODAY_ROWS} />
      <Group title="即将开售" items={data.onSale} from={data.from} max={ROWS} />
      <Group title="接下来" items={data.upcoming} from={data.from} max={ROWS} />
    </>}
  </section>;
}
