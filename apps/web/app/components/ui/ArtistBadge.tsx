import type { CSSProperties } from "react";
import type { Subject } from "../../features/feed/bands";

/**
 * A band or project name, set the way a live poster sets it: quiet, tracked out, with a short accent
 * rule so the eye can find it. It renders text rather than a link because a feed card's title already
 * owns the whole card as a click target; list rows that need navigation wrap it themselves.
 */
export function ArtistBadge({ subject, size = "sm", className = "" }: { subject: Subject; size?: "sm" | "lg"; className?: string }) {
  const lg = size === "lg";
  // The band's own colour, on the rule only: the site stays neutral and nothing is dyed wholesale.
  const style = subject.accent ? ({ "--band-accent": subject.accent } as CSSProperties) : undefined;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <span aria-hidden="true" style={style} className="h-[11px] w-[2px] flex-none rounded-full bg-band" />
      <span className={`truncate font-semibold text-ink-2 ${lg ? "text-[13.5px]" : "text-[12.5px]"}`}>{subject.label}</span>
    </span>
  );
}

/** Every band the item was filed under, most specific first. */
export function ArtistLine({ subjects, size = "sm", className = "" }: { subjects: readonly Subject[]; size?: "sm" | "lg"; className?: string }) {
  if (!subjects.length) return null;
  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {subjects.map((s) => (
        <ArtistBadge key={s.id} subject={s} size={size} />
      ))}
    </span>
  );
}
