import assert from "node:assert/strict";
import { test } from "node:test";
import { isSoon } from "@girlsbands/backend/publication/deadlines";
import { REMINDED_KINDS } from "@girlsbands/backend/subscriptions/content";

const HOUR = 3_600_000;

test("「48 小时内」只算还没到的时刻", () => {
  assert.equal(isSoon(-HOUR), false);
  assert.equal(isSoon(0), false);
  assert.equal(isSoon(HOUR), true);
  assert.equal(isSoon(48 * HOUR), true);
  assert.equal(isSoon(49 * HOUR), false);
});

test("提醒信只说票和货，不提醒开播与演出当天", () => {
  for (const kind of ["lottery_end", "sale_start", "payment_deadline", "release_start", "merch_start"]) assert.ok(REMINDED_KINDS.has(kind), kind);
  for (const kind of ["event", "stream_end", "other"]) assert.ok(!REMINDED_KINDS.has(kind), kind);
});
