// 一场演出的页面：报告是「谁在什么时候说了什么」，这一页回答的是另一个问题 ——
// 这场 Live 现在走到哪一步、什么时候开演、票务节点还剩几天。身份来自 live_events，阶段由 api 读时算出来。
import { Link, useLoaderData } from "react-router";
import type { LiveEventView } from "@girlsbands/contracts/site";
import { timezoneDate } from "@girlsbands/contracts/time";
import { SITE } from "@girlsbands/industry/site";
import type { Route } from "./+types/live";
import { edgeTtl, loadOr404 } from "../lib/api.server";
import { breadcrumbLd, pageMeta, siteUrl, titled } from "../lib/seo";
import { monthDay, relativeTime, weekdayShort } from "../lib/format";
import { DEADLINE_KINDS, clockText, dayName, md } from "../features/feed/deadlines";
import { ROUND_KINDS, ROUND_STATUS, roundDates } from "../features/feed/tickets";
import { Countdown, daysAway } from "../features/feed/Ticket";
import { subjectOfId } from "../features/feed/bands";
import { LIVE_STAGES, openStage } from "../features/feed/lives";
import { ArtistLine } from "../components/ui/ArtistBadge";
import { Badge } from "../components/ui/Badge";
import { CoverImage } from "../components/ui/CoverImage";
import { EmptyState } from "../components/ui/Page";
import { IconArrowLeft, IconCalendar } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { home: "feed" };

export async function loader({ params, request }: Route.LoaderArgs) {
  const live = await loadOr404<LiveEventView>(`/api/site/lives/${encodeURIComponent(params.publicId)}`, { signal: request.signal });
  return { live, today: timezoneDate(live.timezone, Date.now()) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: titled("演出不存在") }, { name: "robots", content: "noindex" }];
  const { live } = loaderData;
  const where = live.venue ? `在${live.venue}` : "";
  const when = `${monthDay(live.startsOn)}${live.startsTime ? ` ${live.startsTime}` : ""}`;
  return pageMeta({
    title: `${live.subjectName} ${live.title}`,
    description: `${live.subjectName}${where}${when}的演出：${live.reportCount} 篇相关公告的日期、票务节点与最新进展。`,
    path: `/live/${live.publicId}`,
    jsonLd: breadcrumbLd([
      { name: SITE.name, path: "/" },
      { name: live.subjectName, path: `/topics/${live.subject}` },
      { name: live.title, path: `/live/${live.publicId}` },
    ]),
  });
}

export function headers() {
  return edgeTtl(300);
}

export default function LiveRoute() {
  const { live, today } = useLoaderData<typeof loader>();
  const stage = LIVE_STAGES[live.stage];
  const subject = subjectOfId(live.subject);
  const subjects = subject ? [subject] : [];
  const back = subject ? { to: `/topics/${subject.id}`, label: subject.label } : { to: "/", label: "首页" };
  const date = live.endsOn && live.endsOn !== live.startsOn ? `${monthDay(live.startsOn)} – ${monthDay(live.endsOn)}` : monthDay(live.startsOn);
  const name = dayName(live.startsOn, today);
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-10">
      <PhoneBar back={back} title={live.title} />
      <Link to={back.to} className="hidden items-center gap-1.5 py-2 text-[13px] text-ink-3 transition-colors hover:text-accent lg:inline-flex">
        <IconArrowLeft size={14} /> 返回{back.label}
      </Link>

      {/* 演出的主视觉通常是横幅：有就摆在页面最上面，没有就整页还是纯文字。 */}
      <CoverImage cover={live.cover} className="mt-3 h-auto w-full rounded-lg shadow-sm lg:mt-1" priority />

      <header className="pb-5 pt-3 lg:pt-1">
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-band">
          <span aria-hidden="true" className="h-[2px] w-6 flex-none rounded-full bg-band" />
          演出
        </p>
        <h1 data-page-title="" className="mt-1.5 text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">{live.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Badge tone={stage.tone} dot>{stage.label}</Badge>
          <ArtistLine subjects={subjects} />
          {live.venue && <span className="text-[13px] text-ink-3">{live.venue}</span>}
        </div>
        <p className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13.5px] text-ink-3">
          <span className="num text-ink">
            {date}（{weekdayShort(live.startsOn)}）{live.startsTime ? ` ${live.startsTime}` : ""}
          </span>
          <span className="text-[12.5px] text-ink-4">{clockText(live.startsTime, live.timezone)}</span>
          {openStage(live.stage) && (
            <span className="text-[12.5px] text-ink-4">
              {name ? `${name} · ` : ""}D-{daysAway(live.startsOn, today)}
            </span>
          )}
        </p>
        {live.startsTime && openStage(live.stage) && (
          <p className="mt-1.5 text-[12.5px] text-ink-4"><Countdown at={`${live.startsOn}T${live.startsTime}`} timezone={live.timezone} from={today} /></p>
        )}
      </header>

      <section className="card p-5 lg:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-[650] leading-[1.5] text-ink">票务与日程</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-4">
              {live.rounds.length > 0
                ? "每一轮受理的开放与截止，以及公告里写明的其它日期，都按公告那一地的时间，不做换算"
                : "公告里写明的日期与时刻，按公告那一地的时间，不做换算"}
            </p>
          </div>
          <a href={`/calendar/${live.subject}.ics`} title="订阅这支乐队的日历（.ics）" className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12.5px] text-ink-3 transition-colors hover:border-band hover:text-band">
            <IconCalendar size={14} /> 订阅日历
          </a>
        </div>
        {live.rounds.length > 0 && (
          <ol className="mt-3.5 space-y-2.5">
            {live.rounds.map((r) => {
              const status = ROUND_STATUS[r.status];
              const kind = ROUND_KINDS[r.kind];
              const dates = roundDates(r);
              const next = dates.find((d) => d.date.day >= today);
              return (
                <li key={r.publicId} className="rounded-lg border border-line-soft p-3">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <span className={`text-[13.5px] font-bold ${kind.className}`}>{kind.label}</span>
                    {r.platform && <span className="text-[12.5px] text-ink-3">{r.platform}</span>}
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {next && <span className="num text-[12px] text-ink-4"><Countdown at={next.date.at} timezone={r.timezone} from={today} /></span>}
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {dates.map((d) => (
                      <li key={d.key} className="text-[12.5px] text-ink-3">
                        <span className="text-ink-4">{d.label} </span>
                        <span className={`num ${d.date.day < today ? "text-ink-4" : "text-ink-2"}`}>{md(d.date.day)}</span>{" "}
                        <span className="num text-ink-4">{clockText(d.date.localTime, r.timezone)}</span>
                      </li>
                    ))}
                  </ul>
                  {r.itemId && (
                    <p className="mt-1.5 text-[13px]">
                      <Link to={`/items/${r.itemId}`} prefetch="intent" className="text-ink-3 transition-colors hover:text-accent">{r.title}</Link>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {live.dates.length === 0 && live.rounds.length === 0 ? (
          <EmptyState title="公告里还没有写出日期">这场演出的公告只说了要办，没说哪一天；等原文写明，这里就会出现。</EmptyState>
        ) : live.dates.length > 0 ? (
          <>
            {live.rounds.length > 0 && <p className="mt-4 text-[12px] font-semibold tracking-[0.06em] text-ink-4">公告里的其它日期</p>}
            <ol className="mt-3 divide-y divide-line-soft">
              {live.dates.map((d) => {
                const kind = DEADLINE_KINDS[d.kind];
                return (
                  <li key={`${d.itemId}-${d.at}-${d.kind}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                    <span className="num w-[92px] shrink-0 text-[13px] text-ink-2">{md(d.day)}</span>
                    <span className={`shrink-0 text-[12px] font-bold ${kind.className}`}>{kind.label}</span>
                    <span className="num shrink-0 text-[12.5px] text-ink-3">{clockText(d.localTime, d.timezone)}</span>
                    <Link to={`/items/${d.itemId}`} prefetch="intent" className="min-w-0 flex-1 truncate text-[13.5px] text-ink-3 transition-colors hover:text-accent">
                      {d.note ? <span className="text-accent">{d.note} · </span> : null}
                      {d.title}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
      </section>

      <section className="card mt-5 p-5 lg:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-[650] leading-[1.5] text-ink">{live.reportCount} 篇相关公告</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-4">售票、追加情报与官方通知，都能点进去看原文</p>
          </div>
          {live.story && (
            <Link to={`/story/${live.story.publicId}`} prefetch="intent" className="shrink-0 text-[12.5px] text-band hover:underline">
              看事件全貌 →
            </Link>
          )}
        </div>
        <ol className="mt-3.5 divide-y divide-line-soft">
          {live.reports.map((r) => (
            <li key={r.id} className="py-2.5">
              <h3 className="text-[14.5px] font-[650] leading-[1.6] text-ink">
                <Link to={`/items/${r.id}`} prefetch="intent" className="transition-colors hover:text-accent">{r.title}</Link>
              </h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[12px] text-ink-4">
                <span>{r.source.name}</span>
                <span className="num">{relativeTime(r.publishedAt)}</span>
                {r.selected && <span className="text-accent">已选入</span>}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* 散场之后才有的那一层：曲目单是从原文里找出来的，不是我们猜的；读者可以补，管理员采纳后进库。 */}
      {live.stage === "finished" && (
        <section className="card mt-5 p-5 lg:p-6">
          <div>
            <h2 className="text-[17px] font-[650] leading-[1.5] text-ink">曲目单</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-4">
              {live.setlist.length > 0
                ? "曲名照原文，顺序也照原文 —— 原文没写的不会替演出补上"
                : live.setlistScanned
                  ? "问过这场演出的报道了，原文里没有写曲目单"
                  : "等现场报道出来，这里会去原文里找"}
            </p>
          </div>
          {live.setlist.length > 0 && (
            <ol className="mt-3.5 divide-y divide-line-soft">
              {live.setlist.map((song, index) => (
                <li key={`${song.source}-${song.position}`}>
                  {song.isEncore && !live.setlist[index - 1]?.isEncore && (
                    <p className="mt-3 text-[12px] font-semibold tracking-[0.06em] text-ink-4">安可</p>
                  )}
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                    <span className="num w-[26px] shrink-0 text-[13px] text-ink-4">{index + 1}</span>
                    <span className="text-[14.5px] font-[650] text-ink">{song.title}</span>
                    {song.isCover && <span className="text-[12px] text-ink-4">翻唱</span>}
                    {song.source === "reader" && <span className="text-[12px] text-ink-4">读者补充</span>}
                    {song.itemId && (
                      <Link to={`/items/${song.itemId}`} prefetch="intent" className="text-[12.5px] text-ink-3 transition-colors hover:text-accent">出处</Link>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-4 text-[12.5px] leading-[1.75] text-ink-4">
            {live.setlist.length > 0 ? "漏了或者写错了？" : "你要是在现场？"}
            <Link to={`/feedback?from=${encodeURIComponent(`${siteUrl()}/live/${live.publicId}`)}`} className="mx-0.5 text-band hover:underline">
              补一条曲目单
            </Link>
            一行一首，本站核对之后收进这一页。
          </p>
        </section>
      )}

      <p className="mt-6 text-[12px] leading-[1.75] text-ink-4">
        这一页把同一场演出的多条公告收到一起：它们可能在信息流里归给了不同的事件，但读者问的是同一件事。
        <Link to={`/topics/${live.subject}`} className="mx-0.5 text-band hover:underline">去{live.subjectName}的主页</Link>
        看这个主题的全部动态。本站 <time dateTime={live.firstSeenAt}>{relativeTime(live.firstSeenAt)}</time>首次收录，
        <time dateTime={live.updatedAt}>{relativeTime(live.updatedAt)}</time>最近更新。
      </p>

      {/* 已经决定要出门的人才会翻到这一页的底部：远征那一层就挂在这里。 */}
      <p className="mt-3 text-[12px] leading-[1.75] text-ink-4">
        要去现地？
        <Link to="/guide" className="mx-0.5 text-band hover:underline">远征参考</Link>
        把公开的远征攻略与座位视角实拍收在一处。
      </p>
    </div>
  );
}
