import type { CSSProperties } from "react";
import manifest from "../../../../../assets/band-logos/manifest.json";
import type { Subject } from "../../features/feed/bands";

const logoFiles = import.meta.glob('../../../../../assets/band-logos/*.png', { eager: true, import: 'default', query: '?url' }) as Record<string, string>;

/** The logo file of a band or project, with whether it needs a dark backdrop; null when there is none. */
export function bandLogo(id: string): { src: string; width: number; height: number; onDark: boolean } | null {
  const logo = manifest.logos[id as keyof typeof manifest.logos];
  const src = logo && logoFiles[`../../../../../assets/band-logos/${logo.file}`];
  return logo && src ? { src, width: logo.width, height: logo.height, onDark: !!logo.onDark } : null;
}

export function BandLogo({ id, className = "" }: { id: string; className?: string }) {
  const logo = manifest.logos[id as keyof typeof manifest.logos];
  if (!logo) return null;
  return <span className={`band-logo ${logo.onDark ? "dark-logo" : ""} ${className}`}><img src={logoFiles[`../../../../../assets/band-logos/${logo.file}`]} width={logo.width} height={logo.height} alt="" loading="lazy" /></span>;
}

export function BandTip({ subject, edge = "" }: { subject: Subject; edge?: "l" | "r" | "" }) {
  return <span aria-hidden="true" className={`tip ${edge}`} style={{ "--c": subject.accent } as CSSProperties}>
    <BandLogo id={subject.id} /><span className="cap">{subject.label}<i>{subject.accent}</i></span>
  </span>;
}
