import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { HomeResponse } from "@girlsbands/contracts/site";
import { allBands, type Subject } from "./bands";

// 首页大标题：一句口号，三组（别错过 / 舞台 MC / 粉丝日常）混在一起，每次打开换一句（不和上次重复），点一下换下一句。
// 展示是逐字的：上行像字幕一样打出来，下行一个字一个字砸下来，落定后按这句话的「情绪」一直有点小动作。
// 每句有自己的字体和配色（look），不是一律粉色；大字按栏宽自动缩放，长乐队名也放得下。
// 服务端先渲染按日期挑的一句（藏着），浏览器接管后再抽一句播入场——两边不一致也不会闪。

type Mood = "stamp" | "mark" | "shake" | "wave" | "chant" | "lights" | "echo" | "float" | "wobble";
type Look = "pink" | "ink" | "tape" | "outline" | "inverse" | "serif" | "duo" | "band";
type Line = { top: string; big: string; mood: Mood; look: Look; en?: boolean };

export const SLOGANS: Line[] = [
  // 别错过：从站点 tagline「别错过下一场 Live」展开
  { top: "别错过下一场", big: "LIVE!", mood: "stamp", look: "pink", en: true },
  { top: "抽选截止前", big: "记得报名", mood: "mark", look: "ink" },
  { top: "开票那天", big: "别睡过头", mood: "shake", look: "tape" },
  { top: "别错过", big: "每次开票", mood: "stamp", look: "ink" },
  { top: "下一场", big: "一起去吧", mood: "wave", look: "duo" },
  // 舞台 MC：像乐队在台上喊的话；「大家好，我们是」后面每次换一支乐队
  { top: "还没结束呢", big: "ENCORE!", mood: "chant", look: "outline", en: true },
  { top: "大家好，我们是", big: "", mood: "wave", look: "band" },
  { top: "灯光暗下来", big: "下一首", mood: "lights", look: "serif" },
  { top: "最后一首之前", big: "ONE MORE", mood: "chant", look: "inverse", en: true },
  { top: "台下的你", big: "听得见吗", mood: "echo", look: "outline" },
  // 粉丝日常：抽选、钱包、落选的自嘲
  { top: "抽选结果", big: "祈祷中…", mood: "float", look: "serif" },
  { top: "这周的票", big: "抢到了吗", mood: "shake", look: "duo" },
  { top: "钱包", big: "撑得住吗", mood: "wobble", look: "tape" },
  { top: "落选也没事", big: "还有一般发售", mood: "wave", look: "pink" },
  { top: "官推刷不完", big: "交给我们", mood: "stamp", look: "inverse" },
];

const LAST_KEY = "gb:slogan";
const TOP_STEP = 45, BIG_STEP = 75, GAP = 140;
const seed = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
// 每个字一个固定的小角度，看起来像手贴上去的
const tilt = (s: string, i: number) => ((seed(s + i) % 9) - 4) * 1.6;
const BANDS = allBands();

function pickNext(prev: number | null) {
  let last = prev;
  if (last === null) { try { last = Number(localStorage.getItem(LAST_KEY) ?? NaN); } catch { last = NaN; } }
  let n = Math.floor(Math.random() * SLOGANS.length);
  if (n === last) n = (n + 1 + Math.floor(Math.random() * (SLOGANS.length - 1))) % SLOGANS.length;
  try { localStorage.setItem(LAST_KEY, String(n)); } catch { /* 隐私模式 */ }
  return n;
}

type Pick = { idx: number; band: Subject };
const randomBand = () => BANDS[Math.floor(Math.random() * BANDS.length)]!;

export function HeroCopy({ home }: { home: HomeResponse }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const picked = useRef(false); // 开发模式下 effect 会跑两次，只抽一次
  useEffect(() => {
    if (picked.current) return;
    picked.current = true;
    const q = new URLSearchParams(location.search);
    const f = Number(q.get("slogan"));
    const idx = q.has("slogan") && Number.isInteger(f) && f >= 0 && f < SLOGANS.length ? f : pickNext(null);
    setPick({ idx, band: BANDS.find((b) => b.id === q.get("band")) ?? randomBand() });
  }, []);
  const next = () => {
    if (leaving) return;
    const go = () => setPick((p) => ({ idx: pickNext(p?.idx ?? null), band: randomBand() }));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { go(); return; }
    setLeaving(true);
    setTimeout(() => { go(); setLeaving(false); }, 420);
  };

  const idx = pick?.idx ?? seed(home.today) % SLOGANS.length;
  const band = pick?.band ?? BANDS[seed(home.today) % BANDS.length]!;
  const line = SLOGANS[idx]!;
  const bigText = line.look === "band" ? band.label : line.big;
  const top = [...line.top], big = [...bigText];
  const bigAt = top.length * TOP_STEP + GAP;
  const settle = bigAt + big.length * BIG_STEP + 520;

  // 大字按栏宽缩放：先按原字号量，放不下就按比例缩小（旋转不影响排版宽度，所以量得准）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const room = (el.parentElement?.clientWidth ?? el.clientWidth) - 10;
      const width = (part: HTMLElement) => part.getBoundingClientRect().width / (Number(getComputedStyle(part).scale) || 1);
      // 手机：大字放到占满屏宽（≤6 字一行，再长折成两行），高度不超过屏高约三分之一，下面的近期日程要能露出来
      const phone = matchMedia("(max-width: 720px)").matches;
      for (const part of el.querySelectorAll<HTMLElement>(".sl-top, .sl-big")) {
        part.style.setProperty("--fit", "1");
        part.style.removeProperty("--cols");
        if (phone && part.classList.contains("sl-big")) {
          const em = parseFloat(getComputedStyle(el).fontSize);
          const boxed = /look-(tape|inverse)/.test(part.className) ? 0.4 : 0.08;
          let fit: number, lines = 1;
          if (part.classList.contains("en")) {
            fit = Math.min(1.8, room / width(part));
          } else {
            const n = big.length;
            const cols = n <= 6 ? n : Math.ceil(n / 2);
            lines = Math.ceil(n / cols);
            part.style.setProperty("--cols", String(cols));
            fit = room / ((cols * 0.97 + boxed) * em);
          }
          fit = Math.min(fit, (innerHeight * 0.3) / (lines * em));
          part.style.setProperty("--fit", String(fit));
          const w = width(part);
          if (w > room) part.style.setProperty("--fit", String(fit * room / w));
          continue;
        }
        const need = width(part);
        if (need > room) part.style.setProperty("--fit", String(Math.max(0.12, room / need)));
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement ?? el);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [idx, bigText]);

  return <h1 className="hero-slogan">
    <button ref={ref} type="button" key={`${idx}-${bigText}`} onClick={next} title="换一句" aria-label={`${line.top}${bigText}（点击换一句）`}
      className={`slogan mood-${line.mood}${pick === null ? " is-pending" : ""}${leaving ? " is-leaving" : ""}`}
      style={{ "--settle": `${settle}ms`, "--b": `${bigAt}ms`, "--bc": band.accent ?? "var(--pink)" } as CSSProperties}>
      <span className="sl-top" aria-hidden="true">{top.map((c, i) => <span className={i === top.length - 1 ? "tc last" : "tc"} key={i} style={{ "--d": `${i * TOP_STEP}ms` } as CSSProperties}>{c}</span>)}</span>
      <span className={`sl-big look-${line.look}${line.en || /^[\x20-\x7e]+$/.test(bigText) ? " en" : ""}`} aria-hidden="true">
        {big.map((c, i) => <span className={`ch${c === "…" ? " dots" : ""}`} key={i} data-c={c}
          style={{ "--i": i, "--d": `${bigAt + i * BIG_STEP}ms`, "--r": `${tilt(bigText, i)}deg` } as CSSProperties}>{c === " " ? "\u00a0" : c}</span>)}
      </span>
    </button>
  </h1>;
}

export function HeroLede() {
  return <p className="hero-lede">18 支少女乐队的官方消息、抽选截止和同人展，译成中文，按日期排好。时间都标当地时区。</p>;
}
