import type { CategoryKey } from "@girlsbands/contracts/taxonomy";
import { CATEGORY_LABELS } from "@girlsbands/contracts/taxonomy";

/**
 * The category, as a poster stamp: a Latin code so a card reads at a glance, with the Chinese label
 * kept for readers who do not read the code. Colour never carries the meaning alone — the text is
 * always there — and only the two categories that ask the reader to act (票务, 通知) are tinted.
 */
const CODES: Record<CategoryKey, string> = {
  notice: "NOTICE",
  ticket: "TICKET",
  live: "LIVE",
  release: "RELEASE",
  merch: "MERCH",
  stream: "STREAM",
  collab: "COLLAB",
  member: "MEMBER",
  media: "MEDIA",
  other: "OTHER",
};

const TONES: Partial<Record<CategoryKey, string>> = {
  ticket: "text-hot border-hot/35",
  notice: "text-hot border-hot/35",
  live: "text-accent border-accent/35",
  release: "text-accent border-accent/35",
  member: "text-amber-ink border-amber/35",
};

export function EventTypeBadge({ category, className = "" }: { category: CategoryKey | null | undefined; className?: string }) {
  if (!category) return null;
  return (
    <span
      className={`inline-flex items-center rounded-[3px] border px-1.5 py-[1px] font-mono text-[10.5px] font-semibold leading-[1.5] tracking-[0.1em] ${TONES[category] ?? "text-ink-3 border-line"} ${className}`}
      title={CATEGORY_LABELS[category]}
    >
      {CODES[category]}
    </span>
  );
}
