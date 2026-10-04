import { Link, useLoaderData } from "react-router";
import type { DeadlineView, DeadlinesResponse } from "@aihot/contracts/site";
import { subjectAfter, withSubject } from "@aihot/industry/site";
import { edgeTtl, loadOr404 } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { weekdayShort } from "../lib/format";
import { subjectOfId } from "../features/feed/bands";
import { DEADLINE_KINDS, clock, dayName, md } from "../features/feed/deadlines";
import { ArtistLine } from "../components/ui/ArtistBadge";
import { EmptyState } from "../components/ui/Page";
import { IconInfo } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "live", name: "截止雷达" };

const HORIZON_DAYS = 30;

export async function loader({ request }: { request: Request }) {
  const path = `/api/site/deadlines?horizon=${HORIZON_DAYS}`;
  return { deadlines: await loadOr404<DeadlinesResponse>(path, { signal: request.signal }) };
}

export function meta() {
  return pageMeta({
    title: withSubject("截止雷达"),
    description: `${subjectAfter("未来 30 天", "圈")}所有会过期的日子：抽选与先行受理截止、一般发售开卖、演出当天、配信观看期限。`,
    path: "/deadlines",
    image: "/og/pages/deadlines.png",
  });
}

export function headers() {
  return edgeTtl(300);
}

function Row({ d }: { d: DeadlineView }) {
  const kind = DEADLINE_KINDS[d.kind];
  const subjects = d.subjects.flatMap((id) => {
    const s = subjectOfId(id);
    return s ? [s] : [];
  });
  const time = clock(d.at);
  const date = d.publishedAt ? new Date(d.publishedAt) : null;
  return (
    <li className="group grid grid-cols-[52px_minmax(0,1fr)] items-start gap-x-3 px-4 py-3 transition-colors hover:bg-bg-sunk/70 sm:px-5 lg:grid-cols-[52px_68px_minmax(0,1fr)_auto] lg:items-center lg:gap-x-5 lg:px-6 dark:hover:bg-bg-muted/40">
      <span className={`mono text-[13px] font-semibold leading-[22px] tabular-nums lg:text-[14px] ${d.soon ? "text-hot" : "text-ink-2"}`}>
        {time ?? md(d.day)}
      </span>
      <span className={`self-center text-[11px] font-semibold tracking-[0.08em] ${kind.className}`} title={kind.hint}>
        {kind.label}
      </span>
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

export default function DeadlinesPage() {
  const { deadlines } = useLoaderData<typeof loader>();
  const { days, total, from, to } = deadlines;
  const soon = days.flatMap((d) => d.items.filter((i) => i.soon));
  return (
    <div className="pb-10">
      <PhoneBar title="截止雷达" large sub={<>{subjectAfter("未来 30 天", "圈")}共 {total} 个会过期的日子</>} />
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
        {soon.length > 0 && (
          <p className="text-[12px] text-hot">
            48 小时内 <span className="num">{soon.length}</span> 个
          </p>
        )}
      </header>

      {days.length === 0 ? (
        <div className="card rounded-sheet">
          <EmptyState title="未来 30 天没有已公布的截止日">等到有明确日期的公告时，这里会列出抽选、发售与演出当天。</EmptyState>
        </div>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <section key={day.date} aria-label={day.date}>
              <div className="mb-2 flex items-baseline gap-2.5 px-1">
                <h2 className="mono text-[15px] font-bold tracking-[0.04em] text-ink">{md(day.date)}</h2>
                <span className="text-[13px] text-ink-3">{dayName(day.date, from) || weekdayShort(day.date)}</span>
                <span className="num ml-auto text-[12px] text-ink-4">{day.items.length} 件</span>
              </div>
              <ol className="card divide-y divide-line-soft overflow-hidden">
                {day.items.map((d, i) => (
                  <Row key={`${d.itemId}-${d.at}-${i}`} d={d} />
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
            日期按日本时间（JST）计算，因为受理截止通常写的是日本当地的 23:59。一行只代表一个节点，同一条公告里的受理期与一般发售会拆成两行。
          </p>
          <p>这里不只有已选入头条的公告：只要公告本身写清了日期，就会进入雷达——截止日不值得上头条，但值得你提前知道。</p>
        </div>
      </details>
    </div>
  );
}
