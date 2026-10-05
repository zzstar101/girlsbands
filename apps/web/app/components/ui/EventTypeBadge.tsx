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

export function EventTypeBadge({ category, className = "" }: { category: CategoryKey | null | undefined; className?: string }) {
  if (!category) return null;
  return (
    <span
      className={`stamp ${category} ${className}`}
      title={CATEGORY_LABELS[category]}
    >
      {CODES[category]}
    </span>
  );
}
