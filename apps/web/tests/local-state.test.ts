import assert from "node:assert/strict";
import { after, test } from "node:test";
import { beijingDate, beijingTime } from "@girlsbands/contracts/time";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

let instance = 0;
async function reader(starred: unknown[] = [], follows: unknown[] | null = null) {
  const values = new Map([["girlsbands-starred-items", JSON.stringify(starred)]]);
  if (follows) values.set("girlsbands-follows", JSON.stringify(follows));
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } },
  });
  // Reopening the page starts with an empty snapshot cache.
  const state: typeof import("../app/lib/local-state.ts") = await import(`../app/lib/local-state.ts?test=${instance++}`);
  return { state, values };
}

const displayDate = (value: string) => `${beijingDate(value)} ${beijingTime(value)}`;

test("import keeps bookmarks with invalid dates and persists displayable replacements", async () => {
  const invalid = ["broken", "", "999999-01-01", "+275760-09-13T00:00:00.000Z", null, 42, {}];
  const { state, values } = await reader();
  const before = Date.now();
  const report = state.importBundle(JSON.stringify({ version: 1, starred: invalid.map((date, i) => ({
    id: `import-${i}`, title: `Bookmark ${i}`, savedAt: date, publishedAt: date,
  })) }));
  assert.equal(report.starredAdded, invalid.length);
  const saved = JSON.parse(values.get(state.KEYS.starred)!);
  assert.equal(saved.length, invalid.length);
  for (const item of saved) {
    assert.equal(item.publishedAt, null);
    assert.ok(Date.parse(item.savedAt) >= before && Date.parse(item.savedAt) <= Date.now());
    assert.doesNotThrow(() => displayDate(item.savedAt));
  }
});

test("stored bookmarks with damaged dates remain readable, exportable and removable", async () => {
  const { state } = await reader([{ id: "stored", title: "Keep me", savedAt: "broken", publishedAt: "broken" }]);
  const starred = state.getStarred();
  assert.equal(starred.length, 1);
  assert.equal(starred[0]!.title, "Keep me");
  assert.equal(starred[0]!.publishedAt, null);
  assert.doesNotThrow(() => displayDate(starred[0]!.savedAt));
  assert.strictEqual(state.getStarred(), starred, "React snapshots must stay stable between changes");
  assert.deepEqual(state.exportBundle().starred, starred);
  state.removeStar("stored");
  assert.deepEqual(state.getStarred(), []);
});

test("valid dates are preserved and an import cannot replace an existing bookmark", async () => {
  const existing = { id: "valid", title: "Original", savedAt: "2026-09-29T08:30:00+08:00", publishedAt: "2026-09-28T23:00:00Z" };
  const { state } = await reader([existing]);
  const report = state.importBundle(JSON.stringify({ version: 1, starred: [{ ...existing, title: "Replacement", savedAt: "broken" }] }));
  assert.equal(report.starredAdded, 0);
  const [saved] = state.getStarred();
  assert.equal(saved!.title, existing.title);
  assert.equal(saved!.savedAt, existing.savedAt);
  assert.equal(saved!.publishedAt, existing.publishedAt);
});

// Failure cases before changing storage: another tab's writes must survive a cached-tab edit;
// unreadable bookmarks must not be overwritten and failed writes must not report success.
test("a cached tab merges newer saved bookmarks and read marks before writing", async () => {
  const { state, values } = await reader([{ id: "old", title: "Old" }]);
  state.getStarred();
  state.getReadIds();
  values.set(state.KEYS.starred, JSON.stringify([{ id: "other-tab", title: "Other tab" }, { id: "old", title: "Old" }]));
  values.set(state.KEYS.read, JSON.stringify(["other-tab"]));
  state.toggleStar({ id: "new", title: "New", summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false });
  state.markRead("new");
  assert.deepEqual(state.getStarred().map((s) => s.id), ["new", "other-tab", "old"]);
  assert.deepEqual(state.getReadIds(), ["new", "other-tab"]);
});

test("failed bookmark writes and damaged existing data do not report a successful toggle", async () => {
  const { state, values } = await reader();
  const item = { id: "new", title: "New", summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false };
  values.set(state.KEYS.starred, "damaged original data");
  assert.equal(state.toggleStar(item), false);
  assert.equal(values.get(state.KEYS.starred), "damaged original data");
  window.localStorage.setItem = () => { throw new Error("quota"); };
  assert.equal(state.toggleStar(item), false);
});

// Follows are the second thing this browser keeps, and the only one an address carries: a list that is
// unknown, damaged or too long must never reach the query.
test("following a band is local, reversible and limited to real entities", async () => {
  const { state, values } = await reader();
  assert.deepEqual(state.getFollows(), []);
  assert.equal(state.toggleFollow("mygo"), true);
  assert.equal(state.toggleFollow("roselia"), true);
  assert.equal(state.toggleFollow("mygo"), false, "再点一次是取消关注");
  assert.deepEqual(state.getFollows(), ["roselia"]);
  assert.deepEqual(JSON.parse(values.get(state.KEYS.follows)!), ["roselia"]);
  // 没有页面的名字（拼错的、原型链上的）不进列表，也不会被写进存储。
  for (const bad of ["nope", "constructor", "__proto__", "MyGO", ""]) assert.equal(state.toggleFollow(bad), false, bad);
  assert.deepEqual(state.getFollows(), ["roselia"]);
});

test("a damaged follow list is repaired to the entities it still names", async () => {
  const { state } = await reader([], ["mygo", "constructor", 42, "roselia", "mygo", null]);
  assert.deepEqual(state.getFollows(), ["mygo", "roselia"]);
  assert.strictEqual(state.getFollows(), state.getFollows(), "React snapshots stay stable between changes");
});

test("an unreadable follow list is rebuilt rather than refused", async () => {
  const { state, values } = await reader();
  values.set(state.KEYS.follows, "damaged original data");
  assert.deepEqual(state.getFollows(), []);
  assert.equal(state.toggleFollow("mygo"), true);
  assert.deepEqual(JSON.parse(values.get(state.KEYS.follows)!), ["mygo"]);
});

test("a follow write that fails does not report success", async () => {
  const { state } = await reader();
  window.localStorage.setItem = () => { throw new Error("quota"); };
  assert.equal(state.toggleFollow("mygo"), false);
});

test("export and import carry the follow list, the reader's own order first", async () => {
  const { state } = await reader([], ["mygo"]);
  assert.deepEqual(state.exportBundle().follows, ["mygo"]);
  const report = state.importBundle(JSON.stringify({ version: 1, follows: ["roselia", "mygo", "nope", 42, "roselia"] }));
  assert.equal(report.followsAdded, 1);
  assert.equal(report.followsSkipped, 2, "不认识的名字；重复的和已经在列表里的不算新增");
  assert.equal(report.followsFailed, false);
  assert.deepEqual(state.getFollows(), ["mygo", "roselia"]);
  // 老包没有 follows 字段，照样导入。
  const older = await reader();
  assert.equal(older.state.importBundle(JSON.stringify({ version: 1, starred: [] })).followsAdded, 0);
  assert.deepEqual(older.state.getFollows(), []);
});
