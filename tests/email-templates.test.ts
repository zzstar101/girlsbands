// 邮件模板的检查。每套风格 × 三种邮件都渲染一遍，逐条量标尺、对齐、收发约束和转义。
// 规则本体在 tests/email-rules.ts，写新风格时可以对单独一套跑（见那里的用法注释）。
import "./setup.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { EMAIL_STYLES } from "@girlsbands/industry/email/registry";
import { dateHandle, dateStamp, titleHandle } from "@girlsbands/industry/email/title";
import { checkStyle } from "./email-rules.ts";

const STYLES = Object.values(EMAIL_STYLES);

test("每一套邮件模板都通过排版与收发检查", () => {
  assert.ok(STYLES.length > 0, "registry 里一套风格都没有");
  const problems: string[] = [];
  for (const style of STYLES) problems.push(...checkStyle(style));
  assert.deepEqual(problems.slice(0, 40), [], `模板检查未通过（共 ${problems.length} 处）`);
});

test("标题牌与日期牌：尺寸、地址、替代文字都对得上", () => {
  const site = "https://girlsbands.example";
  assert.deepEqual(titleHandle("deadline", site), {
    src: "https://girlsbands.example/og/email/title/deadline.png",
    alt: "截止提醒",
    width: 552,
    height: 109,
  });
  // alt 是图片被屏蔽时唯一读得到的东西，所以必须是「哪一天」而不是文件名。
  for (const kind of ["deadline", "digest", "confirm"] as const) assert.notEqual(titleHandle(kind, site).alt, kind);
  assert.deepEqual(dateHandle("2026-10-04", site), {
    src: "https://girlsbands.example/og/email/date/10-04.png",
    alt: "10/04",
    width: 64,
    height: 80,
  });
  // 前导零保留：alt 与文件名同形，读者看到的就是牌子上那个日期。
  assert.equal(dateHandle("2026-01-05", site)?.alt, "01/05");
  assert.equal(dateStamp("2026-10-04T23:59"), "10-04", "带时刻的截到日期为止");
  // 脏日期一律 null：宁可少一张日期牌，也不能让整封信崩掉或者印出一个错的日期。
  for (const bad of ["", "2026-13-01", "2026-10-32", "10/04", "2026-1-4", "x"]) assert.equal(dateHandle(bad, site), null, `${bad} 不该有日期牌`);
});

