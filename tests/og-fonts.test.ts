// 头图字库：日文名走 Noto Sans JP，中文标签走 Noto Sans SC，两个子集互相兜底。
//
// 为什么单独立一个文件：satori 遇到字体里没有的字会画成豆腐块而且**不报错**，看截图也容易漏。
// 真事：GB2312 子集里没有 結(U+7D50) 与 夢(U+5922)（只有简体的 结/梦），于是「結束バンド」
// 「夢限大みゅーたいぷ」的头图一直是坏字。所以「每个字都有字形」必须是断言。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { ENTITIES } from "@aihot/industry/taxonomy";
import { jpCharset } from "../scripts/og/build-og-jp-font.ts";
import { MAIL_TITLE_IDS, MAIL_TITLES } from "../apps/api/src/og/title.ts";

type Font = { charToGlyphIndex(ch: string): number };
const { parse } = createRequire(import.meta.url)("@shuding/opentype.js") as { parse: (b: ArrayBuffer) => Font };
const DIR = new URL("../assets/og-fonts/", import.meta.url);

async function load(file: string) {
  const buf = await readFile(new URL(file, DIR));
  return { font: parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer), bytes: buf.length };
}
const has = (font: Font, ch: string) => font.charToGlyphIndex(ch) > 0;

test("头图字库：19 支乐队与企划的名字，每个字都有字形", async () => {
  const sc = (await load("noto-sans-sc-700.ttf")).font;
  const jp = (await load("noto-sans-jp-700.ttf")).font;
  const missing: string[] = [];
  for (const [id, entity] of Object.entries(ENTITIES)) {
    for (const ch of entity.name) if (!has(sc, ch) && !has(jp, ch)) missing.push(`${id} 的「${ch}」U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`);
  }
  assert.deepEqual(missing, [], `这些字在两个子集里都没有字形，satori 会画豆腐块：\n${missing.join("\n")}`);
});

test("头图字库：日文汉字只有日文字集有，所以两个子集都得注册", async () => {
  const sc = (await load("noto-sans-sc-700.ttf")).font;
  const jp = (await load("noto-sans-jp-700.ttf")).font;
  // 結 / 夢：GB2312 只有简体，日文汉字缺 → 没注册 JP 就是豆腐块
  for (const ch of ["結", "夢"]) {
    assert.equal(has(sc, ch), false, `${ch} 不该出现在简中子集里（它是日文汉字）`);
    assert.equal(has(jp, ch), true, `${ch} 必须在日文字集里`);
  }
  // 时 / 间 / 乐 / 队：简体专用字，日文字集没有 → 中文标签靠 SC 兜底
  for (const ch of ["时", "间", "乐", "队"]) {
    assert.equal(has(sc, ch), true, `${ch} 是简中标签的字，必须在 SC 子集里`);
    assert.equal(has(jp, ch), false, `${ch} 不该出现在日文字集里`);
  }
});

test("头图字库：日文字集覆盖全部假名与乐队名，且只有几十 KB", async () => {
  const { font, bytes } = await load("noto-sans-jp-700.ttf");
  const charset = jpCharset();
  // 字集是「想要」的清单（含 Latin-1、各种空格），源字体本身没有的字 pyftsubset 会跳过；
  // 但是假名与乐队名这些真会画出来的字，一个都不能缺。
  // U+3040 / U+3097 / U+3098 是未分配码位，任何字体都没有，别把它们算成缺字
  const kana = [...Array(0x30ff - 0x3040 + 1)]
    .map((_, i) => String.fromCodePoint(0x3040 + i))
    .filter((ch) => /^[\u3041-\u3096\u3099-\u309F\u30A1-\u30FA\u30FB-\u30FF]$/.test(ch));
  const names = Object.values(ENTITIES).flatMap((e) => [...e.name]);
  const required = new Set([...kana, ...names]);
  const missing = [...required].filter((ch) => !has(font, ch));
  assert.deepEqual(missing, [], `日文字集缺字（重跑 scripts/og/build-og-jp-font.ts）：${missing.join("")}`);
  assert.ok(charset.length > 300, `字集太小了：${charset.length}`);
  // 刻意不做全量日文字库（4.3MB）：头图只写乐队名与固定文案
  assert.ok(bytes <= 200 * 1024, `日文字集不该超过 200KB，现在是 ${Math.round(bytes / 1024)}KB`);
});

test("头图字库：400 与 700 两个字重收同一套字", async () => {
  const regular = (await load("noto-sans-jp-400.ttf")).font;
  const bold = (await load("noto-sans-jp-700.ttf")).font;
  const diff = [...jpCharset()].filter((ch) => has(regular, ch) !== has(bold, ch));
  assert.deepEqual(diff, [], `两个字重的字集不一致：${diff.join("")}`);
});

test("显示字体：19 支乐队与企划的名字一个不缺，且体积受控", async () => {
  const { font, bytes } = await load("dela-gothic-one.ttf");
  const missing: string[] = [];
  for (const [id, entity] of Object.entries(ENTITIES)) {
    for (const ch of entity.name) if (!has(font, ch)) missing.push(`${id} 的「${ch}」`);
  }
  assert.deepEqual(missing, [], `显示字体缺字（重跑 scripts/og/build-og-jp-font.ts）：${missing.join(" ")}`);
  // 数字与日期标点也要有：头图的大字日期走这个字族
  for (const ch of "0123456789:.・/ ") assert.equal(has(font, ch), true, `显示字体缺「${ch}」`);
  assert.ok(bytes <= 400 * 1024, `显示字体子集不该超过 400KB，现在是 ${Math.round(bytes / 1024)}KB`);
});

test("显示字体：刻意不含中文固定文案，中文标签必须继续走 Noto Sans SC", async () => {
  const { font } = await load("dela-gothic-one.ttf");
  // 简体专用字（时/间/乐/队）不在 Dela 里 —— 这正是「中文标签别用显示字体」这条规矩的物理依据
  for (const ch of ["时", "间", "乐", "队"]) {
    assert.equal(has(font, ch), false, `显示字体不该有简体字「${ch}」；真有了说明 displayCharset() 收太宽了`);
  }
  // 中文固定文案里的字，凡 Dela 有的也不许出现（displayCharset 刻意不收 FIXED_COPY）
  const sc = (await load("noto-sans-sc-700.ttf")).font;
  // 「日」不在这张清单里：邮件标题「今日のニュース」让它合法地进了显示字体子集（见下一条测试）
  for (const ch of "小时内本全部支个") {
    assert.equal(has(sc, ch), true, `SC 子集该有「${ch}」`);
    assert.equal(has(font, ch), false, `「${ch}」是中文标签的字，不该进显示字体子集`);
  }
});

test("邮件卡片图：标题图的日文大字与中文小字、日期图的「10月」都有字形", async () => {
  const dela = (await load("dela-gothic-one.ttf")).font;
  const jp = (await load("noto-sans-jp-700.ttf")).font;
  const sc = (await load("noto-sans-sc-700.ttf")).font;
  // apps/api/src/og/title.ts 是文案的唯一出处：这里断言的就是那两张图真正会画的字。
  const cases: Array<[string, Font, string]> = [
    ...MAIL_TITLE_IDS.map((id) => [`标题图 ${id} 的日文大字（Dela Gothic One）`, dela, MAIL_TITLES[id].jp] as [string, Font, string]),
    ...MAIL_TITLE_IDS.map((id) => [`标题图 ${id} 的中文小字（Noto Sans SC）`, sc, MAIL_TITLES[id].cn] as [string, Font, string]),
    ["日期图第一行（Noto Sans JP）", jp, "10月"],
  ];
  const missing: string[] = [];
  for (const [label, font, text] of cases) {
    const gone = [...text].filter((ch) => !has(font, ch));
    if (gone.length) missing.push(`${label}「${text}」缺 ${gone.map((ch) => `${ch}(U+${ch.codePointAt(0)!.toString(16).toUpperCase()})`).join(" ")}`);
  }
  assert.deepEqual(missing, [], `邮件卡片图缺字，satori 会画豆腐块或悄悄回退到别的字族（重跑 scripts/og/build-og-jp-font.ts）：\n${missing.join("\n")}`);
  // 最隐蔽的一种坏法：显示字体缺字，satori 回退到 SC/JP——图里仍然「有字」，只是不再是那个字体，
  // 也不报错。所以日文标题的每一个字都必须由 Dela 自己画。
  const fallen = MAIL_TITLE_IDS.flatMap((id) => [...MAIL_TITLES[id].jp]).filter((ch) => !has(dela, ch));
  assert.deepEqual(fallen, [], `日文标题缺显示字体字形，会静默回退成中文字形：${fallen.join("")}`);
});
