import type { MouseEvent } from "react";
import { THEME_COLOR, applyTheme, resolvedTheme, setThemePreference } from "../../lib/local-state";

/**
 * 拉闸换场: a disc of the new paper grows out of the pressed button and covers the page, the theme swaps
 * underneath it, then the disc fades away (黑场 flickers once on the way, like house lights coming up).
 * Only transform and opacity animate on one element, so it stays smooth on phones; the expensive restyle of
 * the whole page happens while it is hidden, with transitions switched off so nothing animates colour by itself.
 * With reduced motion it just swaps.
 */
function switchTheme(choice: "dark" | "light" | "auto", event: MouseEvent<HTMLButtonElement>) {
  const root = document.documentElement;
  const key = choice === "auto" ? resolvedTheme(null) : choice;
  const apply = () => {
    root.classList.add("theme-swapping");
    setThemePreference(choice === "auto" ? null : choice);
    applyTheme(key, choice === "auto");
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-swapping")));
  };
  if (root.getAttribute("data-theme") === key || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !Element.prototype.animate) return apply();

  const box = event.currentTarget.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const r = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)));
  const disc = document.createElement("div");
  disc.className = "theme-curtain";
  disc.setAttribute("aria-hidden", "true");
  Object.assign(disc.style, { left: `${x - r}px`, top: `${y - r}px`, width: `${2 * r}px`, height: `${2 * r}px`, background: THEME_COLOR[key] });
  document.body.append(disc);

  const done = () => disc.remove();
  disc.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 480, easing: "cubic-bezier(.65,0,.25,1)", fill: "forwards" })
    .finished.then(() => {
      apply();
      // Two frames so the restyle has painted before the disc lifts.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const frames = key === "dark"
          ? [{ opacity: 1 }, { opacity: 1, offset: 0.15 }, { opacity: 0.5, offset: 0.3 }, { opacity: 0.9, offset: 0.42 }, { opacity: 0 }]
          : [{ opacity: 1 }, { opacity: 0 }];
        disc.animate(frames, { duration: key === "dark" ? 520 : 300, easing: "ease-out", fill: "forwards" }).finished.finally(done);
      }));
    })
    .catch(() => { apply(); done(); });
}

/** Two printing surfaces, or 自动 to follow the system (the default); saved across visits and tabs. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  return <div role="group" aria-label="外观" className={`theme-seg ${className}`}>
    {([['dark', '黑场'], ['light', '白纸'], ['auto', '自动']] as const).map(([key, label]) => <button key={key} data-t={key} type="button" title={key === "auto" ? "跟随系统的浅色/深色" : undefined} onClick={(e) => switchTheme(key, e)}>{label}</button>)}
  </div>;
}
