// 生成头图用的三个子集：
//   assets/og-fonts/noto-sans-jp-{400,700}.ttf   —— 中文/日文正文与固定文案（CN/JP 兜底）+ 日期图的「月」
//   assets/og-fonts/dela-gothic-one.ttf          —— 显示字体（超粗黑海报体）：乐队名、邮件标题大字、日期数字
//   assets/og-fonts/zcool-kuaile.ttf             —— 品牌字体（站名专用）：邮件头图与分享图左上角的 `SITE.name`
//
// 为什么需要日文子集：apps/api/src/og/render.ts 原先只注册 GB2312 子集，里面**没有**日文汉字
// 結(U+7D50) 与 夢(U+5922)（GB2312 只有简体的 结/梦）。satori 遇到缺字会画成豆腐块且不报错，
// 所以「結束バンド」「夢限大みゅーたいぷ」的信息条与纯色海报一直是坏字。日文假名与日文汉字
// 在 Source Han 里是另一套字形，只能靠单独的字族。
//
// 子集只收 ENTITIES 里出现过的字 + 假名 + 拉丁 + 标点（约 52KB × 2）。刻意不装 4.3MB 的全量
// 日文字库：头图只会写乐队名与固定文案，字集由 tests/og-fonts.test.ts 钉住——将来新增一支乐队、
// 名字里带了没收的字，测试会红，重跑本脚本即可。
//
// 依赖 fontTools（pyftsubset / varLib.instancer）。缺了就报错退出，不静默跳过。
// 源字体 Noto Sans JP 可变字体（Google Fonts，OFL-1.1）下到 .data/fonts/，不入库。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "@girlsbands/industry/site";
import { ENTITIES } from "@girlsbands/industry/taxonomy";

const ROOT = path.resolve(new URL("../../", import.meta.url).pathname);
const VF_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf";
const VF = path.join(ROOT, ".data/fonts/NotoSansJP-VF.ttf");
/** 显示字体：Dela Gothic One（Google Fonts，OFL-1.1），静态单一字重。 */
const DELA_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/delagothicone/DelaGothicOne-Regular.ttf";
const DELA = path.join(ROOT, ".data/fonts/DelaGothicOne-Regular.ttf");
/** 品牌字体：站酷快乐体（Google Fonts，OFL-1.1），静态单一字重，只用来画站名一个词。 */
const KC_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf";
const KC = path.join(ROOT, ".data/fonts/ZCOOLKuaiLe-Regular.ttf");
const OUT_DIR = path.join(ROOT, "assets/og-fonts");
/** 拉丁显示字体：Anton（Google Fonts，OFL-1.1），和网站的 --font-display 同一款，画海报上的英文大字与数字。 */
const ANTON_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf";
const ANTON = path.join(ROOT, ".data/fonts/Anton-Regular.ttf");
/** 头图里写死的文案（apps/api/src/og/hero.ts 的 URGENT_LABEL / JST_LABEL，content.ts 的措辞）。 */
const FIXED_COPY = "● 48 小时内 日本时间 JST 全部乐队与企划 支 个";
/** 邮件标题图上的日文大字（apps/api/src/og/title.ts 的 MAIL_TITLES）：显示字体必须自己覆盖，
 *  否则 satori 会悄悄回退到中文子集，字就不是 Dela Gothic One 了（不报错，只是变了样）。 */
export const MAIL_TITLE_JP = "締切レーダー 今日のニュース あと一歩。";
/** 日期图第一行的「10月」走日文字族（title.ts 的 dateTree），月份汉字得在日文子集里。 */
export const DATE_JP = "月";

function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)).join("");
}

/**
 * JIS 第一、第二水准的全部汉字（cp932 能编码的那 6000 多个）。分享海报会画任意标题，标题里的日文
 * 汉字（響、櫻、讃……）不在 GB2312 简体子集里，缺字就是豆腐块；收全常用日文汉字后子集约 2MB。
 */
export function jisKanji() {
  const decoder = new TextDecoder("shift_jis", { fatal: true });
  const out = new Set<string>();
  for (let hi = 0x88; hi <= 0xfc; hi++) {
    if (hi > 0x9f && hi < 0xe0) continue;
    for (let lo = 0x40; lo <= 0xfc; lo++) {
      if (lo === 0x7f) continue;
      try {
        const ch = decoder.decode(new Uint8Array([hi, lo]));
        const cp = ch.codePointAt(0)!;
        if ([...ch].length === 1 && ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff))) out.add(ch);
      } catch {
        /* 空码位 */
      }
    }
  }
  return out;
}

/** 要收进正文子集的字符：乐队/企划名 + 固定文案 + JIS 汉字 + 假名 + 拉丁 + 标点。 */
export function jpCharset() {
  const chars = new Set<string>(jisKanji());
  for (const entity of Object.values(ENTITIES)) for (const ch of entity.name) chars.add(ch);
  for (const ch of FIXED_COPY) chars.add(ch);
  for (const ch of DATE_JP) chars.add(ch);
  for (const ch of range(0x3040, 0x30ff)) chars.add(ch); // 平假名 + 片假名
  for (const ch of range(0x0020, 0x007e)) chars.add(ch); // ASCII
  for (const ch of range(0x00a0, 0x00ff)) chars.add(ch); // Latin-1
  for (const ch of range(0x2000, 0x206f)) chars.add(ch); // 破折号、引号、省略号
  for (const ch of range(0x3000, 0x303f)) chars.add(ch); // CJK 标点
  for (const ch of range(0xff00, 0xffef)) chars.add(ch); // 全角
  return [...chars].sort().join("");
}

/** 显示字体的字符集：**只有**乐队/企划名 + 邮件标题的日文大字 + 数字 + 标点。
 *
 *  刻意不收中文固定文案（「48 小时内」「日本时间 JST」）：Dela Gothic One 是日文字体，没有简体
 *  字形，收进来只会让「这个字库支持中文」变成错觉——中文标签一律走 CN_FAMILY。假名照收，将来
 *  新增一支名字带假名的乐队不用重挑字体。日文标题（締切レーダー / 今日のニュース / あと一歩。）
 *  是例外：它就是显示字体自己的字，不收就会静默回退成中文字形。 */
export function displayCharset() {
  const chars = new Set<string>();
  for (const entity of Object.values(ENTITIES)) for (const ch of entity.name) chars.add(ch);
  for (const ch of MAIL_TITLE_JP) chars.add(ch);
  for (const ch of range(0x3040, 0x30ff)) chars.add(ch); // 平假名 + 片假名
  for (const ch of range(0x0020, 0x007e)) chars.add(ch); // ASCII（数字与 : . 都在这）
  for (const ch of range(0x00a0, 0x00ff)) chars.add(ch);
  for (const ch of range(0x2000, 0x206f)) chars.add(ch);
  for (const ch of range(0x3000, 0x303f)) chars.add(ch);
  for (const ch of range(0xff00, 0xffef)) chars.add(ch);
  return [...chars].sort().join("");
}

/** 品牌字体的字符集：**只有**站名里的字 + 拉丁 + 标点。
 *
 *  站名是唯一会用它画的词（邮件头图左上角、分享图与海报的角标），所以字集就是 `SITE.name`。
 *  换个站名、或多出一款字体没有的字，tests/og-fonts.test.ts 会红，重跑本脚本即可。
 *  刻意不在这里收乐队名：中文标签与乐队名一律走 CN_FAMILY / JP_FAMILY / DISPLAY_FAMILY。 */
export function brandCharset() {
  const chars = new Set<string>();
  for (const ch of SITE.name) chars.add(ch);
  for (const ch of range(0x0020, 0x007e)) chars.add(ch); // ASCII（撇号、空格都在这）
  for (const ch of range(0x00a0, 0x00ff)) chars.add(ch);
  for (const ch of range(0x2000, 0x206f)) chars.add(ch);
  for (const ch of range(0x3000, 0x303f)) chars.add(ch);
  for (const ch of range(0xff00, 0xffef)) chars.add(ch);
  return [...chars].sort().join("");
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error) throw new Error(`${cmd} 起不来：${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} 退出 ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

async function ensure(url: string, file: string) {
  if (existsSync(file)) return;
  await mkdir(path.dirname(file), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载 ${url} 失败：HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`下载源字体 → ${path.relative(ROOT, file)}`);
}

/** 子集里实际有多少个字形（含 .notdef）——「字节数没变但字没了」这种事只有数一下才看得出来。 */
function glyphCount(file: string) {
  return Number(run("python3", ["-c", `from fontTools.ttLib import TTFont\nprint(len(TTFont(${JSON.stringify(file)}).getGlyphOrder()))`]).trim());
}

/** 把源字体按字符集裁成子集，并打印体积。 */
async function subset(src: string, out: string, charsetFile: string, label: string) {
  run("pyftsubset", [src, `--text-file=${charsetFile}`, `--output-file=${out}`, "--layout-features=", "--no-hinting", "--drop-tables+=GSUB,GPOS,GDEF"]);
  const size = (await readFile(out)).length;
  console.log(`${path.relative(ROOT, out)}  ${Math.round(size / 1024)} KB  ${glyphCount(out)} 字形  ${label}`);
  return size;
}

async function main() {
  for (const cmd of ["python3", "pyftsubset"]) {
    if (spawnSync(cmd, ["--version"], { encoding: "utf8" }).error) throw new Error(`缺少 ${cmd}（需要 fontTools：pip install fonttools）`);
  }
  await ensure(VF_URL, VF);
  const charsetFile = path.join(ROOT, ".data/fonts/jp-charset.txt");
  await writeFile(charsetFile, jpCharset());
  for (const weight of [400, 700]) {
    const staticTtf = path.join(ROOT, `.data/fonts/NotoSansJP-${weight}.ttf`);
    if (!existsSync(staticTtf)) {
      run("python3", [
        "-c",
        `from fontTools.ttLib import TTFont\nfrom fontTools.varLib import instancer\nf=TTFont(${JSON.stringify(VF)})\ninstancer.instantiateVariableFont(f,{"wght":${weight}},inplace=True)\nf.save(${JSON.stringify(staticTtf)})`,
      ]);
      console.log(`实例化 wght=${weight} → ${path.relative(ROOT, staticTtf)}`);
    }
    const out = path.join(OUT_DIR, `noto-sans-jp-${weight}.ttf`);
    await subset(staticTtf, out, charsetFile, `${jpCharset().length} 个字符`);
  }

  // 显示字体：静态单一字重，直接裁，不需要实例化。
  await ensure(DELA_URL, DELA);
  const displayFile = path.join(ROOT, ".data/fonts/display-charset.txt");
  await writeFile(displayFile, displayCharset());
  const dela = await subset(DELA, path.join(OUT_DIR, "dela-gothic-one.ttf"), displayFile, `${displayCharset().length} 个字符（乐队名、邮件标题、数字）`);
  if (dela > 400 * 1024) throw new Error(`显示字体子集 ${Math.round(dela / 1024)}KB 太大了：多半是把整套假名收进来了，收窄 displayCharset()`);

  // Anton：只收拉丁与标点。
  await ensure(ANTON_URL, ANTON);
  const antonFile = path.join(ROOT, ".data/fonts/anton-charset.txt");
  await writeFile(antonFile, range(0x0020, 0x007e) + range(0x00a0, 0x00ff) + range(0x2010, 0x2027));
  await subset(ANTON, path.join(OUT_DIR, "anton.ttf"), antonFile, "拉丁与数字");

  // 品牌字体：静态单一字重，只画站名一个词，直接裁。
  await ensure(KC_URL, KC);
  const brandFile = path.join(ROOT, ".data/fonts/brand-charset.txt");
  await writeFile(brandFile, brandCharset());
  const brand = await subset(KC, path.join(OUT_DIR, "zcool-kuaile.ttf"), brandFile, `${brandCharset().length} 个字符（站名）`);
  if (brand > 200 * 1024) throw new Error(`品牌字体子集 ${Math.round(brand / 1024)}KB 太大了：收窄 brandCharset()`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
