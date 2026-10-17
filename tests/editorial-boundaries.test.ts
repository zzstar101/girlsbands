import assert from "node:assert/strict";
import { test } from "node:test";
import { PREFILTER_SYSTEM, UNDERSTAND_SYSTEM } from "@girlsbands/backend/editorial/writing";
import { STRUCTURE_SYSTEM } from "@girlsbands/backend/editorial/analyze";
import { BATCH_SYSTEM, PAIR_SYSTEM } from "@girlsbands/backend/events/relate";

// Prompt contracts, not a claim that a live model always follows the rules.
test("personal expression is daily unless the author adds concrete work news", () => {
  assert.match(PREFILTER_SYSTEM, /演出感想/);
  assert.match(PREFILTER_SYSTEM, /纯转帖/);
  assert.match(PREFILTER_SYSTEM, /新增.*工作信息/);
});

test("initial and review judges share reminder and source-conflict boundaries", () => {
  for (const text of [BATCH_SYSTEM, PAIR_SYSTEM]) {
    assert.match(text, /倒计时/);
    assert.match(text, /日期冲突.*不能.*新进展/);
    assert.match(text, /明日.*实际开售/);
  }
});

test("writing and structure preserve period endpoints and quoted time anchors", () => {
  for (const text of [UNDERSTAND_SYSTEM, STRUCTURE_SYSTEM]) {
    assert.match(text, /Sales Period/);
    assert.match(text, /引用帖.*发布时间/);
  }
  assert.match(STRUCTURE_SYSTEM, /同一首歌.*MV.*频道.*single/);
});
