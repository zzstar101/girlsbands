// 给上线前抓到的 Nitter 推文补上 X 帖子数据（articles.x_post）：从 fxtwitter 取原文，
// 按 fxTweetToXPost 写成和采集路径同一种形状，再重新发布一次让 publications.channel 翻成 'x'。
// 只补「还没解析出 x_post」的：已经在窗口里的推文采集器自己会写，两边写法一致。
// x_post 只是展示数据，所以不动 body_hash、不出新修订、不重新分析。
//   node --env-file=.env scripts/backfill-x-posts.ts [--limit N] [--pace MS] [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { publishArticle } from "@girlsbands/backend/publication/publish";
import { fxTweetToXPost, fetchXStatus, recordXProfiles } from "@girlsbands/backend/sources/x-profiles";

const args = process.argv.slice(2);
const value = (name: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const limit = Number(value("--limit") ?? 200);
const pace = Number(value("--pace") ?? 400);
const dry = args.includes("--dry");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row { id: string; url: string; title: string; handle: string; tweet_id: string; owner: string | null }

async function main() {
  // 信源还在窗口里的推文，采集器下一次抓取就会按新解析写 x_post，不用管。
  const rows = await sql<Row[]>`
    SELECT a.id, a.url, a.title,
           substring(a.url from '//[^/]+/([^/]+)/status/') AS handle,
           substring(a.url from '/status/([0-9]+)') AS tweet_id,
           substring(s.config->>'feedUrl' from '//[^/]+/([^/]+)/rss') AS owner
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    JOIN publications p ON p.article_id = a.id
    WHERE s.id LIKE 'rss-nitter-%' AND a.x_post IS NULL
    ORDER BY a.discovered_at DESC
    LIMIT ${limit}`;
  console.log(`backfill-x-posts: ${rows.length} candidates (limit ${limit}, pace ${pace}ms${dry ? ", dry" : ""})`);

  let updated = 0, missing = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    if (!r.handle || !r.tweet_id) { skipped += 1; console.log(`  skip ${r.id} ${r.url}`); await sleep(pace / 2); continue; }
    const tweet = await fetchXStatus(r.handle, r.tweet_id).catch(() => null);
    if (!tweet) { missing += 1; console.log(`  missing ${r.id} ${r.url}`); await sleep(pace); continue; }
    const xPost = fxTweetToXPost(tweet);
    if (!xPost) { skipped += 1; console.log(`  unusable ${r.id} (no author/id) ${r.url}`); await sleep(pace / 2); continue; }
    // 信源账号转推别人的帖子：帖子作者不是信源账号，卡片顶上要写「某某 转发了」。
    if (r.owner && r.owner.toLowerCase() !== xPost.handle.toLowerCase()) xPost.retweetedBy = { handle: r.owner, authorName: null };
    if (dry) { console.log(`  would update ${r.id}: @${xPost.handle} ${xPost.text.slice(0, 40)}`); await sleep(pace / 2); continue; }
    try {
      // x_post 不在 content_hash 里：直接写字段，不出新修订，分析和译文都不重跑。
      await sql`UPDATE articles SET x_post = ${sql.json(xPost as never)} WHERE id = ${r.id}`;
      await recordXProfiles([
        { handle: xPost.handle, authorName: xPost.authorName, avatarUrl: xPost.avatarUrl ?? null },
        ...(xPost.quoted ? [{ handle: xPost.quoted.handle, authorName: xPost.quoted.authorName, avatarUrl: xPost.quoted.avatarUrl ?? null }] : []),
      ]);
      // 重新发布：channelOf(kind, hasXPost) 由 x_post 存在决定，这里翻成 'x'。
      await publishArticle(r.id);
      updated += 1;
    } catch (error) {
      failed += 1;
      console.log(`  failed ${r.id}: ${(error as Error).message}`);
    }
    await sleep(pace);
  }
  console.log(`backfill-x-posts: updated ${updated}, missing ${missing}, skipped ${skipped}, failed ${failed}`);
}

await main();
await stopBoss();
await closeDb();
