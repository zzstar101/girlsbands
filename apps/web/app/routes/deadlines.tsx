import { Link, useLoaderData } from "react-router";
import type { ReactNode } from "react";
import type { Route } from "./+types/deadlines";
import type { DeadlineKind, DeadlineView, DeadlinesResponse } from "@girlsbands/contracts/site";
import { ENTITIES, FRANCHISES } from "@girlsbands/industry/taxonomy";
import { subjectAfter, withSubject } from "@girlsbands/industry/site";
import { edgeTtl, loadOr404 } from "../lib/api.server";
import { listPath, pageMeta } from "../lib/seo";
import { weekdayShort } from "../lib/format";
import { DayHeader } from "../features/feed/Timeline";
import { Ticket, daysAway, Countdown } from "../features/feed/Ticket";
import { subjectOfId } from "../features/feed/bands";
import { DEADLINE_KINDS, clockText, dayName, md } from "../features/feed/deadlines";
import { ArtistLine } from "../components/ui/ArtistBadge";
import { EmptyState } from "../components/ui/Page";
import { IconCalendar, IconInfo } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "ticket", name: "截止雷达" };

const HORIZON_DAYS = 30;

/** The kinds worth a chip, in the order a ticket lives through them. Releases, merch and `other` stay reachable through 「全部」. */
const KIND_FILTERS: DeadlineKind[] = ["lottery_start", "lottery_end", "result", "sale_start", "sale_end", "payment_deadline", "stream_end", "event"];

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const subject = url.searchParams.get("subject")?.trim() || null;
  const kinds = url.searchParams.get("kinds")?.trim() || null;
  const path = listPath("/api/site/deadlines", { horizon: HORIZON_DAYS, subject, kinds });
  return { deadlines: await loadOr404<DeadlinesResponse>(path, { signal: request.signal }), subject, kinds };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const subject = loaderData?.subject ?? null;
  const kinds = loaderData?.kinds ?? null;
  return pageMeta({
    title: withSubject("截止雷达"),
    description: `${subjectAfter("未来 30 天", "圈")}所有会过期的日子：抽选与先行受理截止、一般发售开卖、演出当天、配信观看期限。`,
    // A filtered list is the same dates in a different order: indexable only in its full form.
    path: listPath("/deadlines", { subject, kinds }),
    noindex: Boolean(subject || kinds),
    image: "/og/pages/deadlines.png",
  });
}

export function headers() {
  return edgeTtl(300);
}

function Row({ d, from }: { d: DeadlineView; from: string }) {
  const kind = DEADLINE_KINDS[d.kind];
  const subjects = d.subjects.flatMap((id) => {
    const s = subjectOfId(id);
    return s ? [s] : [];
  });
  const date = d.publishedAt ? new Date(d.publishedAt) : null;
  return (
    <li className={`radar-row ${d.soon ? 'soon' : ''}`}>
      <span className="radar-date"><b>{daysAway(d.day, from)}</b><span>{md(d.day)}</span></span>
      <div className="min-w-0"><span className={`block text-[12px] font-bold ${kind.className}`}>{kind.label} · {clockText(d.localTime, d.timezone)}</span><Countdown at={d.at} timezone={d.timezone} from={from} /></div>
      <div className="min-w-0">
        <h3 className="text-[15px] font-[650] leading-[1.55] text-ink">
          <Link viewTransition to={`/items/${d.itemId}`} prefetch="intent" className="transition-colors group-hover:text-accent">
            {d.note ? <span className="text-accent">{d.note}</span> : null}
            {d.note ? <span className="text-ink-4"> · </span> : null}
            {d.title}
          </Link>
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <ArtistLine subjects={subjects} />
          <span className="text-[12px] text-ink-4">{d.source.name}</span>
          {date && (
            <span className="hidden text-[12px] text-ink-4 lg:inline">
              原报 <span className="num">{date.getUTCMonth() + 1}</span> 月 <span className="num">{date.getUTCDate()}</span> 日
            </span>
          )}
        </div>
      </div>
      <span className="col-start-2 mt-1 text-[11.5px] text-ink-4 lg:col-start-4 lg:mt-0 lg:justify-self-end">
        {d.selected ? "已选入" : ""}
      </span>
    </li>
  );
}

function Chip({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      to={to}
      aria-current={active ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${active ? "border-band bg-band text-white" : "border-line text-ink-3 hover:border-band hover:text-band"}`}
    >
      {children}
    </Link>
  );
}

/** The two ways a reader narrows the radar: which franchise, and which kind of dated point. */
function FilterBar({ subject, kinds }: { subject: string | null; kinds: string | null }) {
  const href = (next: { subject?: string | null; kinds?: string | null }) =>
    listPath("/deadlines", {
      subject: next.subject === undefined ? subject : next.subject,
      kinds: next.kinds === undefined ? kinds : next.kinds,
    });
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-ink-4">企划</span>
        <Chip to={href({ subject: null })} active={!subject}>全部</Chip>
        {FRANCHISES.map((id) => <Chip key={id} to={href({ subject: id })} active={subject === id}>{ENTITIES[id].name}</Chip>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-ink-4">种类</span>
        <Chip to={href({ kinds: null })} active={!kinds}>全部</Chip>
        {KIND_FILTERS.map((k) => <Chip key={k} to={href({ kinds: k })} active={kinds === k}>{DEADLINE_KINDS[k].label}</Chip>)}
      </div>
    </div>
  );
}

export default function DeadlinesPage() {
  const { deadlines, subject, kinds } = useLoaderData<typeof loader>();
  const { days, total, from, to } = deadlines;
  const soon = days.flatMap((d) => d.items.filter((i) => i.soon));
  const filtered = Boolean(subject || kinds);
  return (
    <div className="pb-10">
      <PhoneBar
        title="截止雷达"
        large
        sub={<>{subjectAfter("未来 30 天", "圈")}共 {total} 个会过期的日子</>}
        actions={
          <a href="/calendar.ics" aria-label="订阅日历" title="订阅日历（.ics）" className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors active:bg-bg-sunk">
            <IconCalendar size={18} />
          </a>
        }
      />
      <header className="hidden flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-5 pt-1 lg:flex">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-hot">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-hot opacity-30" />
              <span className="relative inline-flex size-2 rounded-full bg-hot" />
            </span>
            先看会过期的
          </div>
          <h1 className="mt-1.5 text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">{withSubject("截止雷达")}</h1>
          <p className="mt-1.5 text-[13.5px] text-ink-3">
            {md(from)} – {md(to)}，{subjectAfter("圈", "")}
            <span className="num">{total}</span> 个有明确日期的节点：抽选与先行受理、一般发售、演出当天、配信期限
          </p>
        </div>
        <div className="flex items-center gap-4">
          {soon.length > 0 && (
            <p className="text-[12px] text-hot">
              48 小时内 <span className="num">{soon.length}</span> 个
            </p>
          )}
          <a
            href="/calendar.ics"
            title="订阅后日历应用会自动更新（.ics）"
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12.5px] text-ink-3 transition-colors hover:border-band hover:text-band"
          >
            <IconCalendar size={14} /> 订阅日历
          </a>
        </div>
      </header>

      <FilterBar subject={subject} kinds={kinds} />

      {days.length > 0 && <div className="tickets mb-7">{days.flatMap((d) => d.items).slice(0, 3).map((d, i) => <Ticket key={i} item={d} from={from} />)}</div>}
      {days.length === 0 ? (
        <div className="card rounded-sheet">
          <EmptyState title={filtered ? "这个筛选下未来 30 天没有已公布的截止日" : "未来 30 天没有已公布的截止日"}>
            {filtered ? "换一个企划或种类，或者看全部。" : "等到有明确日期的公告时，这里会列出抽选、发售与演出当天。"}
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <section key={day.date} aria-label={day.date}>
              <DayHeader day={day.date} today={from} count={day.items.length} />
              <ol className="card divide-y divide-line-soft overflow-hidden">
                {day.items.map((d, i) => (
                  <Row key={`${d.itemId}-${d.at}-${i}`} d={d} from={from} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      <details className="disclosure group/method mt-8 text-[12px] text-ink-4">
        <summary className="flex items-center gap-1.5 py-1 transition-colors hover:text-ink-2">
          <IconInfo size={15} />
          这些日期是怎么来的？
          <span className="ml-auto inline-flex items-center gap-0.5">
            <span className="group-open/method:hidden">了解来源</span>
            <span className="hidden group-open/method:inline">收起</span>
          </span>
        </summary>
        <div className="max-w-[760px] space-y-2 pb-2 pl-[21px] pt-2 leading-[1.75] text-ink-3">
          <p>每一条都是从公告原文里读出来的日期，并保留原句作为凭据；原文没有写明日期的节点不会出现在这里，我们不会替官方推算。</p>
          <p>
            日期与时刻按公告写的那一地时间显示：日本的活动是日本时间（JST），国内的活动是北京时间。我们不替官方换算，也不替官方推算。一行只代表一个节点，同一条公告里的受理期与一般发售会拆成两行。
          </p>
          <p>这里不只有已选入头条的公告：只要公告本身写清了日期，就会进入雷达——截止日不值得上头条，但值得你提前知道。</p>
          <p>
            想提前记进自己的日历，可以
            <a href="/calendar.ics" className="mx-0.5 text-band hover:underline">订阅日历</a>
            ：全站未来一年的日期都在里面。每个企划和每支乐队的页面右上角也有各自的日历。
          </p>
        </div>
      </details>

      {/* 会点进这一页的人，多半是真要出门的：把远征那一层（票务流程、交通、打 call）放在最容易顺手点到的地方。 */}
      <p className="mt-5 text-[12.5px] leading-[1.75] text-ink-4">
        要去现地看演出？
        <Link to="/guide" className="mx-0.5 text-band hover:underline">远征参考</Link>
        把公开的远征攻略与座位视角实拍收在一处；这一页管日期，那一页管怎么去。
      </p>
    </div>
  );
}
