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
 * 吉他弦阅读进度: a string across the top of the page; the pick rides at the reading position and the string
 * shakes with scroll speed, then rings down.
 */
export function StringProgress() {
  const path = useRef<SVGPathElement>(null);
  const played = useRef<SVGPathElement>(null);
  const pick = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let amp = 0, phase = 0, frame = 0, lastY = window.scrollY;
    const draw = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      const y = 7 + amp * Math.sin(phase);
      const d = `M0 7 Q500 ${y.toFixed(2)} 1000 7`;
      path.current?.setAttribute("d", d);
      played.current?.setAttribute("d", d);
      played.current?.style.setProperty("stroke-dashoffset", String(1 - p));
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
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", draw);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", draw); };
  }, []);
  return <div className="string-progress" aria-hidden="true">
    <svg viewBox="0 0 1000 14" preserveAspectRatio="none"><path ref={path} className="s-rest" d="M0 7 Q500 7 1000 7" /><path ref={played} className="s-played" pathLength={1} d="M0 7 Q500 7 1000 7" /></svg>
    <span ref={pick} className="s-pick" />
  </div>;
}

/** 网点显影: the lead picture comes up as halftone dots that swell into the full image, then takes its colour. */
export function Develop({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`develop ${className}`}>{children}</div>;
}
