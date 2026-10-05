import { applyTheme, setThemePreference } from "../../lib/local-state";

/** Two printing surfaces; saved across visits and tabs. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  return <div role="group" aria-label="外观" className={`theme-seg ${className}`}>
    {([['dark', '黑场'], ['light', '白纸']] as const).map(([key, label]) => <button key={key} data-t={key} type="button" onClick={() => {
      setThemePreference(key); applyTheme(key, false);
    }}>{label}</button>)}
  </div>;
}
