import { useEffect, useState } from "react";

/** SSR prints the real count; the entrance animation starts only after hydration. */
export function Count({ value, delay = 0 }: { value: number; delay?: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return; }
    let frame = 0;
    const start = performance.now() + delay;
    const update = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / 900));
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [value, delay]);
  return <span aria-label={String(value)}>{shown}</span>;
}
