import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/* Small stage effects for the item page (docs/design.md · 细节). All of them settle into plain, readable
   content without JavaScript or with reduced motion. */

const FACT = /(\d{4}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日(?:[（(][^）)]{1,8}[）)])?|\d{1,2}\s?月\s?\d{1,2}\s?日(?:[（(][^）)]{1,8}[）)])?|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}(?:\s?[~～-]\s?\d{1,2}:\d{2})?|[¥￥]\s?\d[\d,]*(?:\s?起)?)/u;

/**
 * 荧光笔划重点: dates, clock times and prices in the AI lede get a marker stroke in the band's colour, drawn one
 * after another the first time the lede scrolls into view.
 */
export function MarkedLede({ text, accent, className = "" }: { text: string; accent?: string | null; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setLit(true);
    const io = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setLit(true); io.disconnect(); } }, { rootMargin: "0px 0px -15% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  let n = 0;
  const parts: ReactNode[] = text.split(new RegExp(FACT.source, "gu")).map((part, i) => i % 2 ? <mark key={i} className="hl" style={{ "--i": n++ } as CSSProperties}>{part}</mark> : part);
  return <p ref={ref} className={`marked ${lit ? "lit" : ""} ${className}`} style={accent ? { "--hl": accent } as CSSProperties : undefined}>{parts}</p>;
}

/**
 * 吉他弦阅读进度: a string across the top of the page; the pick rides at the reading position of the article
 * that follows it and the string shakes with scroll speed, then rings down.
 *
 * The played part is the same string clipped in screen space: the svg is stretched (preserveAspectRatio none)
 * and its stroke is non-scaling, so a pathLength dash would be measured on the unstretched length and land
 * in the wrong place.
 */
export function StringProgress() {
  const root = useRef<HTMLDivElement>(null);
  const path = useRef<SVGPathElement>(null);
  const played = useRef<SVGPathElement>(null);
  const playedSvg = useRef<SVGSVGElement>(null);
  const pick = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let amp = 0, phase = 0, frame = 0, lastY = window.scrollY;
    const progress = () => {
      const article = root.current?.nextElementSibling;
      const doc = document.documentElement.scrollHeight - window.innerHeight;
      if (article) {
        const box = article.getBoundingClientRect();
        const start = box.top + window.scrollY;
        // Done when the article's end reaches the bottom of the screen, not when the page footer does.
        const span = Math.min(box.height - window.innerHeight, doc - start);
        // An article that fits on one screen has nothing to track; the page then measures the whole page.
        if (span > 0) return (window.scrollY - start) / span;
      }
      return doc > 0 ? window.scrollY / doc : 0;
    };
    const draw = () => {
      const p = Math.min(1, Math.max(0, progress()));
      const y = 7 + amp * Math.sin(phase);
      const d = `M0 7 Q500 ${y.toFixed(2)} 1000 7`;
      path.current?.setAttribute("d", d);
      played.current?.setAttribute("d", d);
      if (playedSvg.current) playedSvg.current.style.clipPath = `inset(-8px ${((1 - p) * 100).toFixed(3)}% -8px 0)`;
      if (pick.current) pick.current.style.left = `${p * 100}%`;
    };
    const ring = () => {
      amp *= 0.9; phase += 1.7;
      draw();
      frame = amp > 0.05 ? requestAnimationFrame(ring) : 0;
      if (!frame) { amp = 0; draw(); }
    };
    const onScroll = () => {
      const dy = Math.abs(window.scrollY - lastY); lastY = window.scrollY;
      if (still) return draw();
      amp = Math.min(5, amp + dy * 0.04);
      if (!frame) frame = requestAnimationFrame(ring);
    };
    draw();
    // Images and the translation toggle change the article's height after the first paint.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { if (!frame) draw(); });
    const article = root.current?.nextElementSibling;
    if (ro && article) ro.observe(article);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", draw);
    return () => { cancelAnimationFrame(frame); ro?.disconnect(); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", draw); };
  }, []);
  return <div ref={root} className="string-progress" aria-hidden="true">
    <svg viewBox="0 0 1000 14" preserveAspectRatio="none"><path ref={path} className="s-rest" d="M0 7 Q500 7 1000 7" /></svg>
    <svg ref={playedSvg} viewBox="0 0 1000 14" preserveAspectRatio="none" style={{ clipPath: "inset(-8px 100% -8px 0)" }}><path ref={played} className="s-played" d="M0 7 Q500 7 1000 7" /></svg>
    <span ref={pick} className="s-pick" />
  </div>;
}

/** 网点显影: the lead picture comes up as halftone dots that swell into the full image, then takes its colour. */
export function Develop({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`develop ${className}`}>{children}</div>;
}
