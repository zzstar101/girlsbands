// Site navigation in one place: the desktop sidebar's sections and the phone tab bar's tabs.
//
// The order follows what a fan needs, not what a news site shows: the timeline first, then the
// tracking views (Live, tickets, releases) that answer "what am I about to miss", then the archive
// and the site's own pages. Every target here is a real page.
import type { ReactNode } from "react";
import { ENTITIES, FRANCHISES } from "@girlsbands/industry/taxonomy";
import { subjectAfter, withSubject } from "@girlsbands/industry/site";
import {
  IconBell, IconBolt, IconBookmark, IconCalendar, IconClock, IconDisc, IconDoc, IconFlame, IconHeart, IconHistory, IconList, IconMail, IconMessage, IconPlug, IconTicket, IconUser,
} from "../icons";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
  /** Shows the unread dot while the changelog has news. */
  changelog?: boolean;
}

export const SIDEBAR: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "情报",
    items: [
      { to: "/", label: "首页", icon: IconBolt, end: true },
      { to: "/all", label: subjectAfter("全部", "动态"), icon: IconList },
      { to: "/hot", label: "热点榜", icon: IconFlame },
      { to: "/daily", label: withSubject("日报"), icon: IconDoc },
      { to: "/starred", label: "收藏", icon: IconBookmark },
    ],
  },
  // The franchises the site covers (industry/taxonomy.ts FRANCHISES), one entry each. A project's page
  // carries its bands' news too, so this is a fan's home base rather than a filter.
  {
    title: "企划",
    items: FRANCHISES.map((id, i) => ({
      to: `/topics/${id}`,
      label: ENTITIES[id].displayTag ?? ENTITIES[id].name,
      icon: [IconFlame, IconHeart, IconDisc][i] ?? IconDisc,
    })),
  },
  // The tracking views. Each is a topic page over one 情报领域, so the taxonomy drives navigation.
  {
    title: "追踪",
    items: [
      { to: "/deadlines", label: "截止雷达", icon: IconClock },
      { to: "/topics/live", label: "Live 与活动", icon: IconCalendar },
      { to: "/topics/ticket", label: "票务与抽选", icon: IconTicket },
      { to: "/topics/release", label: "发售与周边", icon: IconDisc },
      { to: "/topics/notice", label: "官方通知", icon: IconBell },
    ],
  },
  {
    title: "更多",
    items: [
      { to: "/agent", label: "Agent 接入", icon: IconPlug },
      { to: "/about", label: "关于", icon: IconHeart },
      { to: "/changelog", label: "更新日志", icon: IconHistory, changelog: true },
      { to: "/subscribe", label: "邮件订阅", icon: IconMail },
      { to: "/feedback", label: "反馈", icon: IconMessage },
    ],
  },
];

/** A sidebar entry is lit on its pages; 日报 also covers weekly and monthly reports. */
export function sidebarIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The phone tab bar: the timeline, everything published, then the two views a fan opens on the train
 * — Live and 票务 — and "我的" at /more. Which tab a page sits under is declared by the page itself
 * (components/shell/screens.ts); pages that carry no tab of their own fall back to `tabForPath`.
 */
export type TabKey = "featured" | "feed" | "live" | "ticket" | "me";

export interface Tab {
  key: TabKey;
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  changelog?: boolean;
}

export const TABS: Tab[] = [
  { key: "featured", to: "/", label: "首页", icon: IconBolt },
  { key: "feed", to: "/all", label: "动态", icon: IconList },
  { key: "live", to: "/topics/live", label: "Live", icon: IconCalendar },
  { key: "ticket", to: "/deadlines", label: "截止", icon: IconClock },
  { key: "me", to: "/more", label: "我的", icon: IconUser, changelog: true },
];

/**
 * The bar tab for a path whose page cannot declare one: one route renders every topic, so only the
 * pathname says whether it is the Live view or the ticket view.
 */
export function tabForPath(pathname: string): TabKey | undefined {
  const bare = pathname.replace(/\/page\/\d+$/, "");
  const tab = TABS.find((t) => t.to === bare);
  return tab && tab.key !== "me" ? tab.key : undefined;
}
