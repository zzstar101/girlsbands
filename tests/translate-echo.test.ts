import assert from "node:assert/strict";
import { test } from "node:test";
import { echoed } from "@girlsbands/backend/editorial/translate";

test("a Japanese sentence handed back unchanged is not a translation", () => {
  const ja = "クズミミズクさんが本日デビューされました！\nよろしくお願い致します！";
  assert.equal(echoed(ja, ja.replace("\n", " \n")), true);
  assert.equal(echoed(ja, "クズミミズク今天正式出道了！\n请多多关照！"), false);
});

test("a block of names only may come back unchanged", () => {
  assert.equal(echoed("クズミミズク / トゲナシトゲアリ", "クズミミズク / トゲナシトゲアリ"), false);
  assert.equal(echoed("<a id=\"L0\">#クズミミズク</a>", "<a id=\"L0\">#クズミミズク</a>"), false);
});
