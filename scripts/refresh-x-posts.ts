// 清理上线前抓到的 X 推文（2026-10 第一轮修复的补课），三步，都只碰「已公开」的条目：
//   bodies   正文还是 pending、或标题带着 "RT by @x:" 的推文：从 fxtwitter 取原文（保留换行），写成新修订
//            （content/materials.ts reviseMaterial）——分析和翻译会按新修订重跑，新的成员号规则也随之生效。
//            只补已经掉出 Nitter RSS 窗口的旧推文；还在窗口里的，先把 X 信源 next_fetch_at 拨到现在，
//            让采集器自己按新解析修订，免得两边写法不同、之后来回改版本。
//   links    正文里还留着镜像地址（nitter.*）的：只把链接改回 x.com / t.co，内容不变，不出新修订，译文同改。
//   rescreen 成员个人号的已公开推文，按新的 prefilter 规则重新判一次。必须带新的 attempt tag：
//            同一修订、同一标签会命中旧回执，等于没判。
//   xpost    成员个人号已公开、但没有 x_post 的旧推文（声优日常要按 X 卡片显示原帖，2026-10-08）：从 fxtwitter
//            取原帖（作者、头像、正文、图片、引用帖），写进 x_post；正文还空着的顺带补上。不出新修订——
//            标题、摘要、判定都不重做，只重新发布（channel 变 x、可全文）并单独翻译这一条，花的只是一次短翻译。
//            取不到的（删帖、锁号）留着不动，声优日常只放有原帖的，它们不会出现在那里。
//   translate 成员个人号已公开、全文显示、但还没有当前修订译文的推文，逐条翻译（声优日常要求全部翻译，
//            2026-10-08 起成员帖不再按长度跳过；之前按「short post」「already Chinese」跳过的，worker 的
//            translatePending 只看最近三天、也不重试跳过过的，旧帖要靠这一步补）。
//   bun scripts/refresh-x-posts.ts <bodies|links|rescreen|xpost|translate> [--limit N] [--pace MS] [--tag T] [--state analyzed|blocked] [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { queueProcessing } from "@girlsbands/backend/jobs/content";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { contentHash, reviseMaterial } from "@girlsbands/backend/content/materials";
import { sanitizeBody } from "@girlsbands/backend/content/sanitize";
import { mirrorBody } from "@girlsbands/backend/sources/rss";
import type { MediaItem, XPostData } from "@girlsbands/backend/content/materials";
import { publishArticle } from "@girlsbands/backend/publication/publish";
import { translateArticle } from "@girlsbands/backend/editorial/translate";
import { collapseWhitespace, stripTags } from "@girlsbands/backend/lib/text";

const args = process.argv.slice(2);
const mode = args[0];
const value = (name: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const limit = Number(value("--limit") ?? 1000);
const pace = Number(value("--pace") ?? 1500);
const dry = args.includes("--dry");
const RESCREEN_TAG = value("--tag") ?? "rescreen-20261007";
// --state blocked：把之前拦下的成员推文按新规则再判一次（2026-10-07 起纯日常改判 DAILY，进单独一栏）。
const STATE = value("--state") ?? "analyzed";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const X_PUBLIC = sql`
  FROM articles a JOIN sources s ON s.id = a.source_id JOIN publications p ON p.article_id = a.id
  WHERE s.id LIKE 'rss-nitter-%' AND p.visibility = 'public'`;
const RT = /^RT by @[^\s:]+:\s+/;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A tweet's text as the body Nitter would have given: line breaks kept, links, tags and handles to x.com. */
function linkify(text: string): string {
  return esc(text)
    .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
    .replace(/(^|[^\w&/])#([\p{L}\p{N}_]+)/gu, (_m, pre: string, tag: string) => `${pre}<a href="https://x.com/hashtag/${encodeURIComponent(tag)}">#${tag}</a>`)
    .replace(/(^|[^\w/])@([A-Za-z0-9_]{1,15})/g, (_m, pre: string, h: string) => `${pre}<a href="https://x.com/${h}">@${h}</a>`)
    .replace(/\n/g, "<br>\n");
}

interface FxTweet {
  id?: string;
  text: string;
  url: string;
  lang?: string | null;
  replying_to?: string | null;
  author?: { screen_name?: string; name?: string; avatar_url?: string | null };
  media?: {
    photos?: Array<{ url: string; width?: number; height?: number; altText?: string }>;
    videos?: Array<{ url?: string; thumbnail_url?: string; width?: number; height?: number }>;
  };
  quote?: FxTweet;
}

function images(t: FxTweet): string {
  return [...(t.media?.photos ?? []).map((p) => p.url), ...(t.media?.videos ?? []).map((v) => v.thumbnail_url)]
    .filter((src): src is string => !!src)
    .map((src) => `<p><img src="${esc(src)}"></p>`).join("");
}

function tweetHtml(t: FxTweet): string {
  const q = t.quote;
  const quote = q
    ? `<blockquote><p><a href="${esc(q.url)}">${esc(q.author?.name ?? "")} (@${esc(q.author?.screen_name ?? "")})</a><br>\n${linkify(q.text ?? "")}</p>${images(q)}</blockquote>`
    : "";
  return `${t.text ? `<p>${linkify(t.text)}</p>` : ""}${images(t)}${quote}`;
}

async function fx(url: string): Promise<FxTweet | null> {
  const m = /\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(url);
  if (!m) return null;
  const res = await fetch(`https://api.fxtwitter.com/${m[1]}/status/${m[2]}`, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "girlsbands-refresh/1.0" } });
  if (!res.ok) return null;
  const json = (await res.json()) as { code?: number; tweet?: FxTweet };
  return json.code === 200 && json.tweet ? json.tweet : null;
}

function mediaOf(t: FxTweet): MediaItem[] {
  return [
    ...(t.media?.photos ?? []).map((p): MediaItem => ({ kind: "image", url: p.url, width: p.width ?? null, height: p.height ?? null, alt: p.altText || null })),
    ...(t.media?.videos ?? []).filter((v) => v.url).map((v): MediaItem => ({ kind: "video", url: v.url!, width: v.width ?? null, height: v.height ?? null, poster: v.thumbnail_url ?? null })),
  ];
}

/**
 * fxtwitter 的推文写成采集器（sources/rss.ts xPostOf）那样的 x_post。帖子作者不是信源本人时，
 * 是本人转推的：retweetedBy 记信源的 handle，名字留空，读的时候从 x_profiles 补。
 */
function xPostFrom(t: FxTweet, tweetId: string, sourceHandle: string | null): XPostData {
  const handle = t.author?.screen_name ?? "";
  const q = t.quote;
  return {
    tweetId,
    authorName: t.author?.name || handle,
    handle,
    avatarUrl: t.author?.avatar_url ?? null,
    text: t.text ?? "",
    retweetedBy: sourceHandle && handle && sourceHandle.toLowerCase() !== handle.toLowerCase() ? { handle: sourceHandle, authorName: null } : null,
    quoted: q ? {
      authorName: q.author?.name || q.author?.screen_name || "", handle: q.author?.screen_name ?? "", text: q.text ?? "", url: q.url,
      avatarUrl: q.author?.avatar_url ?? null, media: mediaOf(q),
    } : null,
    media: mediaOf(t),
    lang: t.lang ?? null,
    replyTo: t.replying_to ?? null,
  };
}

async function xpost() {
  const rows = await sql<{ id: string; url: string; body_status: string; feed: string | null }[]>`
    SELECT a.id, a.url, a.body_status, coalesce(s.config->>'feedUrl', s.config->>'url') AS feed ${X_PUBLIC}
      AND s.owner_entity_id IS NOT NULL AND s.tags @> ARRAY['成员'] AND a.x_post IS NULL
    ORDER BY p.timeline_at DESC LIMIT ${limit}`;
  console.log(`xpost: ${rows.length} candidates`);
  let filled = 0, missing = 0, translated = 0;
  for (const r of rows) {
    const tweetId = /\/status\/(\d+)/.exec(r.url)?.[1];
    const t = tweetId ? await fx(r.url).catch(() => null) : null;
    if (!t || !tweetId) { missing += 1; console.log(`  missing ${r.id} ${r.url}`); await sleep(300); continue; }
    const sourceHandle = r.feed ? /^https?:\/\/[^/]+\/([A-Za-z0-9_]{1,15})(?:\/|$)/.exec(r.feed)?.[1] ?? null : null;
    const x = xPostFrom(t, tweetId, sourceHandle);
    if (dry) { console.log(`  would fill ${r.id} @${x.handle}${x.retweetedBy ? ` (RT by @${x.retweetedBy.handle})` : ""}: ${x.text.slice(0, 50).replace(/\n/g, " ")}`); continue; }
    // 只有图没有字的帖子不补正文：空正文算不上全文，body_status 保持原样。
    const bodyHtml = r.body_status === "ok" || !collapseWhitespace(t.text ?? "") ? null : sanitizeBody(tweetHtml(t), r.url);
    await sql`
      UPDATE articles SET x_post = ${sql.json(x as never)}, language = coalesce(language, ${x.lang ?? null}),
        ${bodyHtml ? sql`body_html = ${bodyHtml}, body_text = ${stripTags(bodyHtml)}, body_status = 'ok',` : sql``} updated_at = now()
      WHERE id = ${r.id} AND x_post IS NULL`;
    await publishArticle(r.id);
    const tr = await translateArticle(r.id).catch((e: Error) => ({ status: "failed", reason: e.message }));
    if (tr.status === "translated") translated += 1;
    console.log(`  filled ${r.id} @${x.handle} → ${tr.status}${"reason" in tr && tr.reason ? ` (${tr.reason})` : ""}`);
    filled += 1;
    await sleep(pace);
  }
  console.log(`xpost: filled ${filled}, translated ${translated}, missing ${missing}`);
}

async function translate() {
  const rows = await sql<{ id: string }[]>`
    SELECT a.id ${X_PUBLIC}
      AND s.owner_entity_id IS NOT NULL AND s.tags @> ARRAY['成员'] AND p.channel = 'x' AND p.body_mode = 'full'
      AND coalesce(a.language, '') <> 'zh'
      AND NOT EXISTS (SELECT 1 FROM translations tr WHERE tr.article_id = a.id AND tr.lang = 'zh' AND tr.revision >= a.revision)
    ORDER BY p.timeline_at DESC LIMIT ${limit}`;
  console.log(`translate: ${rows.length} candidates`);
  if (dry) return;
  const tally = new Map<string, number>();
  for (const r of rows) {
    const tr = await translateArticle(r.id).catch((e: Error) => ({ status: "failed", reason: e.message }));
    const key = tr.status === "translated" ? "translated" : `${tr.status}: ${"reason" in tr ? tr.reason : ""}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (/disabled|budget|HTTP 429/i.test(key)) { console.log(`  stop: ${key}`); break; }
    await sleep(pace);
  }
  console.log("translate:", Object.fromEntries(tally));
}

async function bodies() {
  const rows = await sql<{ id: string; url: string; title: string; excerpt: string | null }[]>`
    SELECT a.id, a.url, a.title, a.excerpt ${X_PUBLIC}
      AND (a.body_status = 'pending' OR a.title ~ '^RT by @')
    ORDER BY a.discovered_at DESC LIMIT ${limit}`;
  console.log(`bodies: ${rows.length} candidates`);
  let revised = 0, missing = 0;
  for (const r of rows) {
    const t = await fx(r.url).catch(() => null);
    if (!t) { missing += 1; console.log(`  missing ${r.id} ${r.url}`); await sleep(300); continue; }
    const bodyHtml = sanitizeBody(tweetHtml(t), r.url);
    const bodyText = stripTags(bodyHtml);
    const title = collapseWhitespace(r.title.replace(RT, "")) || collapseWhitespace(t.text).slice(0, 1000);
    if (dry) { console.log(`  would revise ${r.id}: ${title.slice(0, 60)}`); continue; }
    await sql.begin(async (tx) => {
      await tx`SELECT 1 FROM articles WHERE id = ${r.id} FOR UPDATE`;
      await reviseMaterial(tx, r.id, {
        set: sql`title = ${title}, body_text = ${bodyText}, body_html = ${bodyHtml}, body_status = 'ok'`,
        hash: contentHash({ title, bodyText, excerpt: r.excerpt }), title, bodyText,
      });
      await queueProcessing(r.id, { step: "analyze", db: tx });
    });
    revised += 1;
    await sleep(pace);
  }
  console.log(`bodies: revised ${revised}, missing ${missing}`);
}

async function links() {
  const rows = await sql<{ id: string; body_html: string }[]>`
    SELECT a.id, a.body_html ${X_PUBLIC} AND a.body_html ~ 'https?://nitter\\.' LIMIT ${limit}`;
  let n = 0, tr = 0;
  for (const r of rows) {
    const host = /https?:\/\/(nitter\.[^/"'\s<]+)/.exec(r.body_html)?.[1];
    if (!host) continue;
    const next = mirrorBody(r.body_html, host);
    if (dry) { console.log(`  would relink ${r.id} (${host})`); continue; }
    await sql`UPDATE articles SET body_html = ${next} WHERE id = ${r.id}`;
    n += 1;
    const [t] = await sql<{ body_html: string | null }[]>`SELECT body_html FROM translations WHERE article_id = ${r.id} AND lang = 'zh'`;
    if (t?.body_html?.includes(host)) {
      await sql`UPDATE translations SET body_html = ${mirrorBody(t.body_html, host)} WHERE article_id = ${r.id} AND lang = 'zh'`;
      tr += 1;
    }
  }
  console.log(`links: ${rows.length} candidates, relinked ${n} bodies, ${tr} translations`);
}

async function rescreen() {
  // 已经在 bodies 里出了新修订的不用再判：新修订本来就会按新规则分析。
  const rows = await sql<{ id: string }[]>`
    SELECT a.id ${X_PUBLIC}
      AND s.owner_entity_id IS NOT NULL AND s.tags @> ARRAY['成员']
      AND a.processing_state = ${STATE}
      AND NOT EXISTS (SELECT 1 FROM article_revisions r WHERE r.article_id = a.id AND r.revision = a.revision AND r.revision > 1)
    ORDER BY a.discovered_at DESC LIMIT ${limit}`;
  console.log(`rescreen: ${rows.length} candidates, tag ${RESCREEN_TAG}`);
  if (dry) return;
  let queued = 0;
  for (const r of rows) {
    await sql`UPDATE articles SET processing_state = 'new', processing_error = NULL, processing_attempts = 0, processing_retry_at = NULL WHERE id = ${r.id}`;
    if (await queueProcessing(r.id, { step: "analyze", attemptTag: RESCREEN_TAG })) queued += 1;
    await sleep(pace);
  }
  console.log(`rescreen: queued ${queued}`);
}

if (mode === "bodies") await bodies();
else if (mode === "links") await links();
else if (mode === "rescreen") await rescreen();
else if (mode === "xpost") await xpost();
else if (mode === "translate") await translate();
else console.error("usage: refresh-x-posts.ts <bodies|links|rescreen|xpost|translate> [--limit N] [--pace MS] [--dry]");
await stopBoss();
await closeDb();
