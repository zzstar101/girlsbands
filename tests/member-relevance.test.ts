import assert from "node:assert/strict";
import { test } from "node:test";
import { PREFILTER_SYSTEM, renderContext } from "@girlsbands/backend/editorial/writing";
import type { AnalyzeInputArticle } from "@girlsbands/backend/editorial/input";

const memberArticle: AnalyzeInputArticle = {
  id: "member-post", revision: 1, title: "新曲发布", url: "https://example.test/post", author: null,
  publishedAt: null, bodyText: "关联乐队发布新曲", excerpt: null, xPost: null, media: [],
  source: {
    name: "成员 X", kind: "x_search", tier: "T1_5", firstParty: false,
    tags: ["官方", "成员"], ownerEntityId: "mygo",
  },
};

test("member account prefilter distinguishes associated project from unrelated appearances", () => {
  const context = renderContext(memberArticle);
  assert.match(context, /【来源标签】官方, 成员/);
  assert.match(context, /【关联主体】/);
  assert.match(PREFILTER_SYSTEM, /成员／声优个人账号/);
  assert.match(PREFILTER_SYSTEM, /个人 CD／单曲／专辑／MV/);
  assert.match(PREFILTER_SYSTEM, /其他游戏（如 Vanguard、Assault Lily）/);
  assert.match(PREFILTER_SYSTEM, /无关电台、电视或综艺节目/);
  assert.match(PREFILTER_SYSTEM, /若来源并非成员个人账号/);
  assert.match(PREFILTER_SYSTEM, /只输出 JSON/);
});

