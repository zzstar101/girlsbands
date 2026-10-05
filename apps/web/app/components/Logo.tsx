import { useEffect, useState } from "react";
import { SITE } from "@girlsbands/industry/site";
import lockupSource from "@girlsbands/industry/brand/a1-lockup-dark.svg?raw";
import sealSource from "@girlsbands/industry/brand/a1-string-anim.svg?raw";

// Approved A1 path artwork; semantic fills follow the reader's printing surface.
function artwork(source: string) {
  return source.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    .replaceAll('#f3efe6', 'var(--ink)').replaceAll('#141216', 'var(--bg)').replaceAll('#ff2d78', 'var(--pink)');
}
const lockup = artwork(lockupSource).replaceAll('stroke="var(--pink)"', 'class="logo-string" stroke="var(--pink)"');
const seal = artwork(sealSource);
const still = seal.replace(/<animate(?:Transform)?\b[^>]*(?:\/>|>[\s\S]*?<\/animate(?:Transform)?>)/g, '');
const viewBox = /viewBox="([^"]+)"/.exec(lockupSource)![1];

export function Wordmark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return <svg role="img" aria-label={SITE.name} viewBox={viewBox} className={`wordmark ${className}`} style={{ height: Math.max(32, size * 1.8), width: "auto", maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: lockup }} />;
}

export function RingMark({ className = "", spinning = false }: { className?: string; spinning?: boolean }) {
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotion(!query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return <svg viewBox="0 0 284 284" className={`${spinning ? "string-loading" : ""} ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: motion ? seal : still }} />;
}
