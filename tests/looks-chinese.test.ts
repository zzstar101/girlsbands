// Telling Chinese from Japanese before translating. The two languages share the Han characters, so a
// Han-only test reads every Japanese headline as Chinese and skips the translation this site exists to
// produce; kana is what separates them.
import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { looksChinese, writtenInJapanese } from "@girlsbands/backend/lib/text";

test("Han without kana is Chinese; Han with kana is Japanese and still needs translating", () => {
  const chinese = ["Live 门票现已开售，抽选即将截止", "官方宣布追加席位", "演唱会延期公告", "抽选结果"];
  const japanese = [
    "8th ONE-MAN LIVE『凛音の理』開催決定",
    "トゲナシトゲアリ ワンマンライブ チケット先行受付開始",
    "チケット一般販売は10月20日より",
    "【重要】公演中止のお知らせ",
  ];
  assert.deepEqual(chinese.filter((s) => !looksChinese(s)), [], "Chinese not recognised");
  assert.deepEqual(japanese.filter((s) => looksChinese(s)), [], "Japanese read as Chinese");
});

test("text with no Han characters is never Chinese", () => {
  for (const s of ["", "8th ONE-MAN LIVE", "Togenashi Togeari", "チケット", "12345"]) {
    assert.equal(looksChinese(s), false, s);
  }
});

// Korean borrows Hanja the same way Japanese borrows Han; Hangul is what gives it away.
test("a Korean line that borrows Hanja is not Chinese either", () => {
  for (const s of ["한국어", "少女バンド 공연 안내", "ライブ 안내"]) assert.equal(looksChinese(s), false, s);
});

// A string written in kanji alone has nothing to go by and reads as Chinese — including a Korean word
// written in Hanja (韓国語). The structured analysis still writes the Chinese title, so the cost is a
// redundant translation, never a missing one.
test("a kanji-only string is indistinguishable and reads as Chinese", () => {
  assert.equal(looksChinese("開催決定"), true);
  assert.equal(looksChinese("追加席"), true);
  assert.equal(looksChinese("韓国語"), true);
});

test("综述写成日文认得出来，引用的日文名字不算", () => {
  assert.equal(writtenInJapanese("ガールズバンドクライ Special LIVE「赤色の響祭」をめぐっては、2026年10月7日18時の公式Xで、先日「Canna Lily」「F-272」の追加出演が発表されたことがあらためて示された。"), true);
  assert.equal(writtenInJapanese("ガールズバンドクライ Special LIVE「赤色の響祭」将于 2026 年 11 月 3 日在 ぴあアリーナMM 举行，此前已公布「Canna Lily」「F-272」「クズミミズク」追加出演，トゲナシトゲアリ 与 ダイヤモンドダスト 的演出时长较去年更长。"), false);
  assert.equal(writtenInJapanese("millsage 1st Single「鳴らす」与一家Dumb Rock! 1st Single「ピースフル・ピーシーズ！」于 9 月 30 日发售，Pre-save 活动截至前一天 20:00。"), false);
});
