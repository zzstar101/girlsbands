/**
 * A source, as evidence rather than decoration: readers should be able to see why the site believes
 * something. One badge per source, so a list of them reads like the evidence line under a fact.
 */
export function SourceBadge({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`inline-flex max-w-full items-center rounded-[3px] border border-line-soft bg-surface-2 px-1.5 py-[1px] text-[11px] font-medium text-ink-3 ${className}`}>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** The evidence line: every source that carried this item, newest first. */
export function SourceBadges({ names, className = "" }: { names: readonly string[]; className?: string }) {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return null;
  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      {unique.map((name) => (
        <SourceBadge key={name} name={name} />
      ))}
    </span>
  );
}
