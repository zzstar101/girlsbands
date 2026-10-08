// 邮件头图（industry/email/hero.ts）的规格检查。
//
// 这一层是「两端共用的契约」：信由 worker 拼（content.ts 造 spec），图由 API 画（og/hero.ts 收 spec）。
// 它自己不做 IO，所以能在这里逐条钉死——尤其是 token 的往返与坏输入，因为 token 是**用户可控**的
// URL 片段（/og/email/<token>.png），解析器一旦放行半成品，就等于放行了一张别人指定的图。
import "./setup.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "@girlsbands/backend/config";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { inkOn } from "@girlsbands/industry/email/layout";
import {
  HERO_CSS_H,
  HERO_CSS_W,
  MAX_HERO_TOKEN,
  dateParts,
  decodeHero,
  encodeHero,
  heroHandle,
  normalizeHero,
  type HeroSpec,
} from "@girlsbands/industry/email/hero";

const SPEC: HeroSpec = {
  accent: "#2f6fd0",
  ink: "#202126",
  surface: "#ffffff",
  star: "トゲナシトゲアリ",
  date: "2026-10-04",
  logo: "togenashi-togeari",
};

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

test("hero token：同一份 spec 永远同一个 token，往返之后一字不差", () => {
  const token = encodeHero(SPEC);
  assert.equal(token, encodeHero(SPEC), "同一份 spec 编出两个 token，缓存与 ETag 就全废了");
  assert.deepEqual(decodeHero(token), SPEC);
  // 字段顺序固定：先写 a/i/s/t/d/g 里非空非零的那些；没有日期时 d 不写，token 就该更短。
  assert.ok(encodeHero({ ...SPEC, date: "" }).length < token.length, "少一个字段 token 就该更短");
  assert.equal(decodeHero(encodeHero({ ...SPEC, date: "" }))?.date, "");
});

test("hero logo：只放行形状合法的乐队 id，其余一律丢掉退回海报", () => {
  // 这里故意喂 unknown：验证器要挡的是「不是 string 的东西」，而 TS 的类型在运行时不存在。
  const pick = (logo: unknown) => normalizeHero({ logo } as Partial<HeroSpec>).logo;
  // 22 个主体的 id 必须全部原样通过——它们就是 assets/band-logos/ 的文件名。
  for (const id of Object.keys(ENTITIES)) assert.equal(pick(id), id, `${id} 是合法乐队 id，不该被丢`);
  assert.equal(pick(SPEC.logo), SPEC.logo);
  assert.equal(pick("  " + SPEC.logo + "  "), SPEC.logo, "首尾空白应该被裁掉");
  for (const [what, value] of [
    ["大写", "MyGO"],
    ["下划线", "girls_band_cry"],
    ["点", "a.b"],
    ["斜杠", "../../etc/passwd"],
    ["路径分隔符", "band/logos"],
    ["空格", "my go"],
    ["前导连字符", "-mygo"],
    ["空串", ""],
    ["只有空白", "   "],
    ["脚本", "javascript:alert(1)"],
    ["绝对 URL", "https://evil.example/logo.png"],
    ["超长", "a".repeat(41)],
  ] as Array<[string, unknown]>) {
    assert.equal(pick(value), null, `${what} 应该被丢掉`);
  }
  assert.equal(pick(123), null);
  assert.equal(pick(null), null);
  assert.equal(normalizeHero({}).logo, null, "没给乐队就是 null，绝不猜一支");
});

test("hero token：带 logo 也能往返，且 token 塞得进上限", () => {
  const token = encodeHero(SPEC);
  assert.equal(decodeHero(token)?.logo, SPEC.logo);
  // 最坏情况：60 字主角 + 日期 + 40 字（正好到顶）乐队 id。
  const longest = "b".repeat(40);
  assert.equal(longest.length, 40);
  const worst = encodeHero({ ...SPEC, logo: longest });
  assert.ok(worst.length <= MAX_HERO_TOKEN, `最坏 token ${worst.length} 字，超过 ${MAX_HERO_TOKEN}`);
  assert.equal(decodeHero(worst)?.logo, longest);
  // 没有乐队时不该写 g 字段：站级邮件的 token 里一个多余字段都没有。
  assert.equal(decodeHero(encodeHero({ ...SPEC, logo: null }))?.logo, null);
  assert.ok(encodeHero({ ...SPEC, logo: null }).length < token.length, "少一个字段 token 就该更短");
});

test("hero token：坏输入一律 null，绝不返回半成品 spec", () => {
  const bad: Array<[string, string]> = [
    ["空 token", ""],
    ["base64 表外的字符", "!!!!"],
    ["长度 1（凑不满一个字节）", "A"],
    ["合法 base64 但不是 JSON", b64("hello")],
    ["JSON 但是数组", b64("[]")],
    ["JSON 但是字符串", b64('"x"')],
    ["JSON 但是 null", b64("null")],
    ["超长 token", "A".repeat(MAX_HERO_TOKEN + 1)],
  ];
  for (const [what, token] of bad) assert.equal(decodeHero(token), null, `${what} 应该被拒`);
});

test("hero spec：颜色、文字、日期、长度都被收拾过，画的时候不用再防一遍", () => {
  const dirty = normalizeHero({
    accent: "#FF3377",
    ink: "red",
    surface: "#FFF",
    star: "  MyGO!!!!!\n\n 　 ",
    date: "2026/10/04",
  });
  assert.equal(dirty.accent, "#ff3377", "合法色值应该被小写化");
  assert.equal(dirty.ink, "#202126", "非法色值必须回退，绝不让 'red' 流到 satori");
  assert.equal(dirty.surface, "#ffffff", "#FFF 是三位缩写，规格只认六位");
  assert.equal(dirty.star, "MyGO!!!!!", "空白（含全角空格）应该被折叠掉");
  assert.equal(dirty.date, "", "只认 YYYY-MM-DD；斜杠写法一律当没有日期");
  assert.equal(normalizeHero({ date: "2026-10-04T23:59" }).date, "2026-10-04", "带时刻的截到日期为止");
  assert.equal(normalizeHero({}).star, "少女乐队's", "没有主角时退站名");
});

test("hero 日期：图上那两处文字（鬼影日号 + 右下日期）只从合法日期来", () => {
  assert.deepEqual(dateParts("2026-10-04"), { day: "04", line: "10 / 04 · JST" });
  // 没有日期就两个都空——渲染那端据此整段不画，绝不留一个孤零零的「JST」。
  for (const bad of ["", "2026/10/04", "2026-10-04T23:59", "10-04", "x"]) {
    assert.deepEqual(dateParts(bad), { day: "", line: "" }, `${bad} 不该产出日期文字`);
  }
});

test("hero 句柄：地址、替代文字、显示尺寸、兜底色一个不少", () => {
  const handle = heroHandle(SPEC, "https://girlsbands.example/");
  assert.match(handle.src, /^https:\/\/girlsbands\.example\/og\/email\/[A-Za-z0-9_-]+\.png$/, "末尾的斜杠应该被吃掉，别拼出 //og");
  assert.equal(decodeHero(handle.src.split("/og/email/")[1]!.replace(/\.png$/, ""))?.star, SPEC.star);
  // 图片被屏蔽时读者只剩这行字，所以「哪支乐队、哪一天」必须自己说完整。
  assert.equal(handle.alt, "トゲナシトゲアリ｜10 / 04 · JST");
  assert.equal(handle.width, HERO_CSS_W);
  assert.equal(handle.height, HERO_CSS_H);
  assert.equal(handle.bg, SPEC.accent, "图片被屏蔽时那一格要铺成应援色，bg 必须等于 accent");
  assert.equal(handle.caption, SPEC.star);
  // 没有日期就只有主角，不留一个孤零零的分隔符。
  assert.equal(heroHandle({ ...SPEC, date: "" }, "https://girlsbands.example").alt, SPEC.star);
});

test("logo 入库：22 个主体一个不缺，manifest 与磁盘上的 PNG 逐字节对得上", async () => {
  // 这条测的是「资产与代码不许走散」。渲染端读 manifest 决定拿哪张图、用不用得上，
  // 清单缺一条或多一条都不会报错、只会安静地退回海报——那正是最难发现的那种退化。
  const dir = path.join(REPO_ROOT, "assets/band-logos");
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as {
    logos: Record<string, { file: string; sha256: string; width: number; height: number; inkLum: number | null; onDark: boolean }>;
  };
  const ids = Object.keys(ENTITIES);
  assert.deepEqual(
    Object.keys(manifest.logos).sort(),
    [...ids].sort(),
    "manifest 的 key 必须与 ENTITIES 一一对应（加了乐队就要跑 bun scripts/fetch-band-logos.ts）",
  );
  const onDisk = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
  assert.deepEqual(onDisk, ids.map((id) => `${id}.png`).sort(), "目录里的 PNG 必须与 manifest 一一对应，不留孤儿文件");

  for (const id of ids) {
    const entry = manifest.logos[id];
    assert.ok(entry, `${id} 在 manifest 里缺席`);
    assert.equal(entry.file, `${id}.png`, "文件名只能是 <id>.png，渲染端拿它拼路径");
    const png = await readFile(path.join(dir, entry.file));
    // PNG 头：8 字节签名 + IHDR，宽高是大端 32 位的第 16..24 字节。
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${id} 不是 PNG（satori 只认 PNG/JPEG 的 data URI）`);
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), entry.width, `${id} 的 manifest 宽度与文件不符`);
    assert.equal(png.readUInt32BE(20), entry.height, `${id} 的 manifest 高度与文件不符`);
    assert.equal(png[25], 6, `${id} 必须是 RGBA（透明底），否则底色挑不出来`);
    assert.ok(entry.width <= 1200 && entry.height <= 1200, `${id} 超过 1200px 上限`);
    assert.equal(createHash("sha256").update(png).digest("hex"), entry.sha256, `${id} 的 sha256 与 manifest 不符（它进头图 ETag）`);
    assert.equal(entry.onDark, entry.inkLum !== null && entry.inkLum >= 0.55, `${id} 的 onDark 与 inkLum 不一致`);
    if (entry.inkLum !== null) assert.ok(entry.inkLum >= 0 && entry.inkLum <= 1, `${id} 的 inkLum 越界`);
  }
});

test("inkOn：永远选对比度更高的那一半，而不是靠固定亮度阈值猜", () => {
  const lum = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const chan = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * chan[0]! + 0.7152 * chan[1]! + 0.0722 * chan[2]!;
  };
  const ratio = (a: string, b: string): number => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const DARK = "#1b1b20";
  const LIGHT = "#ffffff";
  // 全 22 个主体的应援色 + 极端色（纯白、纯黑、中灰）+ 一段网格，阈值式实现会在这几处选错。
  const samples = new Set<string>([...Object.values(ENTITIES).map((e) => e.accent).filter((a): a is string => Boolean(a)), "#ff3377", "#ffffff", "#000000", "#808080", "#e8b53c", "#c8342a"]);
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) samples.add(`#${[r, g, b].map((v) => (v * 51).toString(16).padStart(2, "0")).join("")}`);
  for (const bg of samples) {
    if (!/^#[0-9a-f]{6}$/.test(bg)) continue;
    const picked = inkOn(bg, DARK, LIGHT);
    const other = picked === DARK ? LIGHT : DARK;
    assert.ok(
      ratio(bg, picked) >= ratio(bg, other),
      `${bg} 上选了 ${picked}（${ratio(bg, picked).toFixed(2)}:1），但 ${other} 有 ${ratio(bg, other).toFixed(2)}:1`,
    );
    // 正文级别的底色不该掉到 AA 以下；大字号（头图主角 56px+）按 3:1 算。
    assert.ok(ratio(bg, picked) >= 3, `${bg} 上 ${picked} 只有 ${ratio(bg, picked).toFixed(2)}:1，连大字号的 3:1 都不到`);
  }
});
