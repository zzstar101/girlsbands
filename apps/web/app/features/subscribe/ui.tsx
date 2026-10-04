import type { ReactNode } from "react";
import { BAND_IDS, PROJECT_IDS } from "@aihot/industry/taxonomy";
import { subjectOfId } from "../feed/bands";

export { BAND_IDS, PROJECT_IDS };

export const FIELD =
  "w-full rounded-card bg-bg-sunk text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent dark:bg-bg-muted/60 dark:focus:bg-surface";
export const LABEL = "mb-2 block text-[13px] font-semibold text-ink";

/**
 * 乐队／企划选择：不选任何一个就是全部。颜色只用来标出选中状态，含义始终由文字承担。
 * 「乐队」和「企划」分成两组：企划是整个系列、单部作品或游戏本身，乐队才是具体的团。
 * 两种都能订，但页面必须让人一眼分清自己订的是哪一种，邮件头图也按这个区分挂 logo。
 */
export function BandPicker({ value, onChange, disabled = false }: { value: readonly string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  const chip = (id: string) => {
    const subject = subjectOfId(id);
    if (!subject) return null;
    const on = value.includes(id);
    return (
      <button
        key={id}
        type="button"
        disabled={disabled}
        aria-pressed={on}
        onClick={() => toggle(id)}
        style={on && subject.accent ? { backgroundColor: subject.accent, borderColor: subject.accent } : undefined}
        className={`h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${
          on ? "border border-transparent text-white" : "bg-bg-sunk text-ink-3 ring-1 ring-inset ring-line-soft hover:text-ink"
        }`}
      >
        {subject.label}
      </button>
    );
  };
  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={value.length === 0}
          onClick={() => onChange([])}
          className={`h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${
            value.length === 0 ? "bg-ink text-bg" : "bg-bg-sunk text-ink-3 ring-1 ring-inset ring-line-soft hover:text-ink"
          }`}
        >
          全部
        </button>
      </div>
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-ink">
          乐队 <span className="font-normal text-ink-3">具体的团——Live、抽选、发售、成员动态按它们归档</span>
        </p>
        <div className="flex flex-wrap gap-1.5">{BAND_IDS.map(chip)}</div>
      </div>
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-ink">
          企划 <span className="font-normal text-ink-3">整个系列、单部作品或游戏本身，比如 BanG Dream! 与 GIRLS BAND CRY</span>
        </p>
        <div className="flex flex-wrap gap-1.5">{PROJECT_IDS.map(chip)}</div>
      </div>
    </div>
  );
}

/** 一个开关。文字说明永远在，不靠颜色单独表意。 */
export function Toggle({ checked, onChange, title, hint, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; title: string; hint: ReactNode; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3.5 py-3.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors disabled:opacity-50 ${checked ? "bg-accent" : "bg-line-strong"}`}
      >
        <span className={`block size-5 rounded-full bg-surface shadow-sm transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-ink">{title}</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-ink-4">{hint}</div>
      </div>
    </div>
  );
}

/** 署名用的浅色卡片，三个订阅页共用同一套外壳。 */
export function SubscribeShell({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <>
      <header>
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">
          {title}
        </h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-ink-3">{lead}</p>
      </header>
      {children}
    </>
  );
}
