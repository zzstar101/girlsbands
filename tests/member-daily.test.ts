import assert from "node:assert/strict";
import { test } from "node:test";
import { isMemberAccount, normalizeAnalysis, type AnalysisRun } from "@girlsbands/backend/editorial/analyze";
import { PREFILTER_SYSTEM } from "@girlsbands/backend/editorial/writing";
import { isPoolEligible } from "@girlsbands/backend/publication/rules";
import { CATEGORY_GUIDE } from "@girlsbands/backend/editorial/vocabulary";
import { LANE_CATEGORIES } from "@girlsbands/industry/taxonomy";

const prefilter = (label: AnalysisRun["prefilter"]["label"]): AnalysisRun["prefilter"] => ({ label, reason: "", model: "m", receiptId: 1, reused: false });
const writing: AnalysisRun["writing"] = { kind: "summarize", model: "m", titleZh: "今天吃了拉面", summaryZh: "成员分享了午饭。", reasonZh: null, receiptIds: [2], reused: false };

test("a member's daily post is its own lane: never pool eligible, filed under the member's band", () => {
  const out = normalizeAnalysis({ prefilter: prefilter("DAILY"), scores: null, writing, structure: null, live: null, release: null, daily: { owner: "mygo" } });
  assert.equal(out.relevance, "daily");
  assert.equal(out.category, "daily");
  assert.equal(out.selected, false);
  assert.deepEqual(out.subjects, ["mygo"]);
  assert.equal(isPoolEligible({ participationMode: "editorial", relevance: out.relevance, title: out.titleZh, summary: out.summaryZh }), false);
});

test("a daily post without Chinese copy is unknown, like any other", () => {
  const out = normalizeAnalysis({ prefilter: prefilter("DAILY"), scores: null, writing: { ...writing!, titleZh: "" }, structure: null, live: null, release: null, daily: { owner: "mygo" } });
  assert.equal(out.relevance, "unknown");
});

test("only a member's own account can be daily", () => {
  const source = { name: "x", kind: "rss", tier: "T1_5", firstParty: false };
  assert.equal(isMemberAccount({ source: { ...source, tags: ["官方", "成员"], ownerEntityId: "mygo" } } as never), true);
  assert.equal(isMemberAccount({ source: { ...source, tags: ["官方"], ownerEntityId: "mygo" } } as never), false);
  assert.equal(isMemberAccount({ source: { ...source, tags: ["成员"], ownerEntityId: null } } as never), false);
});

test("the structure step never sees the daily lane; the prefilter offers DAILY", () => {
  assert.ok(LANE_CATEGORIES.has("daily"));
  assert.doesNotMatch(CATEGORY_GUIDE, /daily/);
  assert.match(PREFILTER_SYSTEM, /PASS\|BLOCK\|UNKNOWN\|DAILY/);
  assert.match(PREFILTER_SYSTEM, /DAILY 只用于成员个人账号/);
});
