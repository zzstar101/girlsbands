// 通栏头图（每封邮件顶上那张图）的**规格**，不是它的画法。
//
// 为什么要单独一层：头图由 API 现画（apps/api/src/og/hero.ts，satori → PNG），而信由 worker 拼
// （packages/backend/src/subscriptions/content.ts）。两边都不许自己编字段，只能通过这里交换。
// 头图地址 = <站点>/og/email/<token>.png，token 就是这份 spec 的 base64url——无状态、可缓存、
// 邮件发出之后改不了（改内容会换 token，也就换了图，这正是我们要的：一封旧信永远指向它自己那张图）。
//
// 硬约束（另一端渲染时也照这份来）：
//   · 画布 1200×450（邮件里按 600×225 显示，2 倍图在高分屏上是清的）
//   · 主角是**这支乐队的官方 logo**，存在仓库里（assets/band-logos/<id>.png，scripts/fetch-band-logos.ts
//     抓一次入库），渲染时从磁盘读，**不出网**；没有对应 logo 就没有主视觉，只剩文字
//   · 底色要保证 logo 读得清：**应援色不能直接用**——逐像素量过 22 个官方 logo，只有 4 个的墨迹
//     能压在应援色上，其余各支的应援色都是中间调，墨迹对比度掉到 1.5:1 上下。所以渲染那端按
//     「丢掉多少墨迹」挑一块（判据见 apps/api/src/og/hero.ts 的 plateFor）：应援色推明度得到的
//     浅板、深板、白板、近黑板里挑墨迹最全的那块，另有 4 支按官方页面上的实际底板手工覆盖
//   · `star` 是乐队显示名（画在左下），`date` 是那封信的日期（画成右上角的巨号鬼影日号 + `10 / 04 · JST`）
//   · 客户端默认屏蔽图片：所以 bg 必须等于 accent 的实色（那一格不能闪白），alt 必须把这张图
//     说的话写全，模板还要把 caption 画在图上那格
export const HERO_W = 1200;
export const HERO_H = 450;
/** 邮件里的显示尺寸（HTML 的 width/height 属性用这两个）。 */
export const HERO_CSS_W = 600;
export const HERO_CSS_H = 225;
/** 四周留白，渲染那端所有的对齐都从它出发。 */
export const HERO_PAD = 64;

export interface HeroSpec {
  /** 浓色应援色（乐队色）；没有乐队时用站点品牌金。头图的兜底底色就是它。 */
  accent: string;
  /** 深色（站点 ink）。 */
  ink: string;
  /** 浅色（站点 surface）。 */
  surface: string;
  /** 主角：乐队显示名；没有乐队时是站名。 */
  star: string;
  /** 这封信的日期 `YYYY-MM-DD`（日本时间）；拿不到就是空串，渲染那端不画任何日期。 */
  date: string;
  /**
   * 主角乐队的 id（`industry/taxonomy.ts` 的 `ENTITIES` 键）。头图用它去 `assets/band-logos/`
   * 找这支乐队的官方 logo 当主视觉；找不到就没有主视觉。
   * **它必须是 id 而不是 URL**：logo 是我们自己存下来的文件，渲染时不出网，所以这里只放行
   * 形状合法的 id（`[a-z0-9-]`），由渲染那端查表，查不到就是 null——绝不许拼路径。
   */
  logo: string | null;
}

/** 邮件模板拿到的头图句柄。 */
export interface HeroHandle {
  /** 绝对地址。 */
  src: string;
  /** 图片被屏蔽时唯一还能读到的文字。 */
  alt: string;
  width: number;
  height: number;
  /** 与图片主色一致的实色，图片没加载时那一格不能闪白。 */
  bg: string;
  /** 图片上那句话的主角（模板可以在图下再写一遍）。 */
  caption: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FALLBACK_ACCENT = "#e8b53c";
const FALLBACK_INK = "#202126";
const FALLBACK_SURFACE = "#ffffff";
const MAX_FIELD = 60;
export const MAX_HERO_TOKEN = 1200;
/** 乐队 id 的形状上限（`ENTITIES` 的键：小写字母、数字、连字符）。 */
export const MAX_LOGO_ID = 40;

function clean(value: unknown, fallback = ""): string {
  const s = typeof value === "string" ? value : fallback;
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD);
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback;
}

/**
 * 只放行形状合法的乐队 id。其余（大写、下划线、点、斜杠、空格、超长、非字符串）一律丢掉，
 * 退回没有主视觉的版本——头图绝不允许因为一个脏 id 去拼文件路径。渲染那端还有一层查表兜底。
 */
function logoId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s || s.length > MAX_LOGO_ID) return null;
  return /^[a-z0-9][a-z0-9-]*$/.test(s) ? s : null;
}

/** 只放行 `YYYY-MM-DD`；其余（含 `2026/10/04`、带时刻、超长）都当没有日期。 */
function dateOnly(value: unknown): string {
  if (typeof value !== "string") return "";
  const s = value.trim().slice(0, 10);
  return DATE.test(s) ? s : "";
}

/** 把一份 spec 收拾成一定是安全的、可以直接画的形状。 */
export function normalizeHero(input: Partial<HeroSpec>): HeroSpec {
  return {
    accent: color(input.accent, FALLBACK_ACCENT),
    ink: color(input.ink, FALLBACK_INK),
    surface: color(input.surface, FALLBACK_SURFACE),
    star: clean(input.star) || "少女乐队's",
    date: dateOnly(input.date),
    logo: logoId(input.logo),
  };
}

function b64url(bytes: Uint8Array): string {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += table[a >> 2]!;
    out += table[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b === undefined) break;
    out += table[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c === undefined) break;
    out += table[c & 63]!;
  }
  return out;
}

function unb64url(text: string): Uint8Array | null {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const values: number[] = [];
  for (const ch of text) {
    const v = table.indexOf(ch);
    if (v < 0) return null;
    values.push(v);
  }
  const bytes: number[] = [];
  for (let i = 0; i + 1 < values.length; i += 4) {
    const [a, b, c, d] = [values[i]!, values[i + 1]!, values[i + 2], values[i + 3]];
    bytes.push(((a << 2) | (b >> 4)) & 0xff);
    if (c !== undefined) bytes.push(((b << 4) | (c >> 2)) & 0xff);
    if (d !== undefined) bytes.push(((c << 6) | d) & 0xff);
  }
  return new Uint8Array(bytes);
}

/** spec → token（无填充 base64url）。字段顺序固定，所以同一份 spec 永远同一个 token。 */
export function encodeHero(input: Partial<HeroSpec>): string {
  const s = normalizeHero(input);
  const shape: [string, unknown][] = [
    ["a", s.accent],
    ["i", s.ink],
    ["s", s.surface],
    ["t", s.star],
    ["d", s.date],
    ["g", s.logo ?? ""],
  ];
  const record: Record<string, unknown> = {};
  for (const [key, value] of shape) if (value !== "") record[key] = value;
  return b64url(new TextEncoder().encode(JSON.stringify(record)));
}

/** token → spec。坏 token 一律返回 null（路由就回 404，绝不画一张半成品）。 */
export function decodeHero(token: string): HeroSpec | null {
  if (!token || token.length > MAX_HERO_TOKEN) return null;
  const bytes = unb64url(token);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  return normalizeHero({
    accent: r.a as string,
    ink: r.i as string,
    surface: r.s as string,
    star: r.t as string,
    date: r.d as string,
    logo: r.g as string,
  });
}

/** `2026-10-04` → 图上写的那两处：`04` 和 `10 / 04 · JST`。没有日期就两个都空。 */
export function dateParts(date: string): { day: string; line: string } {
  if (!DATE.test(date)) return { day: "", line: "" };
  const [, month, day] = date.split("-") as [string, string, string];
  return { day, line: `${month} / ${day} · JST` };
}

/** 模板用的句柄：地址、替代文字、显示尺寸、兜底色。 */
export function heroHandle(spec: HeroSpec, siteUrl: string): HeroHandle {
  const s = normalizeHero(spec);
  const { line } = dateParts(s.date);
  return {
    src: `${siteUrl.replace(/\/+$/, "")}/og/email/${encodeHero(s)}.png`,
    // 图片屏蔽时读者只看到这行字，所以它必须自己说完整：哪支乐队、哪一天。
    alt: [s.star, line].filter(Boolean).join("｜"),
    width: HERO_CSS_W,
    height: HERO_CSS_H,
    bg: s.accent,
    caption: s.star,
  };
}
