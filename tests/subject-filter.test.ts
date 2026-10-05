// 只看关注：地址里的 ?subjects=… 只认真实存在、有页面的乐队/企划，企划展开成整个系列，
// 而且这一页的游标只属于这一份关注列表 —— 别人换个筛选不能拿它接着翻。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { seriesOf } from "@girlsbands/industry/taxonomy";
import { FOLLOWABLE_ENTITY_IDS, isFollowableEntity, parseSubjectIds, SUBJECT_LIMIT } from "@girlsbands/contracts/taxonomy";
import { closeDb, sql } from "@girlsbands/backend/db";
import { subjectKey } from "@girlsbands/backend/publication/items";
import { loadPool } from "@girlsbands/backend/publication/pool";
import { loadTimeline } from "@girlsbands/backend/publication/timeline";
import { buildApp } from "../apps/api/src/app.ts";

process.env.FEISHU_INTERNAL_ENABLED = "false";
after(closeDb);

test("only real entities can be followed, however the address spells them", () => {
  assert.equal(isFollowableEntity("mygo"), true);
  // `in` would let the prototype through here, and the query would then filter on nothing at all.
  assert.equal(isFollowableEntity("constructor"), false);
  assert.equal(isFollowableEntity("__proto__"), false);
  assert.equal(isFollowableEntity("toString"), false);
  assert.equal(isFollowableEntity("MyGO"), false, "id 是 id，不是标签");
  assert.deepEqual(parseSubjectIds("mygo, roselia,mygo,,nope"), ["mygo", "roselia"]);
  assert.deepEqual(parseSubjectIds(""), []);
  assert.deepEqual(parseSubjectIds(null), []);
  assert.deepEqual(parseSubjectIds(undefined), []);
  assert.equal(parseSubjectIds(FOLLOWABLE_ENTITY_IDS.join(",")).length, Math.min(FOLLOWABLE_ENTITY_IDS.length, SUBJECT_LIMIT));
  // 同一个关注列表只有一种写法：缓存键与游标绑定都靠它。
  assert.equal(subjectKey(["roselia", "mygo"]), subjectKey(["mygo", "roselia"]));
  assert.equal(subjectKey(["mygo", "mygo"]), "mygo");
  assert.equal(subjectKey([]), "");
  assert.equal(subjectKey(undefined), "");
});

const NOW = new Date("2024-05-20T00:00:00Z");

/** 三条动态：两支各自独立的乐队，加一支属于企划系列里的乐队。 */
async function seed() {
  const T = tag();
  const source = `subjects-${T}`;
  await sql`INSERT INTO sources(id,name,kind,tier) VALUES(${source},'Subjects','rss','T1')`;
  const add = async (name: string, entity: string, minutesAgo: number) => {
    const id = `${T}-${name}`;
    const at = new Date(NOW.getTime() - minutesAgo * 60_000);
    await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at)
      VALUES(${id},${source},${id},'https://example.test/subjects',${id},${at},${at})`;
    await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,eligible,selected,visible_after,visibility,tags)
      VALUES(${id},${id},${source},'news','https://example.test/subjects',${at},${at},${at},true,true,${at},'public',${[T, `entity:${entity}`]})`;
    return id;
  };
  return { T, mine: await add("mine", "mygo", 30), other: await add("other", "roselia", 60), series: await add("series", "togenashi-togeari", 90) };
}

const sorted = (ids: string[]) => [...ids].sort();

test("只看关注 passes only the followed subjects, and a project carries its whole series", async () => {
  const { T, mine, other, series } = await seed();
  const follow = (subjects: string[]) => loadTimeline({ channel: "all", category: null, tag: T, subjects, now: NOW, limit: 40 });
  const ids = (page: Awaited<ReturnType<typeof loadTimeline>>) => page.cards.map((card) => card.item.id);

  assert.deepEqual(sorted(ids(await follow([]))), sorted([mine, other, series]), "空关注＝不过滤");
  assert.deepEqual(ids(await follow(["mygo"])), [mine]);
  assert.deepEqual(sorted(ids(await follow(["mygo", "roselia"]))), sorted([mine, other]), "多选是并集");
  // 关注企划＝关注整个系列：トゲナシトゲアリ 是 ガールズバンドクライ 的一员。
  assert.equal(seriesOf("girls-band-cry").includes("togenashi-togeari"), true);
  assert.deepEqual(ids(await follow(["girls-band-cry"])), [series]);
  assert.deepEqual((await follow(["mygo"])).filters.subjects, ["mygo"], "响应回显这一页的筛选");
});

test("只看关注 filters the pool by the same rule", async () => {
  const { T, mine, other, series } = await seed();
  const pool = (subjects: string[]) => loadPool({ channel: "all", category: null, tag: T, subjects, now: NOW, page: 1 });

  assert.deepEqual(sorted((await pool([])).items.map((item) => item.id)), sorted([mine, other, series]));
  assert.deepEqual((await pool(["mygo"])).items.map((item) => item.id), [mine]);
  assert.equal((await pool(["mygo"])).total, 1, "页数也按关注后的总数算");
  assert.deepEqual((await pool(["girls-band-cry"])).items.map((item) => item.id), [series]);
  assert.deepEqual((await pool(["mygo"])).filters.subjects, ["mygo"]);
});

test("a page-two address belongs to one follow list only", async () => {
  const { T, mine, other } = await seed();
  const page = (subjects: string[], cursor?: string | null) =>
    loadTimeline({ channel: "all", category: null, tag: T, subjects, cursor, now: NOW, limit: 1 });

  const first = await page(["mygo", "roselia"]);
  assert.deepEqual(first.cards.map((card) => card.item.id), [mine]);
  assert.ok(first.nextCursor);
  // 勾选顺序不同但结果相同：同一个地址，游标照样能用。
  const same = await page(["roselia", "mygo"], first.nextCursor);
  assert.deepEqual(same.cards.map((card) => card.item.id), [other]);
  // 换一份关注列表（或去掉筛选）就是另一条流，旧游标不能接着翻。
  await assert.rejects(() => page(["mygo"], first.nextCursor), /cursor does not match this query/);
  await assert.rejects(() => page([], first.nextCursor), /cursor does not match this query/);
});

test("the site API takes the follow list from the address and drops everything else", async () => {
  const { T, mine, other } = await seed();
  const app = await buildApp();
  try {
    const get = (url: string) => app.inject({ method: "GET", url });

    const plain = await get(`/api/site/timeline?tag=${T}`);
    assert.equal(plain.statusCode, 200, plain.body);
    assert.deepEqual(plain.json().filters.subjects, []);

    // 未知 id、原型链上的名字、空白与重复都在地址上被丢掉，剩下的照常筛。
    const followed = await get(`/api/site/timeline?tag=${T}&subjects=mygo,constructor,%20roselia%20,mygo,nope`);
    assert.equal(followed.statusCode, 200, followed.body);
    assert.deepEqual(followed.json().filters.subjects, ["mygo", "roselia"]);
    assert.deepEqual(sorted(followed.json().cards.map((card: { item: { id: string } }) => card.item.id)), sorted([mine, other]));

    const pool = await get(`/api/site/pool?tag=${T}&subjects=mygo`);
    assert.equal(pool.statusCode, 200, pool.body);
    assert.deepEqual(pool.json().items.map((item: { id: string }) => item.id), [mine]);
    assert.deepEqual(pool.json().filters.subjects, ["mygo"]);
  } finally {
    await app.close();
  }
});
