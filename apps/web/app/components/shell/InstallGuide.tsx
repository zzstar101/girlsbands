// 添加到主屏幕: the site opened from the phone's home screen has no browser bars and opens like an app.
// A small card above the tab bar suggests it on a phone's second visit (dismissed: quiet for 30 days), and
// 「我的」 keeps a row for it. Both open the same sheet: Android with an install prompt gets one button,
// everyone else gets the steps for their browser. Nothing shows once the site already runs from the home screen.
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { KEYS, readJson, writeRaw } from "../../lib/local-state";
import { Sheet } from "../ui/Sheet";
import { isPhone } from "./screens";

const QUIET_MS = 30 * 24 * 3600_000;

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type Hint = { visits?: number; lastVisit?: string; dismissedAt?: number; installed?: boolean };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallPrompt; listeners.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { deferred = null; saveHint({ ...hint(), installed: true }); listeners.forEach((f) => f()); });
}

export function standalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function hint(): Hint {
  const v = readJson(KEYS.installHint);
  return v && typeof v === "object" ? (v as Hint) : {};
}
function saveHint(h: Hint) {
  writeRaw(KEYS.installHint, JSON.stringify(h));
}

type Platform = "ios" | "ios-other" | "android" | "other";
function platform(): Platform {
  const ua = navigator.userAgent;
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|MicroMessenger|QQ\//.test(ua) ? "ios-other" : "ios";
  return /Android/.test(ua) ? "android" : "other";
}

/** Whether this phone browser can still be offered the home-screen app. */
export function useInstallable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const check = () => setOk(isPhone() && !standalone() && !hint().installed);
    check();
    listeners.add(check);
    return () => { listeners.delete(check); };
  }, []);
  return ok;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return <li className="flex gap-3"><span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-white">{n}</span><div className="pt-0.5 text-[15px] leading-relaxed text-ink">{children}</div></li>;
}

const ShareIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" className="mx-0.5 inline size-[18px] -translate-y-px align-middle text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" /><path d="M7 11H5.5A1.5 1.5 0 0 0 4 12.5v7A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H17" /></svg>;
const PlusIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" className="mx-0.5 inline size-[18px] -translate-y-px align-middle text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8.5v7M8.5 12h7" /></svg>;
const DotsIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" className="mx-0.5 inline size-[18px] -translate-y-px align-middle text-accent" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>;

/** The steps sheet; open it from anywhere. */
export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [p, setP] = useState<Platform>("other");
  const [canPrompt, setCanPrompt] = useState(false);
  useEffect(() => {
    if (!open) return;
    setP(platform());
    const sync = () => setCanPrompt(deferred !== null);
    sync();
    listeners.add(sync);
    return () => { listeners.delete(sync); };
  }, [open]);

  const install = async () => {
    if (!deferred) return;
    const e = deferred;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred = null;
    if (outcome === "accepted") { saveHint({ ...hint(), installed: true }); onClose(); }
    listeners.forEach((f) => f());
  };

  return (
    <Sheet open={open} onClose={onClose} title="添加到主屏幕">
      <div className="px-5 pb-2 pt-1">
        <p className="text-[14px] leading-relaxed text-ink-2">放到桌面后点图标直接打开，没有浏览器地址栏，全屏显示，下拉就能刷新。</p>
        {canPrompt ? (
          <button type="button" onClick={install} className="mt-5 flex h-12 w-full items-center justify-center rounded-control bg-accent text-[16px] font-bold text-white active:opacity-80">添加到主屏幕</button>
        ) : (
          <ol className="mt-5 space-y-4">
            {p === "ios" && <>
              <Step n={1}>点 Safari 底部（或地址栏旁）的分享按钮<ShareIcon /></Step>
              <Step n={2}>往下滑，选「添加到主屏幕」<PlusIcon /></Step>
              <Step n={3}>点右上角「添加」，桌面上就有「少女乐队's」了</Step>
            </>}
            {p === "ios-other" && <>
              <Step n={1}>iPhone 上只有 Safari 能添加。先点右上角菜单，选「在 Safari 中打开」（或复制链接到 Safari）</Step>
              <Step n={2}>在 Safari 里点分享按钮<ShareIcon />，选「添加到主屏幕」<PlusIcon /></Step>
            </>}
            {p !== "ios" && p !== "ios-other" && <>
              <Step n={1}>点浏览器右上角（或底部）的菜单<DotsIcon /></Step>
              <Step n={2}>选「添加到主屏幕」或「安装应用」</Step>
              <Step n={3}>确认后桌面上就有「少女乐队's」了。微信、QQ 里打不开这个菜单，请先用浏览器打开</Step>
            </>}
          </ol>
        )}
      </div>
    </Sheet>
  );
}

/** The card above the tab bar, from the second visit on, on the home page only. */
export function InstallCard() {
  const installable = useInstallable();
  const { pathname } = useLocation();
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!installable) return;
    const h = hint();
    const today = new Date().toDateString();
    const visits = (h.visits ?? 0) + (h.lastVisit === today ? 0 : 1);
    if (h.lastVisit !== today) saveHint({ ...h, visits, lastVisit: today });
    const quiet = h.dismissedAt !== undefined && Date.now() - h.dismissedAt < QUIET_MS;
    setShow(visits >= 2 && !quiet);
  }, [installable]);

  const dismiss = () => { setShow(false); saveHint({ ...hint(), dismissedAt: Date.now() }); };
  if (!installable) return null;
  return (
    <>
      {show && pathname === "/" && (
        <div role="note" className="install-card fixed inset-x-3 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-[14px] bg-surface px-3.5 py-3 shadow-[var(--shadow-pop)] ring-1 ring-line lg:hidden">
          <img src="/icon-192.png" alt="" className="size-10 shrink-0 rounded-[10px]" />
          <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
            <div className="text-[15px] font-bold text-ink">添加到主屏幕</div>
            <div className="truncate text-[13px] text-ink-3">像 App 一样打开，全屏不带地址栏</div>
          </button>
          <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-[14px] font-bold text-white active:opacity-80">怎么加</button>
          <button type="button" aria-label="不再提示" onClick={dismiss} className="-mr-1 flex size-8 shrink-0 items-center justify-center text-ink-3">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      )}
      <InstallSheet open={open} onClose={() => { setOpen(false); if (show) dismiss(); }} />
    </>
  );
}
