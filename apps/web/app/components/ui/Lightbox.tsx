import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Presence } from "./Presence";
import { useModal } from "./modal";
import { IconArrowLeft, IconArrowRight, IconClose } from "../icons";

export interface LightboxImage {
  src: string;
  alt?: string | null;
}

type View = { s: number; x: number; y: number };
const FIT: View = { s: 1, x: 0, y: 0 };

/**
 * Pictures shown full size over the page, and zoomable: the wheel, a trackpad pinch or two fingers
 * zoom around the pointer, a drag moves a zoomed picture, a double click or tap toggles between the
 * whole picture and close-up (a tall picture opens to its full width at the top, to read down). While
 * open, keyboard focus stays in the viewer, the page behind does not scroll, Escape closes it, the arrow
 * keys move between pictures and + − 0 zoom. At normal size a finger swipes sideways to the next
 * picture or down to close; a click outside the picture closes.
 */
export function Lightbox({ images, index, onIndex, onClose }: { images: LightboxImage[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const open = index !== null && !!images[index];
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const view = useRef<View>(FIT);
  const [zoomedIn, setZoomedIn] = useState(false);
  const [percent, setPercent] = useState(100);
  const state = useRef({ index, count: images.length, onIndex, onClose });
  state.current = { index, count: images.length, onIndex, onClose };

  // The page may be zoomed on very wide screens (body zoom); pointer pixels are divided by it.
  const pageZoom = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--page-zoom")) || 1;
  const screen = () => { const z = pageZoom(); return { w: window.innerWidth / z, h: window.innerHeight / z, z }; };
  const base = () => ({ w: img.current?.offsetWidth ?? 1, h: img.current?.offsetHeight ?? 1 });
  const maxScale = () => {
    const el = img.current;
    const natural = el && el.naturalWidth ? el.naturalWidth / el.offsetWidth : 1;
    return Math.max(4, natural * 2);
  };

  /** Keeps a zoomed picture covering the screen where it can; a smaller side stays centred. */
  const clamp = (v: View): View => {
    const { w, h } = base();
    const sc = screen();
    const s = Math.min(Math.max(v.s, 1), maxScale());
    const limX = Math.max(0, (w * s - sc.w) / 2);
    const limY = Math.max(0, (h * s - sc.h) / 2);
    return { s, x: Math.min(limX, Math.max(-limX, v.x)), y: Math.min(limY, Math.max(-limY, v.y)) };
  };
  const paint = (v: View, animate = false) => {
    view.current = v;
    const el = img.current;
    if (!el) return;
    el.style.transition = animate ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    el.style.transform = v.s === 1 && !v.x && !v.y ? "" : `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
    setZoomedIn(v.s > 1.01);
    setPercent(Math.round(v.s * 100));
  };
  /** Zoom to scale `to` keeping the screen point (clientX, clientY) over the same spot of the picture. */
  const zoomAt = (to: number, clientX?: number, clientY?: number, animate = false) => {
    const v = view.current;
    const sc = screen();
    const px = clientX === undefined ? 0 : clientX / sc.z - sc.w / 2;
    const py = clientY === undefined ? 0 : clientY / sc.z - sc.h / 2;
    const s = Math.min(Math.max(to, 1), maxScale());
    const k = s / v.s;
    paint(clamp({ s, x: px - (px - v.x) * k, y: py - (py - v.y) * k }), animate);
  };
  /** Close-up: a tall picture fills the width from its top; others double around the point. */
  const closeUp = (clientX?: number, clientY?: number) => {
    const { w, h } = base();
    const sc = screen();
    const fillWidth = (sc.w * 0.96) / w;
    if (h > sc.h * 0.9 && fillWidth > 1.3) {
      const s = Math.min(fillWidth, maxScale());
      paint(clamp({ s, x: 0, y: (h * s - sc.h) / 2 }), true);
    } else zoomAt(2.5, clientX, clientY, true);
  };
  const toggle = (clientX?: number, clientY?: number) => (view.current.s > 1.01 ? paint(FIT, true) : closeUp(clientX, clientY));

  // A new picture starts whole.
  useEffect(() => { view.current = FIT; setZoomedIn(false); setPercent(100); }, [index, open]);

  useModal({
    open,
    panel: dialog,
    initialFocus: closeButton,
    onClose,
    onKeyDown: (e) => {
      if (e.key === "+" || e.key === "=") { zoomAt(view.current.s * 1.5, undefined, undefined, true); e.preventDefault(); return; }
      if (e.key === "-") { zoomAt(view.current.s / 1.5, undefined, undefined, true); e.preventDefault(); return; }
      if (e.key === "0") { paint(FIT, true); e.preventDefault(); return; }
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const { index: at, count, onIndex: go } = state.current;
      if (at !== null && count > 1) go((at + (e.key === "ArrowRight" ? 1 : -1) + count) % count);
      e.preventDefault();
    },
  });

  // Wheel: zoom at the pointer; once zoomed, a plain wheel scrolls the picture and ctrl/⌘ (or a trackpad pinch) zooms.
  useEffect(() => {
    const el = dialog.current;
    if (!open || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      const z = pageZoom();
      if (v.s > 1.01 && !e.ctrlKey && !e.metaKey) {
        paint(clamp({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX) / z, y: v.y - (e.shiftKey ? 0 : e.deltaY) / z }));
        return;
      }
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      zoomAt(v.s * factor, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // Pointers: one moves (a zoomed picture pans; at normal size a touch swipes), two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan" | "swipe" | "pinch"; x: number; y: number; view: View; dist?: number; dx: number; dy: number; axis: "x" | "y" | null; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  const lastPointer = useRef<string>("mouse");
  const suppressClick = useRef(false);
  const swipePlace = (dx: number, dy: number, animate: boolean) => {
    const el = img.current;
    const backdrop = dialog.current;
    if (!el || !backdrop) return;
    el.style.transition = animate ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : "";
    backdrop.style.backgroundColor = dy > 0 ? `rgba(0, 0, 0, ${Math.max(0.3, 0.85 - dy / 600)})` : "";
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.target instanceof Element && e.target.closest("button")) return;
    lastPointer.current = e.pointerType;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    suppressClick.current = false;
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { kind: "pinch", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, view: view.current, dist: Math.hypot(a.x - b.x, a.y - b.y), dx: 0, dy: 0, axis: null, moved: true };
      swipePlace(0, 0, false);
      paint(view.current);
    } else if (pts.length === 1) {
      const zoomed = view.current.s > 1.01;
      if (!zoomed && e.pointerType === "mouse") { gesture.current = null; return; }
      gesture.current = { kind: zoomed ? "pan" : "swipe", x: e.clientX, y: e.clientY, view: view.current, dx: 0, dy: 0, axis: null, moved: false };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const z = pageZoom();
    if (g.kind === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // Scale around the starting midpoint, then follow the midpoint as it moves.
      view.current = g.view;
      zoomAt(g.view.s * (dist / (g.dist || dist)), g.x, g.y);
      const v = view.current;
      paint(clamp({ ...v, x: v.x + (mx - g.x) / z, y: v.y + (my - g.y) / z }));
      return;
    }
    g.dx = e.clientX - g.x;
    g.dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(g.dx, g.dy) > 6) g.moved = true;
    if (!g.moved) return;
    if (g.kind === "pan") { paint(clamp({ ...g.view, x: g.view.x + g.dx / z, y: g.view.y + g.dy / z })); return; }
    if (!g.axis) g.axis = Math.abs(g.dx) > Math.abs(g.dy) ? "x" : "y";
    if (g.axis === "x" && images.length > 1) swipePlace(g.dx / z, 0, false);
    else if (g.axis === "y") swipePlace(0, Math.max(0, g.dy) / z, false);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "pinch") {
      suppressClick.current = true;
      if (pointers.current.size === 0) { gesture.current = null; if (view.current.s < 1.05) paint(FIT, true); }
      else {
        // One finger stays down: continue as a pan from here.
        const [p] = [...pointers.current.values()] as [{ x: number; y: number }];
        gesture.current = { kind: "pan", x: p.x, y: p.y, view: view.current, dx: 0, dy: 0, axis: null, moved: true };
      }
      return;
    }
    gesture.current = null;
    if (!g) return;
    if (g.moved) {
      suppressClick.current = true;
      if (g.kind === "swipe") {
        const { index: at, count, onIndex: go, onClose: close } = state.current;
        if (g.axis === "x" && count > 1 && at !== null && Math.abs(g.dx) > 60) { swipePlace(0, 0, false); go((at + (g.dx < 0 ? 1 : -1) + count) % count); }
        else if (g.axis === "y" && g.dy > 110) close();
        else swipePlace(0, 0, true);
      }
      return;
    }
    // A double tap toggles the close-up.
    if (e.pointerType !== "mouse") {
      const now = Date.now();
      if (now - lastTap.current < 300) { lastTap.current = 0; suppressClick.current = true; toggle(e.clientX, e.clientY); }
      else lastTap.current = now;
    }
  };
  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    swipePlace(0, 0, true);
  };

  const current = open ? images[index!]! : null;
  const many = images.length > 1;
  const round = "grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20";
  const nav = `absolute top-1/2 -translate-y-1/2 ${round}`;
  const tool = "grid h-9 min-w-9 place-items-center rounded-full px-2 text-[13px] text-white/90 transition-colors hover:bg-white/15";
  if (typeof document === "undefined") return null;
  return createPortal(
    <Presence show={open} enter="anim-fade-in" exit="anim-fade-out" duration={160}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={many && index !== null ? `图片 ${index + 1} / ${images.length}` : "图片"}
        onClick={(e) => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          // On the picture a click zooms (mouse); outside it, or on a touch tap, it closes.
          const onPicture = e.target === img.current;
          if (onPicture && lastPointer.current !== "mouse") return;
          if (onPicture) { if (view.current.s <= 1.01) closeUp(e.clientX, e.clientY); return; }
          if (view.current.s > 1.01) { paint(FIT, true); return; }
          onClose();
        }}
        onDoubleClick={(e) => { if (e.target === img.current && view.current.s > 1.01) paint(FIT, true); }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className="fixed inset-0 z-[80] grid touch-none select-none place-items-center overflow-hidden bg-black/85 p-4 sm:p-10"
      >
        {current && (
          <img
            ref={img}
            key={current.src}
            src={current.src}
            decoding="async"
            draggable={false}
            onAnimationEnd={(e) => e.currentTarget.classList.remove("anim-zoom-in")}
            alt={current.alt ?? ""}
            className={`lightbox-img anim-zoom-in min-h-0 min-w-0 max-h-[calc(100dvh/var(--page-zoom,1)-5rem)] max-w-full rounded-control object-contain shadow-2xl will-change-transform ${zoomedIn ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
          />
        )}
        <button ref={closeButton} type="button" aria-label="关闭" onClick={(e) => { e.stopPropagation(); onClose(); }} className={`absolute right-[max(16px,env(safe-area-inset-right))] top-[max(16px,env(safe-area-inset-top))] ${round}`}>
          <IconClose size={18} />
        </button>
        {current && (
          <div className="absolute left-1/2 top-[max(16px,env(safe-area-inset-top))] flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-black/55 px-1 py-1 backdrop-blur" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="缩小" className={tool} onClick={() => zoomAt(view.current.s / 1.5, undefined, undefined, true)}>−</button>
            <button type="button" aria-label="恢复原大小" className={`${tool} num w-14`} onClick={() => paint(FIT, true)}>{percent}%</button>
            <button type="button" aria-label="放大" className={tool} onClick={() => zoomAt(view.current.s * 1.5, undefined, undefined, true)}>+</button>
            <button type="button" className={tool} onClick={() => (zoomedIn ? paint(FIT, true) : closeUp())}>{zoomedIn ? "看全图" : "放大看"}</button>
          </div>
        )}
        {many && index !== null && !zoomedIn && (
          <>
            <button type="button" aria-label="上一张" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + images.length) % images.length); }} className={`${nav} left-[max(12px,env(safe-area-inset-left))] sm:left-5`}>
              <IconArrowLeft size={18} />
            </button>
            <button type="button" aria-label="下一张" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % images.length); }} className={`${nav} right-[max(12px,env(safe-area-inset-right))] sm:right-5`}>
              <IconArrowRight size={18} />
            </button>
          </>
        )}
        {many && index !== null && (
          <span className="num pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-2.5 py-0.5 text-[12px] text-white/85">
            {index + 1} / {images.length}
          </span>
        )}
      </div>
    </Presence>, document.body
  );
}
