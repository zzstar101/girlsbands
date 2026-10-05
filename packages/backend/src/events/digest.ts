// Story digest: rewritten incrementally as reports arrive; contradictions with earlier reporting are
// stated explicitly. Latest progress is bound to a current public report, not generated independently.
import { z } from "zod";
import { modelFor } from "../editorial/models.ts";
import { beijingDate, beijingTime } from "@girlsbands/contracts/time";
import { sql, type Db } from "../db.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { evidenceCondition, listedCondition } from "../publication/scope.ts";
import { promptText, promptVersion } from "../editorial/prompts.ts";
import { changeSnapshot, changeSnapshotHash, diffChangeSnapshots, wordTextChanges } from "./change-diff.ts";
import type { StoryChange } from "@girlsbands/contracts/site";

export const DIGEST_PROMPT_VERSION = promptVersion("story-digest");

export const DIGEST_SYSTEM = promptText("story-digest");

export const DigestSchema = z.object({
  title: z.string().max(120).catch(""),
  digest: z.string().min(10).max(2000),
});

export interface DigestReport {
  id: string;
  title: string;
  summary: string | null;
  source_name: string;
  first_party: boolean;
  at: Date;
  fact_id: number;
  fact_subject: string | null;
  fact_action: string | null;
  fact_object: string | null;
  fact_conditions: string | null;
  evidence: string | null;
  structured_fact: unknown;
  structured_live: unknown;
  structured_release: unknown;
}

/** Conditions stay next to their object and source quote; no ownership is inferred from subjects tags. */
export function digestFactEvidence(report: DigestReport) {
  const fact = report.structured_fact && typeof report.structured_fact === "object" ? report.structured_fact as Record<string, unknown> : {};
  const conditions = Array.isArray(fact.conditions) ? fact.conditions.flatMap((condition) => {
    if (!condition || typeof condition !== "object") return [];
    const value = condition as Record<string, unknown>;
    return typeof value.text === "string" && typeof value.quote === "string" ? [{ text: value.text, quote: value.quote }] : [];
  }) : [];
  return { subject: report.fact_subject, action: report.fact_action, object: report.fact_object,
    conditions: report.fact_conditions, evidence: report.evidence, extractedConditions: conditions,
    extractedEvidence: typeof fact.evidence === "string" ? fact.evidence : null };
}

/** Production and the real-sample evaluation use this same input builder. */
export function buildStoryDigestInput(story: { title: string; digest: string | null }, reports: DigestReport[], opts: { corrected: boolean; knownArticleIds?: string[] }) {
  const known = new Set(opts.knownArticleIds ?? []);
  const lines = reports.slice(-40).map((r) => `${opts.corrected || known.has(r.id) ? "" : "【新】"}报道 ${r.id}｜事实 ${r.fact_id}｜${beijingDate(r.at)} ${beijingTime(r.at)}｜${r.source_name}${r.first_party ? "（一手）" : ""}｜${r.title}｜${r.summary ?? ""}\n事实条件与来源证据：${JSON.stringify(digestFactEvidence(r))}`);
  return opts.corrected
    ? `事件当前标题：${story.title}\n\n报道内容或事实证据经过更正。请只依据下面这些报道的当前内容重写综述，不要沿用以前版本的说法。\n报道（按时间）：\n${lines.join("\n")}`
    : `事件当前标题：${story.title}\n${story.digest ? `上一版综述：${story.digest}\n` : ""}\n报道（按时间，标【新】的是上一版之后的新报道）：\n${lines.join("\n")}`;
}

async function digestReports(db: Db, storyId: number): Promise<DigestReport[]> {
  return db<DigestReport[]>`
    SELECT DISTINCT ON (p.article_id) p.article_id AS id, p.title, p.summary, s.name AS source_name, (s.tier = 'T1') AS first_party,
      coalesce(p.published_at, p.discovered_at) AS at, f.id AS fact_id, f.subject AS fact_subject,
      f.action AS fact_action, f.object AS fact_object, f.conditions AS fact_conditions, fa.evidence,
      an.output->'fact' AS structured_fact, an.output->'live' AS structured_live, an.output->'release' AS structured_release
    FROM facts f JOIN fact_articles fa ON fa.fact_id = f.id JOIN publications p ON p.article_id = fa.article_id
    JOIN sources s ON s.id = p.source_id LEFT JOIN analyses an ON an.id = p.analysis_id
    WHERE f.story_id = ${storyId} AND ${evidenceCondition()} AND ${listedCondition(new Date())}
    ORDER BY p.article_id, (fa.role = 'primary') DESC, f.id`;
}

function digestInputsHash(reports: DigestReport[]): string {
  return sha256(stableJson([...reports].sort((a, b) => a.id.localeCompare(b.id)).map((r) => [r.id, r.fact_id, r.title, r.summary ?? "", r.source_name, r.first_party, r.at.toISOString(), digestFactEvidence(r)])));
}

export async function composeStoryDigest(storyId: number): Promise<{ updated: boolean; version?: number }> {
  const [story] = await sql<{ id: number; title: string; digest: string | null; version: number; origin: string }[]>`
    SELECT id, title, digest, version, origin FROM stories WHERE id = ${storyId} AND merged_into IS NULL`;
  if (!story) return { updated: false };
  const reports = await digestReports(sql, storyId);
  if (reports.length === 0) {
    const cleared = await sql`UPDATE stories SET digest = NULL, latest = NULL, digest_updated_at = NULL, updated_at = now()
      WHERE id = ${storyId} AND version = ${story.version} AND merged_into IS NULL AND (digest IS NOT NULL OR latest IS NOT NULL)`;
    return { updated: cleared.count > 0 };
  }
  reports.sort((a, b) => a.at.getTime() - b.at.getTime());
  const ids = reports.map((r) => r.id).sort();
  // What this version is written from: the reports and what they currently say (corrections included).
  const inputsHash = digestInputsHash(reports);
  // 情报变更（W14）：同一批报道各自说的受控字段。它与输入指纹是两件事 —— 只改了日期（deadlines 不进
  // inputs_hash）的那一版靠它才看得出变化，而这时综述本身不重写、不收模型费。
  const snapshot = changeSnapshot(reports);
  const factsHash = changeSnapshotHash(snapshot);
  const [last] = await sql<{ article_ids: string[]; inputs_hash: string | null; facts_hash: string | null; facts: unknown; digest: string; receipt_id: number | null }[]>`
    SELECT article_ids, inputs_hash, facts_hash, facts, digest, receipt_id FROM story_digests WHERE story_id = ${storyId} ORDER BY version DESC LIMIT 1`;
  const sameReports = !!last && JSON.stringify([...last.article_ids].sort()) === JSON.stringify(ids);
  if (story.digest !== null && sameReports && last!.inputs_hash === inputsHash && last!.facts_hash === factsHash) return { updated: false };
  // Same reports, different content: an editor corrected one. A report gone from the story (withdrawn,
  // or regrouped elsewhere) likewise. Rewrite from the reports as they are now, without the previous
  // digest, so a corrected or withdrawn fact does not survive as "earlier reports said".
  const dropped = !!last && last.article_ids.some((id) => !ids.includes(id));
  const corrected = sameReports || dropped;
  const user = buildStoryDigestInput(story, reports, { corrected, knownArticleIds: last?.article_ids });
  const latest = reports[reports.length - 1]!.title;
  // 「上一版 → 当前」这一次的变化。上一版没有快照（迁移前的存量行）时清单为空，不误报「全变了」。
  const diff = diffChangeSnapshots(last?.facts ?? null, snapshot);
  // 结构化字段一处没变、只有注意事项的措辞变了时才花一次模型调用；模型关了或失败就降级成模板。
  let textChanges: StoryChange[] = [];
  let textReceipt: number | null = null;
  if (diff.items.length === 0 && diff.text && diff.anchored) {
    const worded = await wordTextChanges({
      title: story.title, added: diff.text.added, removed: diff.text.removed, itemId: diff.text.itemId,
      subject: `story:${storyId}@${ids.length}`,
    });
    textChanges = worded.items;
    textReceipt = worded.receiptId;
  }
  const changes: StoryChange[] = [...diff.items, ...textChanges];
  const changeKinds = [...new Set(changes.map((c) => c.kind))];
  // A withdrawal clears the public projection but retains its history. Restoring exactly the same
  // evidence reuses that digest through the normal version/input checks, without another model call.
  const res = last?.inputs_hash === inputsHash ? { data: { title: "", digest: last.digest }, receiptId: last.receipt_id } : await chatJson({
    model: await modelFor("digest"), purpose: "story_digest", subject: `story:${storyId}@${ids.length}`, promptVersion: DIGEST_PROMPT_VERSION,
    system: DIGEST_SYSTEM, user, schema: DigestSchema, temperature: 0.3, maxTokens: 1200,
  });
  const version = story.version + 1;
  const updated = await sql.begin(async (tx) => {
    const [current] = await tx<{ version: number; merged_into: number | null }[]>`
      SELECT version, merged_into FROM stories WHERE id = ${storyId} FOR UPDATE`;
    // Report corrections, withdrawals and membership changes do not necessarily bump the story
    // version. Compare the same input identity again after the model returns. The snapshot is
    // ordered by report time, so it has to be sorted here exactly like the one above.
    const currentReports = (await digestReports(tx, storyId)).sort((a, b) => a.at.getTime() - b.at.getTime());
    if (!current || current.version !== story.version || current.merged_into !== null
      || digestInputsHash(currentReports) !== inputsHash || changeSnapshotHash(changeSnapshot(currentReports)) !== factsHash) {
      // A paid response remains reusable even when an editor or another digest won the race.
      if (res.receiptId !== null) await completeReceipt(tx, res.receiptId);
      if (textReceipt !== null) await completeReceipt(tx, textReceipt);
      return false;
    }
    await tx`INSERT INTO story_digests (story_id, version, digest, latest, receipt_id, article_ids, inputs_hash, facts, facts_hash, changes, change_kinds)
             VALUES (${storyId}, ${version}, ${res.data.digest}, ${latest}, ${res.receiptId}, ${ids}, ${inputsHash},
                     ${sql.json(snapshot as never)}, ${factsHash}, ${sql.json(changes as never)}, ${changeKinds})`;
    await tx`UPDATE stories SET digest = ${res.data.digest}, latest = ${latest}, digest_updated_at = now(),
               title = CASE WHEN origin = 'manual' OR ${res.data.title} = '' THEN title ELSE ${res.data.title} END,
               version = ${version}, updated_at = now()
             WHERE id = ${storyId}`;
    if (res.receiptId !== null) await completeReceipt(tx, res.receiptId);
    if (textReceipt !== null) await completeReceipt(tx, textReceipt);
    return true;
  });
  return updated ? { updated: true, version } : { updated: false };
}
