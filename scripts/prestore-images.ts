// 把已经公开的条目（含声优日常那条 daily 线）的图片都存一份（原图 + 页面要的各个尺寸），以及 x_profiles 里的头像。
// 发布时会自动存（publication/publish.ts → media.prepare），这个脚本补之前发布、还只在源站/镜像上的那些。
// 新的在前：镜像挂掉时最近的帖子最可能还拿得到图。可重复跑：存过的只花一次缓存检查。
//   bun scripts/prestore-images.ts [--days N] [--limit N] [--concurrency N] [--avatars-only] [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { prepareArticleMedia, prepareAvatars, type PreparedMedia } from "@girlsbands/backend/media/prepare";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const days = Number(arg("--days") ?? 3650);
const limit = Number(arg("--limit") ?? 1_000_000);
const concurrency = Math.max(1, Number(arg("--concurrency") ?? 4));
const dry = process.argv.includes("--dry");
const avatarsOnly = process.argv.includes("--avatars-only");

const total: PreparedMedia = { originals: 0, renditions: 0, made: 0, failed: 0, animatedSaved: 0 };
const add = (r: PreparedMedia) => {
  for (const k of Object.keys(total) as Array<keyof PreparedMedia>) total[k] += r[k];
};

async function pool<T>(items: readonly T[], run: (item: T) => Promise<void>, label: string) {
  let next = 0;
  let done = 0;
  const started = Date.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await run(item);
      if (++done % 100 === 0 || done === items.length) {
        console.log(`  ${label} ${done}/${items.length} · ${Math.round((Date.now() - started) / 1000)}s · ${JSON.stringify(total)}`);
      }
    }
  }));
}

const avatars = (await sql<{ avatar_url: string }[]>`
  SELECT DISTINCT avatar_url FROM x_profiles WHERE avatar_url IS NOT NULL`).map((r) => r.avatar_url);
console.log(`avatars: ${avatars.length}`);
if (!dry) {
  await pool(avatars, async (url) => {
    try { add(await prepareAvatars([url])); } catch (error) { console.warn(`  avatar ${url}: ${(error as Error).message}`); }
  }, "avatars");
}

if (!avatarsOnly) {
  const articles = await sql<{ article_id: string }[]>`
    SELECT p.article_id FROM publications p
    WHERE p.visibility = 'public' AND (p.eligible OR p.category = 'daily')
      AND p.timeline_at > now() - make_interval(days => ${days}::int)
    ORDER BY p.timeline_at DESC
    LIMIT ${limit}`;
  console.log(`articles: ${articles.length}`);
  if (!dry) {
    await pool(articles, async ({ article_id }) => {
      try { add(await prepareArticleMedia(article_id)); } catch (error) { console.warn(`  ${article_id}: ${(error as Error).message}`); }
    }, "articles");
  }
}

console.log(`done ${JSON.stringify(total)}`);
await closeDb();
process.exit(0);
