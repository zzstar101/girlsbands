// 一排乐队 logo 的筛选条（声优日常、Live 日历共用）。
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { bandLogo } from "./BandTip";

// トゲナシトゲアリ 的字标一半是白的，浅底上看不见（同 BandEqualizer 的 DARK_PLATE）。
export const DARK_PLATE = new Set(["togenashi-togeari"]);

/**
 * 乐队筛选：一排乐队 logo，不写字（站主 2026-10-08）。始终只占一行（站主：不要两行），放不下就横向滑；
 * 宽屏上鼠标竖滚轮也换成横滑，两头渐隐提示还有。选中的那块描黑边、顶上一道乐队色，进页面时滚到可见处。
 * 没有 logo 的乐队才退回文字。
 */
export function BandFilter({ bands, active, hrefOf, label = "按乐队筛选" }: {
  bands: Array<{ id: string; name: string }>;
  active: string;
  /** null = 「全部」。 */
  hrefOf: (band: string | null) => string;
  label?: string;
}) {
  const rail = useRef<HTMLElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const sync = () => setEdge({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const max = el.scrollWidth - el.clientWidth;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return; // 到头了就让页面照常滚
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("resize", sync);
    return () => { el.removeEventListener("scroll", sync); el.removeEventListener("wheel", wheel); window.removeEventListener("resize", sync); };
  }, [active, bands.length]);
  const fade = `linear-gradient(to right, ${edge.start ? "transparent" : "#000"}, #000 28px, #000 calc(100% - 28px), ${edge.end ? "transparent" : "#000"})`;
  const tile = (on: boolean) =>
    `flex h-8 shrink-0 items-center justify-center border-t-2 px-2 transition-[opacity,box-shadow] ${
      on ? "opacity-100 shadow-[0_0_0_2px_var(--ink)]" : "opacity-75 shadow-[0_0_0_1px_var(--line)] hover:opacity-100"
    }`;
  return (
    <nav ref={rail} aria-label={label} style={{ maskImage: fade, WebkitMaskImage: fade }}
      className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pb-1 pt-0.5 [scrollbar-width:none] lg:mx-0 lg:px-0.5 [&::-webkit-scrollbar]:hidden">
      <div className="flex w-max gap-1.5">
        <Link to={hrefOf(null)} replace aria-current={active === "all" ? "page" : undefined}
          className={`${tile(active === "all")} border-t-[#141216] bg-[var(--paper)] text-[12px] font-bold text-[#141216]`}>
          全部
        </Link>
        {bands.map((b) => {
          const logo = bandLogo(b.id);
          const accent = ENTITIES[b.id]?.accent ?? "var(--ink)";
          const dark = !!logo && (logo.onDark || DARK_PLATE.has(b.id));
          return (
            <Link key={b.id} to={hrefOf(b.id)} replace title={b.name} aria-label={b.name}
              aria-current={active === b.id ? "page" : undefined}
              className={`${tile(active === b.id)} ${dark ? "bg-[#141216]" : "bg-[var(--paper)]"}`} style={{ borderTopColor: accent }}>
              {logo
                ? <img src={logo.src} width={logo.width} height={logo.height} alt="" loading="lazy" className="h-5 w-auto max-w-[72px] object-contain" />
                : <span className="text-[12px] font-bold text-ink">{b.name}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
