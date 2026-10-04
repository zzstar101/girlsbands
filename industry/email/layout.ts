// 邮件排版的共用标尺。
//
// 邮件客户端没有 CSS 变量、没有调试器，盒模型还各不一样；同一个东西左右差 2px，
// 读者一眼就看出「歪了」。所以这里把能用的数字收成一个有限集合：风格文件不许自己写间距，
// 只能从这里取。`tests/email-templates.test.ts` 会把每套模板渲染一遍，把它实际用到的
// padding / margin / font-size / line-height 全部量出来，出现集合外的数字就直接失败。
//
// 另一条同样重要的规矩：**正文 16px 起步**。13px 在手机上要凑近了看，一封信里塞满
// 13px 的元信息就是「读起来累」的来源。层级只留四级，读者不用在七种字号之间找重点。

/** 允许出现的所有间距（padding / margin，单位 px）。四的倍数，加一个 2px 用于微调。 */
export const SPACE = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48] as const;

/** 允许出现的边框宽度。 */
export const BORDER = [1, 2, 3, 4, 6] as const;

/** 纵向节奏：段落之间、条目之间、区块之间只准用这五档。 */
export const GAP = { tight: 4, block: 8, group: 12, section: 20, major: 32 } as const;

/** 正文左右留白。所有内容都从这条线开始，缩进只能按 INDENT 递进。 */
export const PAD_X = 24;

/** 层级缩进。嵌套最多两层——再多读者就找不到左边界了。 */
export const INDENT = 16;

/** 竖向内边距的常用档。 */
export const PAD_Y = { row: 12, block: 16, card: 20, section: 24 } as const;

/** 字号。正文 16，最小 14——再小手机上就是灰糊糊一片。
 *
 *  mega / huge 是「版面主角」专用：一个巨号数字或一行巨号标题，是整封信在收件箱缩略图里
 *  唯一还能被认出来的东西。它们只准出现在报头、色板或日期栏里，正文层级仍然只有四级。 */
export const TYPE = {
  mega: 64,
  huge: 44,
  display: 36,
  title: 28,
  heading: 22,
  subhead: 18,
  body: 16,
  small: 14,
} as const;

/** 行高。只用这三个，正文用 loose。 */
export const LEADING = { tight: 1.25, normal: 1.5, loose: 1.75 } as const;

/** 字重。不用 500——很多邮件客户端会把它渲染成 400 或 700，白写。 */
export const WEIGHT = { regular: "400", bold: "700" } as const;

/** 圆角。0 是默认：邮件里圆角一多就像网页卡片。 */
export const RADIUS = [0, 2, 4] as const;

/** 正文宽度上限。超过这个宽度，Outlook 和 Gmail 的阅读栏就不一样了。 */
export const MAX_WIDTH = 600;

/** 内容左边界：depth 0 是页面留白，1、2 是往里的两级缩进。 */
export function inset(depth: 0 | 1 | 2 = 0): number {
  return PAD_X + depth * INDENT;
}

/** 拼行内样式；数字自动补 px，字符串原样（颜色、关键字）。空值会被丢掉。 */
export function css(parts: Record<string, string | number | null | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}:${typeof v === "number" ? `${v}px` : v}`)
    .join(";");
}

/** 行内样式里出现的所有 px 数字，供检查脚本核对标尺。 */
export const ALLOWED_PX: readonly number[] = [...new Set([...SPACE, ...BORDER, ...Object.values(TYPE), ...RADIUS, MAX_WIDTH, PAD_X, INDENT, ...Object.values(GAP), ...Object.values(PAD_Y)])].sort(
  (a, b) => a - b,
);

/** 解析 #rgb / #rrggbb。不是合法色值就返回 null（颜色来自数据，必须能扛住脏值）。 */
function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hex(t: [number, number, number]): string {
  return `#${t.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * 往白里调，得到同族的「淡色」。2.5D 乐队的应援色本来就是官方定义好的**浓淡成对**
 * （Poppin'Party `#FF3377` / `#FFDDEE`、Roselia `#3344AA` / `#DDDDFF`……），
 * 淡色正是官方自己拿来当区块底色的那一半。我们只从数据里拿到浓色，所以在这里按比例兑白。
 * 默认 0.85 对应官方那几组的实际浓淡差。不是合法色值时原样返回。
 */
export function soften(color: string, ratio = 0.85): string {
  const c = rgb(color);
  if (!c) return color;
  const k = Math.max(0, Math.min(1, ratio));
  return hex([c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k]);
}

/** WCAG 相对亮度。不是合法色值时给 0（等同纯黑，最保守）。 */
function luminance(c: string): number {
  const t = rgb(c);
  if (!t) return 0;
  const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(t[0]) + 0.7152 * lin(t[1]) + 0.0722 * lin(t[2]);
}

/** 两色的 WCAG 对比度（1:1 到 21:1）。 */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * 让 `c` 压在 `bg` 上：对比度够 `min` 就用 `c`，不够就退 `fallback`。
 * 用在「想用队色当字色，但不能为了好看牺牲可读性」的地方——看板的乐队名是 22px 粗，
 * 按 WCAG 算大字，大字只要 3:1，所以调用点传 `min = 3`。
 */
export function readableOn(c: string, bg: string, fallback: string, min = 4.5): string {
  return rgb(c) && contrast(c, bg) >= min ? c : fallback;
}

/**
 * 在这个底色上该用深字还是浅字：把两个候选字的**真实对比度**都算出来，取高的那个。
 *
 * 以前这里写的是「相对亮度 > 0.42 就用深字」，那是个凭感觉定的阈值，会在中间地带选错：
 * Poppin'Party 的亮粉 `#ff3377` 亮度 0.31 落在线下 → 返回白字（3.50:1），而深字有 4.89:1。
 * 深浅字色的对比度交叉点跟阈值本来就不是一个数（默认这对字色约在 L≈0.179），
 * 所以这里不再猜阈值，直接比。不是合法色值时给深字。
 */
export function inkOn(bg: string, dark = "#111111", light = "#ffffff"): string {
  if (!rgb(bg)) return dark;
  return contrast(bg, dark) >= contrast(bg, light) ? dark : light;
}
