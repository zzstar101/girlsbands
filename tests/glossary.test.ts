// The controlled glossary behind "中文看全": the site translates Japanese official feeds in full, and a
// model with no name list invents renderings (トゲナシトゲアリ → 无刺有刺, ぴあアリーナMM → Pia Arena MM).
// The list is what stops that, so these tests hold the list's shape: it covers every entity the pack
// knows, it lists only what the text actually names, and it says "copy this", never "rename it to that".
import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { GLOSSARY, GLOSSARY_VERSION, glossaryBlock, glossaryHits } from "@girlsbands/industry/glossary";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { promptText } from "@girlsbands/backend/editorial/prompts";

test("every project and band the pack knows reaches the glossary", () => {
  for (const [id, entity] of Object.entries(ENTITIES)) {
    const kind = entity.kind === "project" ? "project" : "band";
    // ぼっち・ざ・ろっく！ 既是企划名也是作品名：词表把它归在 work 里（同一个名字不列两遍），所以这里也认 work 条目。
    const entry = GLOSSARY.find((e) => e.kind === kind && e.forms.includes(entity.name))
      ?? GLOSSARY.find((e) => e.kind === "work" && e.forms.includes(entity.name));
    assert.ok(entry, `${id} ${entity.name} missing from the glossary`);
    for (const alias of entity.otherNames ?? []) {
      assert.ok(entry.forms.includes(alias) || /ぼっち・ざ・ろっく|ぼざろ|Bocchi/.test(alias), `${id} loses ${alias}`);
    }
  }
});

test("only the proper nouns the text names are listed", () => {
  const block = glossaryBlock("【トゲナシトゲアリ】ワンマンライブ開催決定。MyGO!!!!! も出演。");
  assert.match(block, /トゲナシトゲアリ/);
  assert.match(block, /MyGO!!!!!/);
  assert.doesNotMatch(block, /Roselia/);
  assert.doesNotMatch(block, /チケットぴあ/);
});

test("a text that names nothing gets no block at all", () => {
  for (const text of ["", "   ", "本日は晴天なり。", "东京发生了地震。"]) assert.equal(glossaryBlock(text), "", JSON.stringify(text));
});

// `RAS` and `GBC` are short ASCII aliases: inside another word they mean nothing.
test("short ASCII aliases only match on a word boundary", () => {
  assert.deepEqual(glossaryHits("brasil"), []);
  assert.deepEqual(glossaryHits("Abras"), []);
  assert.ok(glossaryHits("RASのライブ").some((e) => e.forms.includes("RAISE A SUILEN")));
  assert.ok(glossaryHits("RAS").some((e) => e.forms.includes("RAISE A SUILEN")));
});

// The same name is written every way an editor's keyboard allows; all of them must land on one entry.
test("full-width letters, missing spaces and curly apostrophes still match", () => {
  for (const text of ["Poppin'Party", "Poppin’Party", "Ｐｏｐｐｉｎ＇Ｐａｒｔｙ", "poppin party", "POPPIN'PARTY"]) {
    assert.ok(glossaryHits(text).some((e) => e.forms.includes("Poppin'Party")), text);
  }
  assert.ok(glossaryHits("ハロー、ハッピーワールド！").some((e) => e.forms.includes("ハロー、ハッピーワールド！")));
});

// 結束バンド is a band, ぼっち・ざ・ろっく！ is the work it plays in. `ENTITIES` files the work under the
// band for matching, but the glossary must not: "these names are copied as they are" would read as
// "ぼざろ may be written 結束バンド", and a translator that believed it would mistranslate the work.
test("a work's title is filed as a work, not under its band", () => {
  const hits = glossaryHits("ぼざろ の新グッズ");
  assert.ok(hits.some((e) => e.kind === "work" && e.forms.includes("ぼざろ")), "work entry missing");
  assert.deepEqual(hits.filter((e) => e.kind === "band"), [], "the band took the work's name");
});

test("the block tells the model to use a listed name, not to invent one", () => {
  const block = glossaryBlock("トゲナシトゲアリ ぴあアリーナMM");
  assert.match(block, /不要自己音译/);
  assert.doesNotMatch(block, /→/, "an arrow would read as a rename instruction");
  assert.match(block, /- 乐队：/);
});

// 站主 2026-10 拍板：中文圈有通用名就用通用名，不管官不官方。词表里第一个写法就是本站要用的那个。
test("a name with a Chinese rendering lists it first", () => {
  const [takamatsu] = glossaryHits("高松燈", ["member"]);
  assert.ok(takamatsu, "高松燈 missing");
  assert.equal(takamatsu.forms[0], "高松灯");
  const [bocchi] = glossaryHits("ぼっち・ざ・ろっく！", ["work"]);
  assert.ok(bocchi, "ぼっち・ざ・ろっく！ missing");
  assert.equal(bocchi.forms[0], "孤独摇滚");
  // The member table is generated from .data/glossary-members.tsv: the common Chinese name leads even
  // when the official mainland rendering differs (a mainland dub called her 后藤独).
  const [hitori] = glossaryHits("後藤ひとり", ["member"]);
  assert.ok(hitori, "後藤ひとり missing");
  assert.equal(hitori.forms[0], "后藤一里");
  assert.ok(hitori.forms.includes("後藤ひとり"), "the original spelling stays accepted");
  const [ryo] = glossaryHits("山田リョウ", ["member"]);
  assert.equal(ryo?.forms[0], "山田凉");
});

test("the translation prompts carry the block", () => {
  for (const name of ["translate-body", "translate-post"]) {
    const text = promptText(name, { glossary: "【受控词表】トゲナシトゲアリ" });
    assert.match(text, /【受控词表】トゲナシトゲアリ/, `${name} drops the glossary`);
  }
});

// The version is what makes a receipt and a stored translation go stale when the list changes.
test("the glossary version tracks the list", () => {
  assert.match(GLOSSARY_VERSION, new RegExp(`^glossary-${GLOSSARY.length}-[0-9a-z]+$`));
  assert.ok(GLOSSARY.length > 30);
});

// Members and venues are the two researched batches; without them the model transliterates 理名 and
// rewrites ぴあアリーナMM as "Pia Arena MM".
test("member names and venue names reach the block", () => {
  const members = glossaryHits("井芹仁菜役の理名さん、安和すばる役の美怜さん");
  assert.ok(members.some((e) => e.kind === "member" && e.forms.includes("井芹仁菜")), "character missing");
  assert.ok(members.some((e) => e.kind === "member" && e.forms.includes("理名")), "actor missing");
  const venues = glossaryHits("Zepp Haneda (TOKYO) と ぴあアリーナMM、そして MAO Livehouse武汉");
  assert.ok(venues.some((e) => e.kind === "venue" && e.forms.includes("Zepp Haneda (TOKYO)")), "Zepp missing");
  assert.ok(venues.some((e) => e.kind === "venue" && e.forms.includes("ぴあアリーナMM")), "ぴあアリーナMM missing");
  assert.ok(venues.some((e) => e.kind === "venue" && e.forms.includes("MAO Livehouse武汉")), "中国场地 missing");
  assert.match(glossaryBlock("理名 と ぴあアリーナMM"), /- 成员：/);
  assert.match(glossaryBlock("理名 と ぴあアリーナMM"), /- 会场：/);
});

// Kana readings of the short member names are the trap: `あい` sits inside あいだ, `りん` inside りんご,
// `アイ` inside アイドル. The list keeps the kanji forms (理名, 凪都) and drops readings that short.
test("two-kana readings do not fire inside ordinary words", () => {
  for (const text of ["あいだ", "りんご", "アイドル", "なつかしい", "ひなまつり", "ななめ", "ミカン"]) {
    assert.deepEqual(glossaryHits(text).filter((e) => e.kind === "member"), [], text);
  }
  assert.ok(glossaryHits("理名のライブ").some((e) => e.kind === "member" && e.forms.includes("理名")));
  assert.ok(glossaryHits("凪都のベース").some((e) => e.kind === "member" && e.forms.includes("凪都")));
});

// The rule behind the test above, held as a property of the data rather than of one example.
test("no form is too short to mean anything", () => {
  for (const entry of GLOSSARY) {
    for (const form of entry.forms) {
      const cjk = /[\u3400-\u9fff\uf900-\ufaff]/.test(form);
      assert.ok(cjk ? form.length >= 2 : form.length >= 3, `${entry.kind} "${form}" is too short to be distinctive`);
    }
  }
});
