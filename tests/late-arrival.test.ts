// 晚到的帖子：时间线按原发帖时间排；抓到时截止已过的通知不进精选；写稿按发帖日期把「今日 / 明日」换成月日。
import { test } from "bun:test";
import assert from "node:assert/strict";
import { decideTimeline, FUTURE_TOLERANCE_MS } from "@girlsbands/backend/content/materials";
import { expiredOnArrival } from "@girlsbands/backend/publication/rules";
import { buildShortTweetPrompt, postedDayLabel } from "@girlsbands/backend/editorial/writing";

const H = 3600_000;

test("晚到一天的帖子在时间线上排在它自己发出的时间，不混进今天", () => {
  const posted = new Date("2026-10-05T03:00:00Z");
  const found = new Date("2026-10-06T20:00:00Z"); // 41 小时后才抓到（镜像补抓）
  const t = decideTimeline(posted, found);
  assert.equal(t.backfill, false, "48 小时内仍是新内容，照常分析和精选");
  assert.equal(t.timelineAt.toISOString(), posted.toISOString());

  const stale = decideTimeline(new Date(found.getTime() - 72 * H), found);
  assert.equal(stale.backfill, true);
  assert.equal(stale.timelineAt.getTime(), found.getTime() - 72 * H);

  // 来源时间略超前（容差内）：不排到「现在」之上
  const ahead = decideTimeline(new Date(found.getTime() + FUTURE_TOLERANCE_MS / 2), found);
  assert.equal(ahead.timelineAt.getTime(), found.getTime());
  // 没有来源时间：只能按抓到的时间
  assert.equal(decideTimeline(null, found).timelineAt.getTime(), found.getTime());
});

test("发帖时还没截止、抓到时已经截止的通知，算晚到", () => {
  const posted = new Date("2026-10-05T01:00:00Z"); // 10/5 10:00 JST
  const late = new Date("2026-10-06T20:00:00Z"); // 10/7 05:00 JST
  const onTime = new Date("2026-10-05T01:30:00Z");
  const todayClose = [{ kind: "sale_end", at: "2026-10-05T23:59" }];
  assert.equal(expiredOnArrival(todayClose, posted, late, "Asia/Tokyo"), true, "「今日 23:59 截止」两天后才抓到");
  assert.equal(expiredOnArrival(todayClose, posted, onTime, "Asia/Tokyo"), false, "按时抓到的照常");
  // 只有日期没有时刻：那天结束才算截止
  assert.equal(expiredOnArrival([{ kind: "lottery_end", at: "2026-10-06" }], posted, new Date("2026-10-06T10:00:00Z"), "Asia/Tokyo"), false);
  assert.equal(expiredOnArrival([{ kind: "lottery_end", at: "2026-10-06" }], posted, late, "Asia/Tokyo"), true);
  // 帖子里还有一个将来的日子（演出、下一轮受理）：仍是有用的消息
  assert.equal(expiredOnArrival([...todayClose, { kind: "event", at: "2026-11-03T18:00" }], posted, late, "Asia/Tokyo"), false);
  // 发帖时就已经过了的截止（「受付終了」通知）不是这个情况
  assert.equal(expiredOnArrival([{ kind: "sale_end", at: "2026-10-04T23:59" }], posted, late, "Asia/Tokyo"), false);
  // 抽取把截止记成了别的类型（受注截止记成 merch_start），备注里写着截止也算
  assert.equal(expiredOnArrival([{ kind: "merch_start", at: "2026-10-05T23:59", note: "周边受注截止" }, { kind: "event", at: "2026-09-27", note: "东京FINAL公演" }], posted, late, "Asia/Tokyo"), true);
  assert.equal(expiredOnArrival([{ kind: "event", at: "2026-10-05T18:00", note: "公演当日券截止" }], posted, late, "Asia/Tokyo"), false, "演出日不算截止");
  // 开始类日期过了不算截止
  assert.equal(expiredOnArrival([{ kind: "sale_start", at: "2026-10-05T12:00" }], posted, late, "Asia/Tokyo"), false);
  assert.equal(expiredOnArrival([], posted, late, "Asia/Tokyo"), false);
  // 没有原文发布时间（国内排期列表、活动接口）：抓到时点名的日期都过了，同样是晚到。
  // 2025 年 3 月的快闪挂在会员购列表里，2026 年 10 月才被抓到，仍按「已结束」处理，不进精选。
  assert.equal(expiredOnArrival([{ kind: "sale_end", at: "2025-04-19" }], null, late, "Asia/Tokyo"), true, "列表里的旧活动抓到即已结束");
  assert.equal(expiredOnArrival(todayClose, null, late, "Asia/Tokyo"), true);
  assert.equal(expiredOnArrival([...todayClose, { kind: "event", at: "2026-11-03T18:00" }], null, late, "Asia/Tokyo"), false, "还有将来的日期就仍是有用的消息");
  assert.equal(expiredOnArrival([{ kind: "sale_start", at: "2026-10-04T12:00" }], null, late, "Asia/Tokyo"), false, "开始类日期过了不算截止");
  assert.equal(expiredOnArrival([{ kind: "event", at: "2026-10-05T18:00" }], null, late, "Asia/Tokyo"), false, "演出日不算截止");
});

test("发帖日期按来源当地的日子算，并告诉写稿的模型", () => {
  // 10/4 15:30 UTC = 10/5 00:30 日本时间：日本那边已经是 10/5
  assert.equal(postedDayLabel(new Date("2026-10-04T15:30:00Z"), "Asia/Tokyo"), "2026-10-05（周一，日本时间）");
  assert.equal(postedDayLabel(new Date("2026-10-04T15:30:00Z"), "Asia/Shanghai"), "2026-10-04（周日，北京时间）");
  assert.equal(postedDayLabel(undefined), "未注明");
  const prompt = buildShortTweetPrompt({ title: "本日23:59まで！", text: "本日23:59まで！", mainText: "本日23:59まで！", sourceKind: "x_search", publishedAt: new Date("2026-10-04T15:30:00Z"), timezone: "Asia/Tokyo" });
  assert.match(prompt, /发帖日期：2026-10-05（周一，日本时间）/);
  assert.match(prompt, /不写“今日 \/ 今天 \/ 明日/);
});
