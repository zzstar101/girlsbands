// /guide：远征参考。**本站不写攻略正文** —— 只把两份外部资料指出去（清单在 industry/guides.ts），
// 再加三个站内入口：场次与截止是站内的强项，通用赴日信息与座位视角是外部的强项。
import { Link } from "react-router";
import { GUIDE_RESOURCES } from "@girlsbands/industry/guides";
import { edgeTtl } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { SectionHeader } from "../components/ui/SectionHeader";
import { IconChevronRight, IconExternal } from "../components/icons";

export const handle: Screen = { home: "feed", name: "远征攻略" };

/** 纯静态文案 + 外链，跟法律页同档。 */
export function headers() {
  return edgeTtl(300);
}

export function meta() {
  return pageMeta({
    title: "远征攻略",
    description: "本站不重写远征攻略：先看公开的《现代远征攻略》与座位视角实拍，再用站内的截止雷达、Live 与活动、日历订阅盯场次。",
    path: "/guide",
    image: "/og/pages/guide.png",
  });
}

/** 站内能帮上忙的三个入口（`.ics` 是 api 路由，用原生 <a>）。 */
const INSIDE: Array<{ to: string; label: string; detail: string; external?: boolean }> = [
  { to: "/deadlines", label: "截止雷达", detail: "哪些演出要开票、什么时候截止" },
  { to: "/live", label: "Live 日程", detail: "接下来要办的演出，月历 + 按日期排" },
  { to: "/topics/live", label: "Live 与活动", detail: "各乐队自己的 Live、巡演与拼盘" },
  { to: "/calendar.ics", label: "日历订阅", detail: "把场次导进手机日历，到点提醒", external: true },
];

export default function GuideRoute() {
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
      <PhoneBar title="远征攻略" large />
      <header className="pb-4 pt-3 lg:pt-1">
        <h1 className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">远征攻略</h1>
        <p className="mt-1.5 max-w-[760px] text-pretty text-[13.5px] leading-relaxed text-ink-3">
          跨城或跨国去看一场 Live，真正难查的是票怎么到手、当天怎么进场、现场什么能做什么不能做。
          这类经验我们<b className="font-[650] text-ink-2">不自己重写</b>：它们变得慢、又已经有人写得更全，重写一遍只会多一份过期更快的副本。
          这一页只做指路 —— 看下面两份外部资料，场次与截止交给站内。
        </p>
      </header>
      <section className="mb-6">
        <SectionHeader title="外部资料" count={`${GUIDE_RESOURCES.length} 份`} />
        <ul className="card divide-y divide-line-soft overflow-hidden">
          {GUIDE_RESOURCES.map((r) => (
            <li key={r.id}>
              <a href={r.href} target="_blank" rel="noopener noreferrer" className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[15px] font-[650] text-ink">
                    {r.title}
                    <IconExternal size={14} className="shrink-0 text-ink-4" />
                  </span>
                  <span className="mt-0.5 block text-pretty text-[12.5px] leading-relaxed text-ink-3">{r.summary}</span>
                  <span className="mt-0.5 block text-[12px] text-ink-4">{r.source}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="pt-2 text-[12px] leading-relaxed text-ink-4">两份都是外部站点，内容与可用性由作者维护；链接挂了请从「意见反馈」告诉我们。</p>
      </section>
      <section className="mb-6">
        <SectionHeader title="本站能帮上的" count={`${INSIDE.length} 个`} />
        <ul className="card divide-y divide-line-soft overflow-hidden">
          {INSIDE.map((r) => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-[650] text-ink">{r.label}</span>
                  <span className="mt-0.5 block text-pretty text-[12.5px] leading-relaxed text-ink-3">{r.detail}</span>
                </span>
                <IconChevronRight size={16} className="shrink-0 text-ink-4" />
              </>
            );
            return (
              <li key={r.to}>
                {r.external ? (
                  <a href={r.to} className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk">{body}</a>
                ) : (
                  <Link viewTransition to={r.to} prefetch="intent" className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk">{body}</Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <p className="text-[12px] leading-relaxed text-ink-4">
        票价、规则、入场方式与场馆公告随时会变，一切以主办方、票务平台与场馆的官方公告为准；本站的攻略页只负责把它们指给你。
      </p>
    </div>
  );
}
