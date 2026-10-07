import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import type { HomeResponse } from "@girlsbands/contracts/site";
import { FRIEND_SITES, SITE } from "@girlsbands/industry/site";
import { ENTITIES, FRANCHISES, CATEGORIES } from "@girlsbands/industry/taxonomy";
import { Wordmark } from "../Logo";
import { useChangelogSeen } from "../../lib/local-state";
import { ThemeSwitch } from "./ThemeSwitch";
import { Countdown } from "../../features/feed/Ticket";
import { ArtistLine } from "../ui/ArtistBadge";
import { subjectOfId, type Subject } from "../../features/feed/bands";

export function useChangelogDot(latestVersion: string | null): boolean {
  const seen = useChangelogSeen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && !!latestVersion && (!seen || seen < latestVersion);
}
/** 友站去重（同一个站可能挂在好几支乐队下）。 */
const FRIENDS = [...new Map(Object.values(FRIEND_SITES).map((f) => [f.url, f])).values()];
const MAIN = [['/', '首页'], ['/all', '全部消息'], ['/deadlines', '截止雷达'], ['/calendar', '日历'], ['/hot', '热议'], ['/daily', '日报']] as const;
export function Sidebar({ changelogVersion, home }: { changelogVersion: string | null; home?: HomeResponse | null }) {
  const { pathname } = useLocation();
  const dot = useChangelogDot(changelogVersion);
  const next = home?.deadlines.days.flatMap((d) => d.items).find((d) => d.kind === 'lottery_end' || d.kind === 'stream_end');
  return <aside className="side hidden lg:flex">
    <Link to="/" className="logo" aria-label={`${SITE.name} 首页`}><Wordmark size={32} /></Link>
    {next && <div className="side-next"><div className="sn-top"><span>即将截止</span><Countdown at={next.at} timezone={next.timezone} from={home!.deadlines.from} flip /></div><Link to={`/items/${next.itemId}`} className="sn-title">{next.title}</Link><ArtistLine className="mt-2" subjects={next.subjects.map(subjectOfId).filter((s): s is Subject => !!s)} /></div>}
    <nav className="nav flex-1 overflow-y-auto scrollbar-thin" aria-label="主导航">
      {MAIN.map(([to, label], i) => {
        const on = pathname === to;
        return <Link key={to} to={to} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}><span className="no">0{i + 1}</span>{label}{home && i === 1 && <span className="cnt">{home.stats.today}</span>}{home && i === 2 && home.stats.soon > 0 && <span className="cnt hot">{home.stats.soon}</span>}</Link>;
      })}
      <div className="nav-title">企划<i /></div>{FRANCHISES.map((id) => <Link key={id} to={`/topics/${id}`} className={`fr ${pathname === `/topics/${id}` ? 'on' : ''}`}><span className="sw" style={{ background: ENTITIES[id].accent }} /><span className="truncate">{ENTITIES[id].displayTag ?? ENTITIES[id].name}</span>{home && <span className="cnt">{home.projects[id]?.today ?? 0}</span>}</Link>)}
      <div className="nav-title">分类<i /></div><div className="cats">{CATEGORIES.map((c) => <Link key={c.key} to={`/all?category=${c.key}`}>{c.label}</Link>)}</div>
      <div className="side-links px-2"><Link to="/starred">收藏</Link><Link to="/changelog">更新日志{dot ? ' ·' : ''}</Link><Link to="/feedback">反馈</Link></div>
    </nav>
    <div className="side-foot"><ThemeSwitch /><div className="side-links"><Link to="/subscribe">邮件订阅</Link><a href="/feed.xml">RSS</a><Link to="/agent?tab=api">API</Link><Link to="/about">关于</Link></div><div className="side-links side-friends"><span>友链</span><Link to="/guide">远征攻略</Link>{FRIENDS.map((f) => <a key={f.url} href={f.url} target="_blank" rel="noopener" title={f.note}>{f.name}</a>)}</div>{SITE.icp && <a href="https://beian.miit.gov.cn/" className="text-[10px] text-ink-4">{SITE.icp}</a>}</div>
    <div className="side-rail" aria-hidden="true"><span>GIRLSBANDS · LIVE · TICKET · RELEASE · GIRLSBANDS · LIVE · TICKET · RELEASE ·</span></div>
  </aside>;
}
