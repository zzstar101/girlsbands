// 一张碟的页面：这一页回答的是「这张碟是什么、什么时候出、里面有什么」。身份来自 releases 那一族表，
// 版本与店铺特典是公告里写下来的那些（原文没写店名就不编），序列号能指到一场有页面的演出时给出入口。
// 应募期间不在这里：它属于那场演出的轮次，演出页上写着。
import { Link, useLoaderData } from "react-router";
import type { ReleaseView } from "@girlsbands/contracts/site";
import { SITE } from "@girlsbands/industry/site";
import type { Route } from "./+types/release";
import { edgeTtl, loadOr404 } from "../lib/api.server";
import { breadcrumbLd, pageMeta, titled } from "../lib/seo";
import { monthDay, relativeTime, weekdayShort } from "../lib/format";
import { EDITION_KINDS, RELEASE_KINDS, SERIAL_KINDS, priceText, releaseProgress } from "../features/feed/releases";
import { subjectOfId } from "../features/feed/bands";
import { ArtistLine } from "../components/ui/ArtistBadge";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/Page";
import { IconArrowLeft } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { home: "feed" };

export async function loader({ params, request }: Route.LoaderArgs) {
  const release = await loadOr404<ReleaseView>(`/api/site/releases/${encodeURIComponent(params.publicId)}`, { signal: request.signal });
  return { release };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: titled("发售不存在") }, { name: "robots", content: "noindex" }];
  const { release } = loaderData;
  const when = release.releaseOn ? `${monthDay(release.releaseOn)}发售` : "即将发售";
  const extras = [
    release.editions.length > 0 ? `${release.editions.length} 个版本` : null,
    release.bonuses.length > 0 ? "店铺特典" : null,
    release.serials.length > 0 ? "序列号" : null,
  ].filter(Boolean).join("、");
  return pageMeta({
    title: `${release.subjectName} ${release.title}`,
    description: `${release.subjectName}${when}的${RELEASE_KINDS[release.kind].label}：${extras ? `${extras}，` : ""}公告原文与全部细节。`,
    path: `/release/${release.publicId}`,
    image: `/og/releases/${release.publicId}.png`,
    jsonLd: breadcrumbLd([
      { name: SITE.name, path: "/" },
      { name: release.subjectName, path: `/topics/${release.subject}` },
      { name: release.title, path: `/release/${release.publicId}` },
    ]),
  });
}

export function headers() {
  return edgeTtl(300);
}

export default function ReleaseRoute() {
  const { release } = useLoaderData<typeof loader>();
  const kind = RELEASE_KINDS[release.kind];
  const progress = releaseProgress(release.daysLeft);
  const subject = subjectOfId(release.subject);
  const subjects = subject ? [subject] : [];
  const back = subject ? { to: `/topics/${subject.id}`, label: subject.label } : { to: "/", label: "首页" };
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-10">
      <PhoneBar back={back} title={release.title} />
      <Link to={back.to} className="hidden items-center gap-1.5 py-2 text-[13px] text-ink-3 transition-colors hover:text-accent lg:inline-flex">
        <IconArrowLeft size={14} /> 返回{back.label}
      </Link>

      <header className="pb-5 pt-3 lg:pt-1">
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-accent">
          <span aria-hidden="true" className="h-[2px] w-6 flex-none rounded-full bg-accent" />
          发售
        </p>
        <h1 data-page-title="" className="mt-1.5 text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">{release.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className={`text-[13px] font-bold ${kind.className}`}>{kind.label}</span>
          <ArtistLine subjects={subjects} />
          {release.announcedOn && <span className="text-[12.5px] text-ink-4">公告公布于 {monthDay(release.announcedOn)}</span>}
        </div>
        <p className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13.5px] text-ink-3">
          {release.releaseOn ? (
            <span className="num text-ink">
              {monthDay(release.releaseOn)}（{weekdayShort(release.releaseOn)}）发售
            </span>
          ) : (
            <span className="text-ink-3">公告还没写出具体发售日</span>
          )}
          {progress && <span className="text-[12.5px] text-ink-4">{progress}</span>}
        </p>
      </header>

      <section className="card p-5 lg:p-6">
        <h2 className="text-[17px] font-[650] leading-[1.5] text-ink">版本</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-4">公告里写明的每一个版本；名称照抄原文，不做归并</p>
        {release.editions.length === 0 ? (
          <EmptyState title="公告里没有写版本">这一条只说了要发售，没写有哪些版本。</EmptyState>
        ) : (
          <ul className="mt-3.5 space-y-2.5">
            {release.editions.map((e) => {
              const price = priceText(e.priceYen);
              return (
                <li key={e.name} className="rounded-lg border border-line-soft p-3">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <span className="text-[14px] font-bold text-ink">{e.name}</span>
                    <span className="text-[12px] text-ink-4">{EDITION_KINDS[e.kind]}</span>
                    {e.includesBluray && <Badge tone="neutral">含 Blu-ray</Badge>}
                    {e.includesSerial && <Badge tone="amber">含序列号</Badge>}
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
                    {price && <span className="num text-ink-2">{price}</span>}
                    {e.sku && <span className="num text-ink-4">{e.sku}</span>}
                  </p>
                  {e.quote && <p className="mt-1.5 text-[12.5px] leading-[1.7] text-ink-4">「{e.quote}」</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card mt-5 p-5 lg:p-6">
        <h2 className="text-[17px] font-[650] leading-[1.5] text-ink">店铺特典</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-4">公告点名了哪家店、送什么才写在这里；只写「対象店舗」的不编</p>
        {release.bonuses.length === 0 ? (
          <EmptyState title="公告里没有写店铺特典">想买的话，直接看原文里的发售页面。</EmptyState>
        ) : (
          <ul className="mt-3.5 divide-y divide-line-soft">
            {release.bonuses.map((b) => (
              <li key={`${b.retailer}-${b.bonus}-${b.editionName ?? ""}`} className="py-2.5">
                <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="text-[13.5px] font-bold text-ink">{b.retailer}</span>
                  {b.firstPress && <Badge tone="amber">先到先得</Badge>}
                  {b.editionName && <span className="text-[12px] text-ink-4">{b.editionName}</span>}
                </p>
                <p className="mt-0.5 text-[13.5px] leading-[1.7] text-ink-2">
                  {b.url ? (
                    <a href={b.url} target="_blank" rel="noopener noreferrer" className="text-ink-3 transition-colors hover:text-accent">{b.bonus}</a>
                  ) : b.bonus}
                </p>
                {b.quote && <p className="mt-0.5 text-[12.5px] leading-[1.7] text-ink-4">「{b.quote}」</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {release.serials.length > 0 && (
        <section className="card mt-5 p-5 lg:p-6">
          <h2 className="text-[17px] font-[650] leading-[1.5] text-ink">序列号</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-4">碟里的应募券能换哪一场；应募期间在那场演出的页面上</p>
          <ul className="mt-3.5 divide-y divide-line-soft">
            {release.serials.map((s) => {
              const serial = SERIAL_KINDS[s.kind];
              return (
                <li key={`${s.kind}-${s.live?.publicId ?? s.liveTitle ?? ""}`} className="py-2.5">
                  <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <span className={`text-[13px] font-bold ${serial.className}`}>{serial.label}</span>
                    {s.live ? (
                      <Link to={`/live/${s.live.publicId}`} prefetch="intent" className="text-[13.5px] text-ink transition-colors hover:text-accent">
                        {s.live.title}
                      </Link>
                    ) : s.liveTitle ? (
                      <span className="text-[13.5px] text-ink-2">{s.liveTitle}</span>
                    ) : (
                      <span className="text-[13px] text-ink-4">公告没写换哪一场</span>
                    )}
                    {s.live && <span className="num text-[12px] text-ink-4">{monthDay(s.live.startsOn)}</span>}
                  </p>
                  {s.url && (
                    <p className="mt-0.5 text-[12.5px]">
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-ink-3 transition-colors hover:text-accent">活动页面</a>
                    </p>
                  )}
                  {s.quote && <p className="mt-0.5 text-[12.5px] leading-[1.7] text-ink-4">「{s.quote}」</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {release.story && (
        <p className="mt-5 text-[13px]">
          <Link to={`/story/${release.story.publicId}`} prefetch="intent" className="text-band hover:underline">看这条发售的来龙去脉 →</Link>
        </p>
      )}

      <p className="mt-6 text-[12px] leading-[1.75] text-ink-4">
        这一页把同一张碟的多条公告收到一起：哪几个版本、哪家店送什么、序列号换哪一场，都能点回原文。
        <Link to={`/topics/${release.subject}`} className="mx-0.5 text-band hover:underline">去{release.subjectName}的主页</Link>
        看这个主题的全部动态。本站 <time dateTime={release.firstSeenAt}>{relativeTime(release.firstSeenAt)}</time>首次收录，
        <time dateTime={release.updatedAt}>{relativeTime(release.updatedAt)}</time>最近更新。
      </p>
    </div>
  );
}
