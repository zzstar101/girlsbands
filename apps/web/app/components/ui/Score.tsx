/**
 * How much attention this item deserves, as a quiet index rather than a badge: the numeral carries the
 * information, and the tier only decides its weight of colour. It is a 0–100 editorial index — not a
 * probability and not a confidence — so readers see a number they can compare, never a raw model output.
 */
const TIERS = [
  { min: 85, className: "text-hot" },
  { min: 70, className: "text-accent" },
  { min: 0, className: "text-ink-4" },
];

const HINT = "关注度：按粉丝影响范围、行动价值与时间敏感性综合的 0–100 指数";

/** "关注度 88" on desktop cards; `compact` keeps only the numeral (phones). */
export function ScoreLabel({ score, compact = false }: { score: number | null; compact?: boolean }) {
  if (score === null) return null;
  const value = Math.round(score);
  const tier = TIERS.find((t) => value >= t.min)!;
  return (
    <span title={`${HINT}（${value}/100）`} aria-label={`关注度 ${value} 分`} className={`inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap ${tier.className}`}>
      {!compact && <span className="meta">关注度</span>}
      <span className="numeral text-[13.5px] leading-none">{value}</span>
    </span>
  );
}
