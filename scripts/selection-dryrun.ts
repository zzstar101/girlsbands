// 精选第三版（规则优先）上线前的新旧对比（2026-10-07）。不改任何判定、不动公开页面：
// 只对最近 N 天官方信源的资料跑一遍「不能错过」判定（回执会留下，正式上线重判时直接复用、不再花钱），
// 分数沿用已有的两次评分，按新门槛重新比一遍，列出「新增入选 / 新增落选」。
//   node --env-file=.env scripts/selection-dryrun.ts [--days 7] [--out /tmp/selection-diff.md] [--concurrency 6]
import { writeFileSync } from "node:fs";
import { closeDb, sql } from "@girlsbands/backend/db";
import { loadAnalyzeInput, runMustSee, selectionTier, SCORE_CALLS, tierThreshold } from "@girlsbands/backend/editorial/analyze";

const args = process.argv.slice(2);
const value = (name: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const days = Number(value("--days") ?? 7);
const out = value("--out") ?? "/tmp/selection-diff.md";
const concurrency = Number(value("--concurrency") ?? 6);

interface Row {
  article_id: string; title_zh: string | null; score: string | null; selected: boolean; output: Record<string, unknown>;
  tier: string; tags: string[] | null; owner_entity_id: string | null; source_name: string; published_at: Date | null;
  pub_selected: boolean | null; backfill: boolean;
}

const rows = await sql<Row[]>`
  SELECT DISTINCT ON (an.article_id) an.article_id, an.title_zh, an.score, an.selected, an.output,
         s.tier, s.tags, s.owner_entity_id, s.name AS source_name, a.published_at, p.selected AS pub_selected, a.backfill
  FROM analyses an
  JOIN articles a ON a.id = an.article_id
  JOIN sources s ON s.id = a.source_id
  LEFT JOIN publications p ON p.article_id = a.id
  WHERE an.relevance = 'pass' AND coalesce(a.published_at, a.discovered_at) > now() - make_interval(days => ${days})
  ORDER BY an.article_id, an.input_revision DESC, an.id DESC`;
console.log(`candidates: ${rows.length}`);

type Judged = Row & { newTier: string; kind: string | null; claimed: string | null; quote: string | null; scoreIn: boolean; now: boolean; error?: string };
const judged: Judged[] = [];
let next = 0;
async function worker() {
  while (next < rows.length) {
    const r = rows[next++]!;
    const source = { tier: r.tier, tags: r.tags, ownerEntityId: r.owner_entity_id };
    const newTier = selectionTier(source, true);
    const th = tierThreshold(newTier, true);
    const scores = Array.isArray(r.output.scores) ? (r.output.scores as number[]) : null;
    const sum = scores?.length === SCORE_CALLS ? scores.reduce((t, v) => t + v, 0) : null;
    const scoreIn = sum !== null && th !== null && sum >= th * SCORE_CALLS;
    let kind: string | null = null, claimed: string | null = null, quote: string | null = null, error: string | undefined;
    if (th !== null) {
      try {
        const input = await loadAnalyzeInput(r.article_id);
        const m = input ? await runMustSee(input, { force: true }) : null;
        kind = m?.kind ?? null; claimed = m?.claimed ?? null; quote = m?.quote ?? null;
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 200) : String(e);
      }
    }
    judged.push({ ...r, newTier, kind, claimed, quote, scoreIn, now: !!kind, ...(error ? { error } : {}) });
    if (judged.length % 25 === 0) console.log(`${judged.length}/${rows.length}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const KIND_ZH: Record<string, string> = {
  new_anime: "新动画", new_project: "新企划", new_band: "新乐队", live_new: "新 Live", live_supplement: "Live 补充说明",
  release: "BD/CD 等新作发售", merch: "通贩与周边", bonus: "特典", ticket_window: "抽选/票务开始与截止",
  personal_event: "声优个人活动", doujin_event: "国内同人 Only", member_change: "成员变动", schedule_change: "中止延期与变更",
};
const date = (d: Date | null) => (d ? new Date(d.getTime() + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ") : "—");
const why = (j: Judged) => (j.kind ? KIND_ZH[j.kind]! : `不在清单（模型判 ${j.claimed ?? "—"}${j.claimed && j.claimed !== "none" ? "，原文无对应句或缺图" : ""}，旧分数 ${j.score ?? "—"}）`);
const line = (j: Judged) => `| ${date(j.published_at)} | ${j.source_name} | ${(j.title_zh ?? "").replace(/\|/g, "／").slice(0, 70)} | ${why(j)} | https://girlsbands.com/items/${j.article_id} |`;
const sorted = [...judged].sort((a, b) => (b.published_at?.getTime() ?? 0) - (a.published_at?.getTime() ?? 0));
const added = sorted.filter((j) => j.now && !j.selected);
const dropped = sorted.filter((j) => !j.now && j.selected);
const kept = sorted.filter((j) => j.now && j.selected);
const head = "| 时间(JST) | 信源 | 标题 | 依据 | 链接 |\n|---|---|---|---|---|";
const byKind = Object.entries(KIND_ZH).map(([k, zh]) => `${zh} ${judged.filter((j) => j.kind === k).length}`).join("，");
const errors = judged.filter((j) => j.error);
const md = [
  `# 精选新旧对比（最近 ${days} 天，${judged.length} 条通过预筛的资料）`,
  "",
  `- 旧规则入选 ${judged.filter((j) => j.selected).length} 条，新规则入选 ${judged.filter((j) => j.now).length} 条（都是去重之前的数）`,
  `- 新增入选 ${added.length} 条，新增落选 ${dropped.length} 条，两边都入选 ${kept.length} 条`,
  `- 规则命中：${byKind}`,
  ...(errors.length ? [`- 判定失败 ${errors.length} 条：${errors.slice(0, 3).map((e) => e.error).join("；")}`] : []),
  "",
  `## 新增入选（${added.length}）`, head, ...added.map(line), "",
  `## 新增落选（${dropped.length}）`, head, ...dropped.map(line), "",
  `## 两边都入选（${kept.length}）`, head, ...kept.map(line), "",
].join("\n");
writeFileSync(out, md);
writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify(judged.map((j) => ({
  id: j.article_id, title: j.title_zh, source: j.source_name, tier: j.newTier, score: j.score, old: j.selected, now: j.now, kind: j.kind, claimed: j.claimed, quote: j.quote,
})), null, 1));
console.log(`wrote ${out}: added ${added.length}, dropped ${dropped.length}, kept ${kept.length}, errors ${errors.length}`);
await closeDb();
