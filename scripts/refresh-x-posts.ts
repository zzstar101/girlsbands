// 清理上线前抓到的 X 推文（2026-10 第一轮修复的补课），三步，都只碰「已公开」的条目：
//   bodies   正文还是 pending、或标题带着 "RT by @x:" 的推文：从 fxtwitter 取原文（保留换行），写成新修订
//            （content/materials.ts reviseMaterial）——分析和翻译会按新修订重跑，新的成员号规则也随之生效。
//            只补已经掉出 Nitter RSS 窗口的旧推文；还在窗口里的，先把 X 信源 next_fetch_at 拨到现在，
//            让采集器自己按新解析修订，免得两边写法不同、之后来回改版本。
//   links    正文里还留着镜像地址（nitter.*）的：只把链接改回 x.com / t.co，内容不变，不出新修订，译文同改。
//   rescreen 成员个人号的已公开推文，按新的 prefilter 规则重新判一次。必须带新的 attempt tag：
//            同一修订、同一标签会命中旧回执，等于没判。
//   node --env-file=.env scripts/refresh-x-posts.ts <bodies|links|rescreen> [--limit N] [--pace MS] [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { queueProcessing } from "@girlsbands/backend/jobs/content";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { contentHash, reviseMaterial } from "@girlsbands/backend/content/materials";
import { sanitizeBody } from "@girlsbands/backend/content/sanitize";
import { mirrorBody } from "@girlsbands/backend/sources/rss";
import { collapseWhitespace, stripTags } from "@girlsbands/backend/lib/text";

const args = process.argv.slice(2);
const mode = args[0];
const value = (name: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const limit = Number(value("--limit") ?? 1000);
const pace = Number(value("--pace") ?? 1500);
const dry = args.includes("--dry");
const RESCREEN_TAG = value("--tag") ?? "rescreen-20261007";
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
  text: string;
  url: string;
  author?: { screen_name?: string; name?: string };
  media?: { photos?: Array<{ url: string }>; videos?: Array<{ thumbnail_url?: string }> };
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
      AND a.processing_state = 'analyzed'
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
else console.error("usage: refresh-x-posts.ts <bodies|links|rescreen> [--limit N] [--pace MS] [--dry]");
await stopBoss();
await closeDb();
