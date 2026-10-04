// A daily's front-page picture comes from the item its lead is about: the editors' lead matched to an
// item by title, never simply the first highlight.
import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReportCitation } from "@girlsbands/contracts/site";
import { leadItemOf } from "@girlsbands/backend/publication/reports";

const cite = (itemId: string, title: string, available = true) => ({ itemId, title, available }) as ReportCitation;
const chart = cite("a", "結束バンド「ギターと孤独と蒼い惑星」が ORICON 週間シングルランキングで 1 位");
const live = cite("b", "トゲナシトゲアリ 8th ONE-MAN LIVE『凛音の理』開催決定、FC 先行受付開始");

test("an editors' lead is matched to the item it is written about", () => {
  assert.equal(leadItemOf("トゲナシトゲアリ 8th ONE-MAN LIVE『凛音の理』開催決定", [chart, live], [chart, live])?.itemId, "b");
});

test("a lead that matches no item clearly has no item", () => {
  assert.equal(leadItemOf("本周音乐市场综述：多组艺人宣布新专辑与巡演", [chart], [chart, live]), undefined);
});

test("without an editors' lead the first highlight leads", () => {
  assert.equal(leadItemOf(undefined, [chart], [live, chart])?.itemId, "a");
});

test("a withdrawn highlight never leads the front page", () => {
  const withdrawn = cite("w", "已下架", false);
  assert.equal(leadItemOf(undefined, [withdrawn, chart], [withdrawn, chart, live])?.itemId, "a");
});
