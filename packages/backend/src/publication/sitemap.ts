// Sitemap from the same public metadata as pages: reports, topics and their pages,
// the latest 500 stories and indexable items. Cached ~5 minutes and rebuilt in the
// background after that (crawlers get the previous copy meanwhile); if the database fails, the last
// successful sitemap is served (never an empty one). Bounded.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { cached } from "../lib/cache.ts";
import { escapeXml } from "../lib/text.ts";
import { siteUrl } from "./links.ts";
import { evidenceCondition, listedCondition, selectedCondition } from "./scope.ts";
import { liveSitemapEntries } from "./lives.ts";
import { memberSitemapEntries } from "./members.ts";
import { releaseSitemapEntries } from "./releases.ts";
import { topicPageCounts } from "./topics.ts";
import { GUIDE_PATH } from "@girlsbands/industry/guides";

const MAX_URLS = 45_000;
const TTL_MS = 5 * 60 * 1000;
const CACHE_FILE = path.join(config.dataDir, "sitemap-last.xml");

let lastGood: string | null = null;

interface Entry {
  loc: string;
  lastmod?: Date | null;
  changefreq?: string;
  priority?: number;
}

async function build(): Promise<string> {
  const entries: Entry[] = [];
  const [latestItem] = await sql<{ t: Date | null }[]>`SELECT max(p.timeline_at) AS t FROM publications p WHERE ${selectedCondition(new Date())}`;
  const [latestDaily] = await sql<{ key: string | null; t: Date | null }[]>`SELECT max(key) AS key, max(generated_at) AS t FROM reports WHERE kind = 'daily'`;
  const now = latestItem?.t ?? new Date();
  entries.push(
    { loc: "/", lastmod: now, changefreq: "hourly", priority: 1 },
    { loc: "/all", lastmod: now, changefreq: "hourly", priority: 0.9 },
    { loc: "/daily", lastmod: latestDaily?.t, changefreq: "daily", priority: 0.9 },
    { loc: "/hot", lastmod: now, changefreq: "hourly", priority: 0.9 },
    { loc: "/deadlines", lastmod: now, changefreq: "hourly", priority: 0.9 },
    { loc: "/daily/archive", lastmod: latestDaily?.t, changefreq: "daily", priority: 0.7 },
    { loc: "/weekly", changefreq: "weekly", priority: 0.7 },
    { loc: "/monthly", changefreq: "monthly", priority: 0.6 },
    { loc: "/agent", lastmod: now, changefreq: "weekly", priority: 0.7 },
    { loc: "/about", changefreq: "monthly", priority: 0.5 },
    { loc: "/terms", changefreq: "monthly", priority: 0.4 },
    { loc: "/privacy", changefreq: "monthly", priority: 0.4 },
    { loc: "/rights", changefreq: "monthly", priority: 0.4 },
    { loc: "/changelog", lastmod: now, changefreq: "weekly", priority: 0.5 },
    { loc: GUIDE_PATH, changefreq: "monthly", priority: 0.5 },
  );
  // 一期报告只在它还有「列得出来」的引用条目时才提交：整期引用的条目都被下架后，这一期没有可读内容，
  // 却还留在 sitemap 里（页面上是划掉的引文）。可见性判断复用 scope.ts 的 listedCondition，与报告读取层
  // 同一套口径；引用的 itemId 一律指向文章 id，直接从 content 里取 —— 顶层条目、条目下的相关报道、flash
  // 都是这个字段名（reports.ts 的 citationFrom 也按这些 itemId 判定）。
  const reports = await sql<{ kind: string; key: string; generated_at: Date }[]>`
    SELECT r.kind, r.key, r.generated_at
    FROM reports r
    WHERE EXISTS (
      SELECT 1 FROM publications p
      WHERE ${listedCondition(new Date())}
        AND p.article_id IN (SELECT jsonb_array_elements_text(jsonb_path_query_array(r.content, '$.**.itemId')))
    )
    ORDER BY r.kind, r.key DESC`;
  for (const r of reports) entries.push({ loc: `/${r.kind}/${r.key}`, lastmod: r.generated_at, changefreq: r.kind === "daily" ? "never" : "monthly", priority: r.kind === "daily" ? 0.6 : 0.6 });
  for (const t of await topicPageCounts()) {
    if (!t.indexable) continue;
    entries.push({ loc: `/topics/${t.slug}`, lastmod: t.changedAt, changefreq: "daily", priority: 0.6 });
    for (let p = 2; p <= t.pages; p++) entries.push({ loc: `/topics/${t.slug}/page/${p}`, lastmod: t.changedAt, changefreq: "weekly", priority: 0.3 });
  }
  // 角色页（/members 目录 + 88 个角色页）：页面都在，但提到它的报道不够 5 篇的不提交给搜索引擎
  // —— 薄页面能读就够了（站主 2026-10-05 拍板）。
  entries.push({ loc: "/members", lastmod: now, changefreq: "weekly", priority: 0.4 });
  for (const m of await memberSitemapEntries(new Date())) {
    if (!m.indexable) continue;
    entries.push({ loc: `/member/${m.id}`, lastmod: m.changedAt, changefreq: "weekly", priority: 0.4 });
  }
  // 演出页：和主题页一样，只有名下还有公开报告的那几场才进。
  for (const l of await liveSitemapEntries(new Date(), 500)) {
    entries.push({ loc: `/live/${l.publicId}`, lastmod: l.lastmod, changefreq: "daily", priority: 0.6 });
  }
  // 发售页：碟本身没有「下场」，只要第一条公告还在公开列表里，这页就能读，所以也进 sitemap。
  for (const r of await releaseSitemapEntries(new Date(), 500)) {
    entries.push({ loc: `/release/${r.publicId}`, lastmod: r.lastmod, changefreq: "weekly", priority: 0.5 });
  }
  // Stories with listed evidence of their own; pages that only gather reports grouped elsewhere (imported
  // story levels, regrouped history) or only mention facts are reachable but not listed.
  const stories = await sql<{ public_id: string; latest_at: Date | null }[]>`
    SELECT public_id::text, latest_at FROM stories WHERE merged_into IS NULL AND EXISTS (
      SELECT 1 FROM facts f JOIN fact_articles fa ON fa.fact_id = f.id JOIN publications p ON p.article_id = fa.article_id
      WHERE f.story_id = stories.id AND ${evidenceCondition()} AND ${listedCondition(new Date())})
    ORDER BY latest_at DESC NULLS LAST, id DESC LIMIT 500`;
  for (const s of stories) entries.push({ loc: `/story/${s.public_id}`, lastmod: s.latest_at, changefreq: "daily", priority: 0.5 });
  const items = await sql<{ id: string; t: Date }[]>`
    SELECT article_id AS id, updated_at AS t FROM publications WHERE visibility = 'public' AND indexable ORDER BY timeline_at DESC LIMIT ${MAX_URLS - entries.length}`;
  for (const it of items) entries.push({ loc: `/items/${it.id}`, lastmod: it.t, changefreq: "monthly", priority: 0.5 });

  const body = entries
    .slice(0, MAX_URLS)
    .map((e) => {
      const parts = [`<loc>${escapeXml(siteUrl(e.loc))}</loc>`];
      if (e.lastmod) parts.push(`<lastmod>${e.lastmod.toISOString()}</lastmod>`);
      if (e.changefreq) parts.push(`<changefreq>${e.changefreq}</changefreq>`);
      if (e.priority !== undefined) parts.push(`<priority>${e.priority}</priority>`);
      return `<url>\n${parts.join("\n")}\n</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

const sitemap = cached(refreshSitemap, { freshMs: TTL_MS, maxStaleMs: 60 * 60_000 });

export function sitemapXml(): Promise<string> {
  return sitemap.get();
}

async function refreshSitemap(): Promise<string> {
  try {
    const xml = await build();
    lastGood = xml;
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, xml).catch(() => {});
    return xml;
  } catch (error) {
    if (lastGood) return lastGood;
    const last = await readFile(CACHE_FILE, "utf8").catch(() => null);
    if (last) return last;
    throw error;
  }
}
