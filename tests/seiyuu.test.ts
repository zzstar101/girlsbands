import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { InvalidCursorError } from "@girlsbands/backend/lib/cursor";
import { loadSeiyuu } from "@girlsbands/backend/publication/seiyuu";
import { ENTITIES } from "@girlsbands/industry/taxonomy";

const T = `seiyuu-${tag()}`;
const NOW = new Date('2026-10-05T03:00:00Z');
after(closeDb);
let n = 0;

interface Seed {
  /** 只有成员账号（tags 带「成员」、挂了主体、editorial 参与）才进这条时间线。 */
  band?: string;
  mode?: string;
  tags?: string[];
  at?: Date;
  channel?: string;
  x_post?: Record<string, unknown> | null;
  /** 日常 lane：不进池子（eligible=false），靠 category='daily' 进来。 */
  daily?: boolean;
  visibility?: string;
  url?: string;
  config?: Record<string, unknown>;
}

interface Row {
  id: string;
  /** 帖子里的账号段：x.com/<handle>/status/…，路径段只认字母数字下划线。 */
  handle: string;
}

/**
 * 一条帖子一行：自己的成员信源、文章、分析、publication。/seiyuu 只能按乐队和账号筛，所以本文件
 * 按顺序共享同一份库，每个测试都读自己那支乐队，别让兄弟测试的帖子混进来。
 */
async function post(seed: Seed = {}): Promise<Row> {
  const id = `${T}-${++n}`;
  const handle = `m${n}`;
  const at = seed.at ?? NOW;
  const band = seed.band ?? 'mygo';
  const member = seed.tags?.includes('成员') ?? true;
  const url = seed.url ?? `https://x.com/${handle}/status/${id}`;
  await sql`INSERT INTO sources (id, name, kind, tier, tags, owner_entity_id, participation_mode, next_fetch_at, config)
    VALUES (${id}, ${member ? `X: ${id} (@${handle})` : '官网公告'}, 'rss', 'T1_5', ${seed.tags ?? ['官方', '成员']},
      ${member ? band : null}, ${seed.mode ?? 'editorial'}, '2100-01-01', ${sql.json((seed.config ?? { feedUrl: `https://nitter.meowing.monster/${handle}/rss` }) as never)})`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, x_post)
    VALUES (${id}, ${id}, ${id}, ${url}, '今天练了贝斯', ${at}, ${at}, ${seed.x_post ? sql.json(seed.x_post as never) : null})`;
  const [analysis] = await sql`INSERT INTO analyses (article_id, input_revision, origin, output) VALUES (${id}, 1, 'model', ${sql.json({ fact: {} })}) RETURNING id`;
  await sql`INSERT INTO publications (article_id, analysis_id, revision, visibility, eligible, title, summary, source_id, channel, url, visible_after, discovered_at, timeline_at, body_mode, sort_at, tags, category)
    VALUES (${id}, ${analysis!.id}, 1, ${seed.visibility ?? 'public'}, ${!seed.daily}, '今天练了贝斯', ${seed.daily ? '今天练了贝斯' : null}, ${id}, ${seed.channel ?? 'x'},
      ${url}, ${at}, ${at}, ${at}, 'full', ${at}, ${[`entity:${band}`]}, ${seed.daily ? 'daily' : 'live'})`;
  return { id, handle };
}

/** 头像走 imgproxy 签名：拿到的是代理地址，`u` 里才是原图。 */
function proxyOf(avatarUrl: string | null, original: string) {
  assert.ok(avatarUrl, "avatarUrl 不该是 null");
  assert.match(avatarUrl!, /^\/api\/img-proxy\?u=/);
  assert.equal(new URL(avatarUrl!, "https://aniband.test").searchParams.get("u"), original);
  return avatarUrl;
}

test('声优日常只收成员账号的帖子，池子和日常两个 lane 合流，时间倒序', async () => {
  const pooled = await post();
  const daily = await post({ daily: true, at: new Date('2026-10-05T02:00:00Z') });
  const older = await post({ at: new Date('2026-10-01T00:00:00Z') });
  await post({ tags: ['官方'] });                    // 官号：不是成员
  await post({ mode: 'hot_signal' });                // 撤了 editorial 参会的源
  await post({ visibility: 'withdrawn' });           // 单条下架
  await post({ daily: true, tags: ['官方'] });       // 官方的日常帖：既没进池子也不是成员
  const feed = await loadSeiyuu({ now: NOW, limit: 40 });
  assert.deepEqual(feed.posts.map((p) => p.id), [pooled.id, daily.id, older.id]);
  // 每个帖子都带着账号：名字经 publicSourceName（面向读者去掉「X：」前缀和 handle）、handle 从帖子认出来、band 是所属主体
  assert.deepEqual(feed.posts.map((p) => p.account.name), [pooled.id, daily.id, older.id]);
  assert.deepEqual(feed.posts.map((p) => p.account.handle), [pooled.handle, daily.handle, older.handle]);
  assert.deepEqual(feed.posts.map((p) => p.band), ['mygo', 'mygo', 'mygo']);
  assert.equal(feed.posts[0]!.account.id, pooled.id);
  assert.equal(feed.posts[0]!.url, `https://x.com/${pooled.handle}/status/${pooled.id}`);
  assert.equal(feed.posts[1]!.category, 'daily');
  assert.deepEqual(feed.filters, { band: null, account: null });
});

test('x 帖子展开正文，头像从 x_profiles 缓存按 handle 补；没有原帖的旧数据不进时间线', async () => {
  const withX = await post({ band: 'canna-lily', x_post: { handle: 'taka_rr', authorName: '高松燈', text: '练习完了', media: [{ url: 'https://pbs.twimg.com/media/1.jpg' }] } });
  await post({ band: 'canna-lily', channel: 'news' });   // 上线前抓的：没有 x_post，只剩摘要
  await sql`INSERT INTO x_profiles (handle, author_name, avatar_url, fetched_at)
    VALUES ('taka_rr', '高松燈', 'https://pbs.twimg.com/avatar-taka.jpg', ${NOW})`;
  const feed = await loadSeiyuu({ band: 'canna-lily', now: NOW, limit: 40 });
  assert.deepEqual(feed.posts.map((p) => p.id), [withX.id]);
  const x = feed.posts[0]!;
  assert.equal(x.x?.text, '练习完了');
  assert.equal(x.x?.handle, 'taka_rr');
  assert.equal(x.x?.authorName, '高松燈');
  assert.equal(x.x?.media.length, 1);
  // 账号就是信源：handle 认信源地址（转推时 x_post 是原作者的，不能拿来当账号）
  assert.equal(x.account.handle, withX.handle);
  proxyOf(x.account.avatarUrl, 'https://pbs.twimg.com/avatar-taka.jpg');
  // 成员转推别人的帖子：账号仍是成员本人，头像也不拿原作者的
  const rt = await post({ band: 'canna-lily', x_post: { handle: 'taka_rr', authorName: '高松燈', text: '转推的', media: [], retweetedBy: { authorName: '成员', handle: 'whoever' } } });
  const again = await loadSeiyuu({ band: 'canna-lily', now: NOW, limit: 40 });
  const r = again.posts.find((p) => p.id === rt.id)!;
  assert.equal(r.account.handle, rt.handle);
  assert.equal(r.x?.retweetedBy?.handle, 'whoever');
  assert.equal(r.account.avatarUrl, null);
});

test('乐队、账号筛选，以及账号卡片', async () => {
  const mine = await post({ band: 'togenashi-togeari' });
  const hers = await post({ band: 'ave-mujica', at: new Date('2026-10-02T00:00:00Z') });
  const all = await loadSeiyuu({ now: NOW, limit: 40 });
  // 乐队筛选框按 taxonomy 里的顺序（前面几支是兄弟测试建的，只看自己这三支的相对先后）
  const wanted = ['togenashi-togeari', 'mygo', 'ave-mujica'];
  assert.deepEqual(all.bands.map((b) => b.id).filter((id) => wanted.includes(id)), wanted);
  assert.equal(all.bands.find((b) => b.id === 'mygo')!.name, ENTITIES['mygo']!.displayTag ?? ENTITIES['mygo']!.name);
  const byBand = await loadSeiyuu({ band: 'togenashi-togeari', now: NOW, limit: 40 });
  assert.deepEqual(byBand.posts.map((p) => p.id), [mine.id]);
  assert.equal(byBand.filters.band, 'togenashi-togeari');
  const byAccount = await loadSeiyuu({ account: hers.id, now: NOW, limit: 40 });
  assert.deepEqual(byAccount.posts.map((p) => p.id), [hers.id]);
  assert.equal(byAccount.accountInfo?.id, hers.id);
  assert.equal(byAccount.accountInfo?.band, 'ave-mujica');
  // 两个筛选器同时用：对不上就没有帖子，也没有账号卡片
  const both = await loadSeiyuu({ band: 'ave-mujica', account: mine.id, now: NOW, limit: 40 });
  assert.deepEqual(both.posts, []);
  assert.equal(both.accountInfo, null);
  // 不是成员账号的来源筛不出东西，也不给账号卡片
  const official = await post({ tags: ['官方'], at: new Date('2026-10-03T00:00:00Z') });
  const notMember = await loadSeiyuu({ account: official.id, now: NOW, limit: 40 });
  assert.deepEqual(notMember.posts, []);
  assert.equal(notMember.accountInfo, null);
});

test('游标翻页：多带一条给出下一页，换了筛选条件就作废', async () => {
  const first = await post({ band: 'bocchi-the-rock', at: new Date('2026-10-05T05:00:00Z') });
  const second = await post({ band: 'bocchi-the-rock', at: new Date('2026-10-04T05:00:00Z') });
  const third = await post({ band: 'bocchi-the-rock', at: new Date('2026-10-03T05:00:00Z') });
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await loadSeiyuu({ band: 'bocchi-the-rock', now: NOW, limit: 1, cursor });
    seen.push(...page.posts.map((p) => p.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, [first.id, second.id, third.id]);
  const page = await loadSeiyuu({ band: 'bocchi-the-rock', now: NOW, limit: 1 });
  assert.equal(page.nextCursor?.startsWith('sy.'), true);
  const next = await loadSeiyuu({ band: 'bocchi-the-rock', now: NOW, limit: 1, cursor: page.nextCursor });
  assert.deepEqual(next.posts.map((p) => p.id), [second.id]);
  // 换乐队等于换了问题：上一页的游标作废
  await assert.rejects(() => loadSeiyuu({ band: 'mygo', now: NOW, limit: 1, cursor: page.nextCursor }), InvalidCursorError);
  const filtered = await loadSeiyuu({ band: 'mygo', now: NOW, limit: 1 });
  await assert.rejects(() => loadSeiyuu({ band: 'bocchi-the-rock', now: NOW, limit: 1, cursor: filtered.nextCursor }), InvalidCursorError);
});
