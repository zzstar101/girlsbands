import type { CSSProperties } from "react";
import { Link } from "react-router";
import { inkOn } from "@girlsbands/industry/colors";
import type { Subject } from "../../features/feed/bands";
import { BandTip } from "./BandTip";

export function ArtistBadge({ subject, size = "sm", className = "" }: { subject: Subject; size?: "sm" | "lg"; className?: string }) {
  const color = subject.accent ?? "#ff2d78";
  return <Link to={`/topics/${subject.id}`} className={`chip-band ${size === "lg" ? "large" : ""} ${className}`} style={{ "--c": color, "--on": inkOn(color, "#141216") } as CSSProperties}>
    {subject.label}<BandTip subject={subject} edge="l" />
  </Link>;
}

export function ArtistLine({ subjects, size = "sm", className = "" }: { subjects: readonly Subject[]; size?: "sm" | "lg"; className?: string }) {
  if (!subjects.length) return null;
  return <span className={`bands ${className}`}>{subjects.map((s) => <ArtistBadge key={s.id} subject={s} size={size} />)}</span>;
}
