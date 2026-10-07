import type { MouseEvent } from "react";
import { applyTheme, resolvedTheme, setThemePreference } from "../../lib/local-state";

/**
 * 拉闸换场: the new surface opens as a circle from the pressed button, like a stage light iris; switching to
 * 黑场 also flickers once as the lights come up. Without View Transitions or with reduced motion it just swaps.
 */
function switchTheme(choice: "dark" | "light" | "auto", event: MouseEvent<HTMLButtonElement>) {
  const root = document.documentElement;
  const key = choice === "auto" ? resolvedTheme(null) : choice;
  const apply = () => { setThemePreference(choice === "auto" ? null : choice); applyTheme(key, choice === "auto"); };
  if (root.getAttribute("data-theme") === key || !document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
  const box = event.currentTarget.getBoundingClientRect();
  root.style.setProperty("--iris-x", `${box.left + box.width / 2}px`);
  root.style.setProperty("--iris-y", `${box.top + box.height / 2}px`);
  root.setAttribute("data-theme-vt", key);
  document.startViewTransition(apply).finished.finally(() => root.removeAttribute("data-theme-vt"));
}

/** Two printing surfaces, or 自动 to follow the system (the default); saved across visits and tabs. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  return <div role="group" aria-label="外观" className={`theme-seg ${className}`}>
    {([['dark', '黑场'], ['light', '白纸'], ['auto', '自动']] as const).map(([key, label]) => <button key={key} data-t={key} type="button" title={key === "auto" ? "跟随系统的浅色/深色" : undefined} onClick={(e) => switchTheme(key, e)}>{label}</button>)}
  </div>;
}
