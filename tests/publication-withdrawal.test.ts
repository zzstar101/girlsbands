// 下架必须从公开出口当场消失。审计查出两处漏：sitemap 不看一期报告引用的条目还在不在，角色页头部读的是
// 最多 10 分钟的成员索引（列表却已经是当场查的）。tests/architecture.test.ts 只看 import 与表归属，
// 所以这里补行为：摆一篇公开发布的报道，走后台的 setVisibility 下架，再读同一个出口。
// 每个测试文件一份数据库副本、一个进程（见 tests/databases.ts），module 级缓存从冷开始。
// sitemap 的缓存是 5 分钟，所以整个文件只建一次，用「引用的条目还在」的对照一期证明查询本身有效。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { upsertMaterial } from "@girlsbands/backend/content/materials";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { publishArticle } from "@girlsbands/backend/publication/publish";
import { loadMemberPage } from "@girlsbands/backend/publication/members";
import { sitemapXml } from "@girlsbands/backend/publication/sitemap";
import { setVisibility } from "@girlsbands/backend/admin/content";

const T = tag();
const SOURCE = `test-withdrawal-exits-${T}`;
const MEMBER = "nina-iseri";
const WEEK_KEPT = "2099-W01";
const WEEK_GONE = "2099-W02";

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
            VALUES (${SOURCE}, 'Withdrawal exits', 'rss', 'T2', 'editorial', '2100-01-01')`;
});
after(async () => {
  await stopBoss();
  await closeDb();
});

let n = 0;
/** 一篇公开发布的报道。标题点名角色时，发布这一步会写进 member_mentions。 */
async function report(title: string, at: Date): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE,
    url: `https://example.com/withdrawal-exits-${T}-${n}`,
    title,
    bodyText: "本文正文。",
    bodyHtml: "<p>本文正文。</p>",
    bodyStatus: "ok",
    via: "fetch",
    publishedAt: at,
  });
  await sql`UPDATE articles SET discovered_at = ${at}, timeline_at = ${at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', 'live', ${title}, '摘要', 80, true, ${[]}, ${["成员动态"]})`;
  await publishArticle(articleId, { releasedAt: new Date(at.getTime() + 60_000) });
  return articleId;
}

/** 一期只引用给定条目的周报：itemId 完全可控，不必走 compose。 */
async function weekly(key: string, itemIds: string[]): Promise<void> {
  const content = { kind: "weekly", title: `周报 ${key}`, overview: "o", themes: [{ heading: "h", summary: "s", storyRefs: itemIds.map((itemId) => ({ itemId, title: `条目 ${itemId}` })) }] };
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, origin)
            VALUES ('weekly', ${key}, now(), now(), ${sql.json(content as never)}, now(), 'imported')`;
}

const withdraw = (id: string) => setVisibility(id, { visibility: "withdrawn", reason: "权利方要求删除", version: 0 }, "test-withdrawal");

test("角色页头部在下次读取就不含被下架的报道，也不计入计数", async () => {
  const item = await report(`井芹仁菜 的报道 ${T}`, new Date(Date.now() - 600_000));
  // 不传 now：走 10 分钟的成员索引缓存，正是审计里出问题的那条路。这一读把缓存捂热。
  const before = await loadMemberPage(MEMBER, 1);
  assert.ok(before);
  assert.equal(before.member.total, 1);
  assert.equal(before.member.latest?.title, `井芹仁菜 的报道 ${T}`);

  assert.equal((await withdraw(item))?.visibility, "withdrawn");

  // 缓存离过期还远；头部必须当场跟上列表（列表一直是当场查的）。
  const after = await loadMemberPage(MEMBER, 1);
  assert.ok(after);
  assert.equal(after.member.total, 0, "计数不含被下架的报道");
  assert.equal(after.member.latest, null, "头部不再点名被下架的报道");
  assert.deepEqual(after.items, []);
});

test("整期引用的条目都被下架后，这一期从 sitemap 消失", async () => {
  // 对照：引用的条目还在的一期照常提交，证明这份 sitemap 确实收报告 URL，不是整段丢了。
  const kept = await report(`对照报道 ${T}`, new Date(Date.now() - 7_200_000));
  await weekly(WEEK_KEPT, [kept]);

  const gone = await report(`被下架的报道 ${T}`, new Date(Date.now() - 3_600_000));
  await weekly(WEEK_GONE, [gone]);
  assert.equal((await withdraw(gone))?.visibility, "withdrawn");

  const xml = await sitemapXml(); // 5 分钟缓存，整个文件只建这一次
  assert.ok(xml.includes(`/weekly/${WEEK_KEPT}</loc>`), "还有可读引用的一期照常提交");
  assert.ok(!xml.includes(`/weekly/${WEEK_GONE}</loc>`), "整期引用的条目都被下架，这一期不该再提交");
});
