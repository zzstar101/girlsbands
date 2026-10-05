// W18: a reader can point at the content that is wrong, from five pages, through the one feedback form
// that already exists. Two properties are worth a test of their own: a correction that says what is
// wrong but not which content it is about is refused instead of stored half, and nothing on the
// collection side ever learns what a reader sent — a submitted address is a lead for a human to look at,
// never something the site fetches (docs/refit-plan.md, W18).
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { listFeedbackTargets } from "@girlsbands/backend/admin/feedback";
import { config } from "@girlsbands/backend/config";
import { closeDb, sql } from "@girlsbands/backend/db";
import { submitFeedback } from "@girlsbands/backend/operations/feedback";

const T = tag();
config.dataDir = mkdtempSync(path.join(tmpdir(), "girlsbands-feedback-targets-"));

after(closeDb);

// Each submission comes from its own "network address and browser family", so the rate limit sees them
// as different readers and the aggregate's source count means something.
let seq = 0;
function send(extra: Partial<Parameters<typeof submitFeedback>[0]> = {}) {
  seq += 1;
  return submitFeedback({ content: `纠错 ${T} #${seq}`, ip: `203.0.113.${seq}`, userAgent: `ua-${T}`, ...extra });
}

const refused = (status: number, message: string) => (e: unknown) => {
  assert.equal((e as { status?: number }).status, status, String(e));
  assert.equal((e as { code?: string }).code, "invalid_request");
  assert.equal((e as Error).message, message);
  return true;
};

test("纠错记下指的是哪一条内容，过长的字段截断", async () => {
  const { id } = await send({ targetKind: "article", targetId: "x".repeat(240), targetField: "title", expected: "应该是「少女乐队」" });
  const [row] = await sql<{ target_kind: string | null; target_id: string | null; target_field: string | null; expected: string | null }[]>`
    SELECT target_kind, target_id, target_field, expected FROM feedback WHERE id = ${id}`;
  assert.equal(row!.target_kind, "article");
  assert.equal(row!.target_id!.length, 200, "站内 id 不会长到 200，截断只是不让读者把这一列当正文用");
  assert.equal(row!.target_field, "title");
  assert.equal(row!.expected, "应该是「少女乐队」");
});

test("普通反馈与投稿都不带目标：投稿只记 target_kind = source", async () => {
  const plain = await send();
  const submit = await send({ targetKind: "source" });
  const rows = await sql<{ id: number; target_kind: string | null; target_id: string | null; target_field: string | null; expected: string | null }[]>`
    SELECT id, target_kind, target_id, target_field, expected FROM feedback WHERE id IN (${plain.id}, ${submit.id})`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.deepEqual(
    [byId.get(plain.id)!.target_kind, byId.get(plain.id)!.target_id, byId.get(plain.id)!.target_field, byId.get(plain.id)!.expected],
    [null, null, null, null],
  );
  assert.equal(byId.get(submit.id)!.target_kind, "source");
});

test("说了哪里错却没说哪一条内容，拒绝而不是存半条", async () => {
  await assert.rejects(send({ targetField: "title" }), refused(400, "请说明这条纠错是针对哪一条内容。"));
  await assert.rejects(send({ targetId: "42" }), refused(400, "请说明这条纠错是针对哪一条内容。"));
  await assert.rejects(send({ expected: "应该是 2026-11-01" }), refused(400, "请说明这条纠错是针对哪一条内容。"));
  await assert.rejects(send({ targetKind: "band", targetId: "42" }), refused(400, "纠错目标不正确。"));
  await assert.rejects(send({ targetKind: "live", targetField: "setlist" }), refused(400, "纠错类型不正确。"));
});

test("后台按目标聚合：同一对象的纠错并成一组，投稿单独列", async () => {
  const targetId = `live-${T}`;
  const a = await send({ targetKind: "live", targetId, targetField: "date", expected: "2026-11-02" });
  const b = await send({ targetKind: "live", targetId, targetField: "venue", expected: "Zepp DiverCity" });
  const submit = await send({ targetKind: "source", content: `投稿 ${T} https://example.com/band` });
  const data = await listFeedbackTargets();

  const group = data.groups.find((g) => g.target_kind === "live" && g.target_id === targetId);
  assert.ok(group, "同一场演出的两条纠错要并成一组");
  assert.equal(group.sources, 2, "两个来源算两个来源");
  assert.equal(group.n, 2);
  assert.deepEqual(group.rows.map((r) => r.id).sort((x, y) => x - y), [a.id, b.id].sort((x, y) => x - y));
  assert.ok(group.rows.every((r) => r.content.startsWith("纠错")), "组里的每一行都要是完整的一行反馈，后台才能改状态");

  assert.ok(data.groups.every((g) => g.target_kind !== "source"), "投稿不聚合");
  assert.ok(data.submissions.some((r) => r.id === submit.id), "投稿要出现在投稿那一列");
  assert.ok(!data.submissions.some((r) => r.id === a.id || r.id === b.id));
  for (let i = 1; i < data.groups.length; i += 1) {
    assert.ok(data.groups[i - 1]!.sources >= data.groups[i]!.sources, "按不同来源数从多到少排");
  }
});

// The collection side reads its own configuration (industry/sources.json) and nothing else. Reader
// feedback is the one thing a stranger can put text into, so the check is on the whole path: neither the
// collector modules nor the feedback write path may mention a target identifier or import a fetcher.
const ROOT = path.resolve(import.meta.dirname, "..");
function sources(dir: string): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true, recursive: true })) {
    const full = path.join(entry.parentPath, entry.name);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /[/\\](node_modules|build|\.react-router)[/\\]/.test(full)) continue;
    out.push({ file: path.relative(ROOT, full), text: readFileSync(full, "utf8") });
  }
  return out;
}
const imports = (text: string) => [...text.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);

test("读者提交的地址不会被自动抓取：采集侧与反馈写入路径都不认识纠错目标", () => {
  const target = /target_kind|targetKind|target_id|targetId|target_field|targetField/;
  const collectors = sources("packages/backend/src/sources").filter((f) => target.test(f.text)).map((f) => f.file);
  assert.deepEqual(collectors, [], "采集侧读到了纠错目标标识；读者给的东西只属于 feedback 表");

  const fetcher = /sources\/|providers\/|extractFromUrl|collectSource|collect\.ts/;
  for (const file of ["packages/backend/src/operations/feedback.ts", "apps/api/src/routes/feedback.ts"]) {
    const found = sources(path.dirname(file)).find((f) => f.file === file);
    assert.ok(found, `${file} 不存在了，这条规则要跟着改`);
    assert.deepEqual(imports(found.text).filter((s) => fetcher.test(s)), [], `${file} 引入了抓取路径`);
  }
});
