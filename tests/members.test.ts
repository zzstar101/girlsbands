// 角色页与成员投影（W13）：88 个页面、成员词表、member_mentions 投影与出口。
// Written from the ways it can go wrong:
// - 两份数据漂移：有人往 TSV 加了一行，却没人给 members.ts 补页（或反过来，页面找不到词表里的写法）；
// - 页面数与 TSV 对不上（182 行 = 88 角色 + 88 声优 + 6 个别名），或者别名自己多出一页；
// - 匹配太松：拉丁写法在别的词里命中（Rina 在 Marina 里），或者太短的写法（usable 之外）参与匹配；
// - 匹配太窄：只有假名、只有罗马字、只有别名（Oblivionis）提到时读不出来；
// - 投影不跟着收录走：撤收录后角色页还留着那篇报道，或者重复发布留下重复行；
// - 读取层串页：页码越界返回一页空数据而不是 404，分类计数只算当页，未知 id 拿到页面；
// - 出口：sitemap 收了不够 5 篇的页面，或者分享图对未知 id 出图。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { upsertMaterial } from "@girlsbands/backend/content/materials";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { publishArticle } from "@girlsbands/backend/publication/publish";
import { deriveMemberMentions, mentionedMembers } from "@girlsbands/backend/publication/member-mentions";
import { MEMBER_PAGE_SIZE, listMembers, loadMemberPage, memberLinks, memberSitemapEntries } from "@girlsbands/backend/publication/members";
import { sitemapXml } from "@girlsbands/backend/publication/sitemap";
import { MEMBERS } from "@girlsbands/industry/glossary-members";
import { MEMBER_ENTITIES, memberById } from "@girlsbands/industry/members";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const MEDIA = `test-members-media-${T}`;
const ISOLATED = `test-members-isolated-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${MEDIA}, 'Members media', 'rss', 'T2', 'editorial', false, '2100-01-01'),
    (${ISOLATED}, 'Members isolated', 'rss', 'T2', 'isolated', false, '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
/** 一篇公开发布的报道：标题/摘要与正文里可以点名，发布时算成员提及。 */
async function report(input: { title: string; summary?: string; body?: string; category?: string; source?: string; at?: Date }): Promise<string> {
  n += 1;
  const at = input.at ?? new Date(Date.now() - n * 3_600_000);
  const { articleId } = await upsertMaterial({
    sourceId: input.source ?? MEDIA,
    url: `https://example.com/members-${T}-${n}`,
    title: input.title,
    bodyText: input.body ?? "本文正文。",
    bodyHtml: `<p>${input.body ?? "本文正文。"}</p>`,
    bodyStatus: "ok",
    via: "fetch",
    publishedAt: at,
  });
  await sql`UPDATE articles SET discovered_at = ${at}, timeline_at = ${at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${input.category ?? "member"}, ${input.title}, ${input.summary ?? `摘要 ${n}`}, 80, true, ${[]}, ${["成员动态"]})`;
  await publishArticle(articleId, { releasedAt: new Date(at.getTime() + 60_000) });
  return articleId;
}

/** 直接摆一篇已发布的报道与它的成员行：分页、下架这类读取层的事不必走一遍发布。 */
async function seed(id: string, memberId: string, at: Date, category = "live"): Promise<void> {
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
            VALUES (${id}, ${MEDIA}, ${id}, ${`https://example.com/${id}`}, ${id}, ${at}, ${at})`;
  await sql`INSERT INTO publications (article_id, title, source_id, channel, url, discovered_at, timeline_at, sort_at, eligible, selected, visible_after, visibility, tags, category)
            VALUES (${id}, ${id}, ${MEDIA}, 'news', ${`https://example.com/${id}`}, ${at}, ${at}, ${at}, true, true, ${at}, 'public', ${[T]}, ${category})`;
  await sql`INSERT INTO member_mentions (member_id, article_id) VALUES (${memberId}, ${id})`;
}

const mentionsOf = async (articleId: string) =>
  (await sql<{ member_id: string }[]>`SELECT member_id FROM member_mentions WHERE article_id = ${articleId} ORDER BY member_id`).map((r) => r.member_id);

test("名单与词表是同一份：182 行各归其位，别名不另开页", () => {
  assert.equal(MEMBERS.length, 182, "词表行数 = 88 角色 + 88 声优 + 6 别名");
  assert.equal(MEMBER_ENTITIES.length, 88);

  const rows = new Map<string, number>();
  for (const entry of MEMBERS) {
    const key = JSON.stringify(entry.forms);
    rows.set(key, (rows.get(key) ?? 0) + 1);
  }

  const ids = new Set<string>();
  const claimed = new Map<string, number>();
  const claim = (forms: readonly string[]) => {
    const key = JSON.stringify(forms);
    claimed.set(key, (claimed.get(key) ?? 0) + 1);
    assert.ok(rows.has(key), `${key} 不在词表里`);
  };

  for (const m of MEMBER_ENTITIES) {
    assert.ok(!ids.has(m.id), `${m.id} 重复`);
    ids.add(m.id);
    assert.ok(!ENTITIES[m.id], `${m.id} 与抓取主体的 id 撞车`);
    assert.equal(ENTITIES[m.band]?.kind, "band", `${m.id} 的所属乐队 ${m.band} 不是 ENTITIES 里的乐队`);
    assert.ok(m.forms[0]?.trim(), `${m.id} 没有写法`);
    assert.ok(m.actor.forms[0]?.trim(), `${m.id} 没有声优写法`);
    claim(m.forms);
    claim(m.actor.forms);
    for (const alias of m.aliases) claim(alias);
  }
  for (const [key, count] of rows) assert.equal(claimed.get(key) ?? 0, count, `${key} 被认领的次数对不上`);

  // 别名是并进本名页的，不是自己一页：六个舞台代号/米歇尔都不该是 id。
  for (const alias of ["Oblivionis", "Mortis", "Doloris", "Timoris", "Amoris", "米歇尔"]) {
    assert.ok(MEMBER_ENTITIES.some((m) => m.aliases.flat().includes(alias)), `${alias} 应该并进某一页`);
  }
  assert.equal(memberById("nina-iseri")?.band, "togenashi-togeari");
  assert.equal(memberById("no-such-member"), undefined);
});

test("提及认得出本名、假名、罗马字与别名，也认得词表里没有的短写法不该认的边界", () => {
  assert.deepEqual(mentionedMembers({ title: "井芹仁菜 的新曲" }), ["nina-iseri"]);
  assert.deepEqual(mentionedMembers({ originalTitle: "Nina Iseri announces a new single" }), ["nina-iseri"]);
  assert.deepEqual(mentionedMembers({ summary: "いせりにな が歌う" }), ["nina-iseri"]);
  // 别名提到的报道算这个角色的报道。
  assert.deepEqual(mentionedMembers({ title: "Oblivionis 的新曲" }), ["sakiko-togawa"]);
  assert.deepEqual(mentionedMembers({ body: "米歇尔 登场" }), ["misaki-okusawa"]);
  // 声优提到也算这个角色（角色页把中之人算在自己名下）。
  assert.deepEqual(mentionedMembers({ title: "理名 访谈" }), ["nina-iseri"]);
  // 拉丁写法要贴词边界：Rina 不在 Marina 里，YOSHI 不在 YOSHIDA 里。
  assert.deepEqual(mentionedMembers({ title: "Marina 的演唱会" }), []);
  assert.deepEqual(mentionedMembers({ title: "YOSHIDA 的演唱会" }), []);
  // 空文本、无关文本什么都不认。
  assert.deepEqual(mentionedMembers({ title: null, summary: "", body: null }), []);
  assert.deepEqual(mentionedMembers({ title: "今天的天气" }), []);
});

test("发布写投影：收录才留，重复发布不留重复行，撤收录就删掉", async () => {
  const articleId = await report({ title: "井芹仁菜 与 河原木桃香 的新曲", body: "トゲナシトゲアリ 的两位成员。" });
  assert.deepEqual(await mentionsOf(articleId), ["momoka-kawaragi", "nina-iseri"]);

  // 再发布一次：同样的内容，行数不变（整篇重写而不是累加）。
  await publishArticle(articleId, {});
  assert.deepEqual(await mentionsOf(articleId), ["momoka-kawaragi", "nina-iseri"]);

  // 标题改成只提一个人（声优名也算）：旧行跟着消失。原文标题与中文标题都换掉，否则原文标题还在点名。
  await sql`UPDATE articles SET title = '理名 一个人。' WHERE id = ${articleId}`;
  await sql`UPDATE analyses SET title_zh = '理名 一个人。' WHERE article_id = ${articleId}`;
  await publishArticle(articleId, {});
  assert.deepEqual(await mentionsOf(articleId), ["nina-iseri"]);

  // 正文只在 body_mode='full' 时参与匹配（与 pool_search 同一条规则）：这里的正文点了名也不算。
  const bodyOnly = await report({ title: "今天的天气", body: "河原木桃香 也在现场。" });
  assert.deepEqual(await mentionsOf(bodyOnly), []);

  // 不收录的报道（isolated 信源）一行都不留；先塞一行进去，再发布就把它删掉。
  const hidden = await report({ title: "井芹仁菜 的传闻", source: ISOLATED });
  assert.deepEqual(await mentionsOf(hidden), []);
  await sql`INSERT INTO member_mentions (member_id, article_id) VALUES ('nina-iseri', ${hidden})`;
  await publishArticle(hidden, {});
  assert.deepEqual(await mentionsOf(hidden), []);

  // 直接调也认同一件事：eligible 为假时清空。
  await sql`INSERT INTO member_mentions (member_id, article_id) VALUES ('nina-iseri', ${hidden})`;
  await deriveMemberMentions(sql, hidden, false, { title: "井芹仁菜" });
  assert.deepEqual(await mentionsOf(hidden), []);
});

test("读取层：只读还列得出来的报道，页码越界是 404，分类计数算全部", async () => {
  const at = new Date(Date.now() - 3_600_000);
  const now = new Date();
  // 一篇已下架的报道：投影行还在，页面不该读它（下架与撤收录是两条路，这里专测下架）。
  const withdrawn = `withdrawn-${T}`;
  await seed(withdrawn, "momono-asai", at, "release");
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const before = await loadMemberPage("momono-asai", 1, now);
  assert.ok(before);
  assert.equal(before.member.total, 0);
  assert.equal(before.member.indexable, false, "一篇都没有的页面不进 sitemap");
  assert.equal(before.pageCount, 1);
  assert.deepEqual(before.items, []);

  // 25 篇（MEMBER_PAGE_SIZE = 20）：两页，第二页 5 篇，第三页 404。
  const ids: string[] = [];
  for (let i = 0; i < 25; i += 1) {
    const id = `seed-${T}-${i}`;
    ids.push(id);
    await seed(id, "momono-asai", new Date(at.getTime() - i * 60_000), i % 2 === 0 ? "live" : "media");
  }

  const first = await loadMemberPage("momono-asai", 1, now);
  assert.ok(first);
  assert.equal(first.member.total, 25);
  assert.equal(first.member.indexable, true, "够 5 篇就进 sitemap");
  assert.equal(first.member.recent, 25);
  assert.equal(first.pageCount, 2);
  assert.equal(first.pageSize, MEMBER_PAGE_SIZE);
  assert.equal(first.items.length, MEMBER_PAGE_SIZE);
  assert.equal(first.items[0]?.id, ids[0], "新的在前");
  assert.deepEqual(first.categories.map((c) => c.count).reduce((a, b) => a + b, 0), 25, "分类计数算全部报道");
  assert.deepEqual(first.bandmates.map((b) => b.id).length, 4, "F-272 同队另外四个角色");

  const second = await loadMemberPage("momono-asai", 2, now);
  assert.ok(second);
  assert.equal(second.items.length, 5);
  assert.equal(await loadMemberPage("momono-asai", 3, now), null, "越界是 404");
  assert.equal(await loadMemberPage("momono-asai", 0, now), null);
  assert.equal(await loadMemberPage("momono-asai", 1.5, now), null);
  assert.equal(await loadMemberPage("no-such-member", 1, now), null);

  // 下架其中一篇：页面少一篇，sitemap 的时间跟着走。
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${ids[0]}`;
  const after = await loadMemberPage("momono-asai", 1, now);
  assert.ok(after);
  assert.equal(after.member.total, 24);
  assert.ok(!after.items.some((i) => i.id === ids[0]));
});

test("总览按企划分组，侧栏入口按主体给，sitemap 只收够 5 篇的页面", async () => {
  const list = await listMembers(new Date());
  assert.deepEqual(list.groups.map((g) => g.project), ["girls-band-cry", "bang-dream", "bocchi-the-rock"]);
  const total = list.groups.flatMap((g) => g.bands.flatMap((b) => b.members)).length;
  assert.equal(total, 88, "每一页都在总览里出现一次");
  const gbc = list.groups[0]!;
  assert.deepEqual(gbc.bands.map((b) => b.id), ["togenashi-togeari", "canna-lily", "f-272", "kuzumimizuku", "diamond-dust"]);
  assert.equal(gbc.bands[0]!.members.length, 5);
  assert.ok(gbc.bands[0]!.members.some((m) => m.id === "nina-iseri" && m.actor?.name === "理名"));
  // 担当是「官方写明了才有」的可选字段：新补的两支手游乐队有，其余多数暂时只有名字（见文档 W13 的待办）。
  assert.equal(gbc.bands[2]!.members.find((m) => m.id === "momono-asai")?.role, "Ba.");

  // 侧栏：乐队给自己那 5 个，企划给系列里所有乐队（含手游那两支），方向页与未知主体什么都没有。
  assert.equal(memberLinks("togenashi-togeari").length, 5);
  assert.equal(memberLinks("girls-band-cry").length, 24);
  assert.deepEqual(memberLinks("live"), []);
  assert.deepEqual(memberLinks("no-such-subject"), []);

  const entries = await memberSitemapEntries(new Date());
  assert.equal(entries.length, 88);
  assert.equal(entries.find((e) => e.id === "momono-asai")?.indexable, true, "够 5 篇的角色页进 sitemap");
  assert.equal(entries.find((e) => e.id === "kaede-kitsuta")?.indexable, false, "还没有报道的角色页不进 sitemap");

  const xml = await sitemapXml();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.ok(xml.includes("/member/momono-asai</loc>"), "sitemap 有角色页");
  assert.ok(xml.includes("/members</loc>"), "sitemap 有角色目录");
  assert.ok(!xml.includes("/member/kaede-kitsuta</loc>"), "不够 5 篇的不提交");
});

test("出口：目录、角色页、分享图与 404", async () => {
  const list = await app.inject({ method: "GET", url: "/api/site/members" });
  assert.equal(list.statusCode, 200);
  const body = JSON.parse(list.body) as { groups: Array<{ bands: Array<{ members: Array<{ id: string }> }> }> };
  assert.equal(body.groups.flatMap((g) => g.bands.flatMap((b) => b.members)).length, 88);

  const page = await app.inject({ method: "GET", url: "/api/site/members/nina-iseri" });
  assert.equal(page.statusCode, 200);
  const data = JSON.parse(page.body) as { member: { id: string; band: string; total: number }; bandmates: Array<{ id: string }>; items: Array<{ id: string }> };
  assert.equal(data.member.id, "nina-iseri");
  assert.equal(data.member.band, "togenashi-togeari");
  assert.equal(data.bandmates.length, 4);
  assert.ok(data.member.total >= 1);
  assert.ok(data.items.length >= 1);

  assert.equal((await app.inject({ method: "GET", url: "/api/site/members/no-such-member" })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/site/members/nina-iseri?page=99" })).statusCode, 404);

  const og = await app.inject({ method: "GET", url: "/og/members/nina-iseri.png" });
  assert.equal(og.statusCode, 200);
  assert.match(String(og.headers["content-type"]), /image\/png/);
  assert.equal((await app.inject({ method: "GET", url: "/og/members/no-such-member.png" })).statusCode, 404);
});
