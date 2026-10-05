// analyzeArticle: the judging and writing steps, each with its own prompt from the industry pack
// (industry/prompts/):
//   1. prefilter: does the material belong to this industry at all (wide recall). Only BLOCK stops an
//      item; UNKNOWN goes on like PASS (a BLOCK given while material is missing counts as UNKNOWN);
//   2. score: two independent scores against the source tier's threshold (industry/selection.ts) decide 精选;
//   3. structure: category, tags, subjects and the current news fact, beside scoring;
//   4. writing, once the structure is in: the Chinese title, summary and reason by the content
//      understanding for selected and near-selected items, by the cheaper title/summary prompts for the rest;
//   5. live: what the show itself is (name, venue, start time, last day, announced status) and which
//      ticket rounds it is taking applications for, only for Live or ticket material whose structure
//      step found a start date — lives/link.ts turns it into a Live page and lives/tickets.ts into the
//      ticket rounds the radar shows, and without a date there is no identity to derive.
// Material with only a title or a feed summary has its article page fetched before it is judged.
import { z } from "zod";
import { CATEGORY_KEYS } from "@girlsbands/contracts/taxonomy";
import { DEADLINE_KINDS, TICKET_ROUND_KINDS, type LiveStatus, type TicketRoundKind } from "@girlsbands/contracts/site";
import { glossaryHits } from "@girlsbands/industry/glossary";
import { CATEGORIES, LIVE_CATEGORIES } from "@girlsbands/industry/taxonomy";
import { SELECTION } from "@girlsbands/industry/selection";
import { sql } from "../db.ts";
import { chatJson, MODELS, ModelOutputError, type ContentPart } from "../providers/llm.ts";
import { completeReceipt, ProviderRejectedError, ReceiptUnknownError } from "../providers/receipts.ts";
import { collapseWhitespace, looksChinese } from "../lib/text.ts";
import { modelFor } from "./models.ts";
import { buildMaterial, firstImagePart, loadAnalyzeInput, type AnalyzeInputArticle } from "./input.ts";
import { pageFetchable } from "../content/extract.ts";
import { shutdownSignal } from "../jobs/queue.ts";
import {
  buildArticlePrompt, buildLongTweetPrompt, buildShortTweetPrompt, finalizeCopy, isShortTweetInput, MAX_BODY_CHARS, missingEvidence,
  needsShortTweetTranslation, parseTranslateOutput, PREFILTER_SYSTEM, prefilterUser, translateInputOf, UNDERSTAND_SYSTEM, understandUser,
  type IdentityGuard,
} from "./writing.ts";
import { CATEGORY_GUIDE, CATEGORY_TAGS, ENTITIES, ENTITY_TAGS, ITEM_TYPES, normalizeTags, TOPIC_TAGS } from "./vocabulary.ts";
import { promptText, promptVersion } from "./prompts.ts";

export { buildMaterial, loadAnalyzeInput, type AnalyzeInputArticle };

export const PROMPT_VERSIONS = {
  prefilter: promptVersion("prefilter"),
  score: promptVersion("selection-score"),
  understand: promptVersion("understand"),
  summarize: promptVersion("summarize-article", "summarize-article-empty", "summarize-short-post", "summarize-short-post-quoted", "summarize-long-post", "summarize-long-post-quoted", "identity-context"),
  structure: promptVersion("structure"),
  live: promptVersion("live-ticket"),
} as const;
/** Every step's prompt, as stored on each judgement. */
export const SELECTION_PROMPT_VERSION = [PROMPT_VERSIONS.prefilter, PROMPT_VERSIONS.score].join("+");
export const ANALYZE_PROMPT_VERSION = Object.values(PROMPT_VERSIONS).join("+");

// Scoring

/** Independent score calls per article; their sum decides, their mean (floored) is shown. */
export const SCORE_CALLS = 2;

/**
 * The thresholds on the mean score, per source tier (industry/selection.ts): selected when
 * score1 + score2 >= 2 × threshold. Tiers without a threshold are not scored for 精选.
 */
export function tierThreshold(tier: string): number | null {
  return SELECTION.thresholds[tier] ?? null;
}

/** Unselected items above this mean are written like selected ones. */
export const UNDERSTAND_FLOOR = SELECTION.understandFloor;

/**
 * Call parameters per score model. The GLM scorer runs at temperature 1 with high reasoning (the model
 * registry adds top_p and thinking) and up to 180 s per call.
 */
const SCORE_CALL: Record<string, { temperature: number; maxTokens: number; timeoutMs: number }> = {
  "glm-5.3-flash-selection": { temperature: 1, maxTokens: 65_536, timeoutMs: 180_000 },
};
const scoreCall = (model: string) => SCORE_CALL[model] ?? { temperature: 0.2, maxTokens: 1024, timeoutMs: 120_000 };

/** The score prompt: the industry's taste (industry/prompts/selection-score.md). */
export const SCORE_SYSTEM = promptText("selection-score");

export const ScoreSchema = z.object({ attentionScore: z.coerce.number().int().min(0).max(100) });

const SCORE_TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/** The score input's time: Beijing time, ISO 8601 with +08:00 (the form the prompt was tuned on). */
export function scoreInputTime(at: Date): string {
  const ms = at.getTime() % 1000;
  return `${SCORE_TIME.format(at).replace(" ", "T")}${ms ? `.${String(ms).padStart(3, "0")}` : ""}+08:00`;
}

/**
 * The score input: no source facts (the prompt forbids guessing them), the publication time, the
 * original title (items are scored before any Chinese copy exists) and the whole body.
 */
export function buildScoreInput(a: AnalyzeInputArticle): string {
  let body: string;
  if (a.xPost) {
    const quoted = a.xPost.quoted?.text ? `\n\n[引用 ${a.xPost.quoted.handle ? `@${a.xPost.quoted.handle}` : "原推文"}]：${a.xPost.quoted.text}` : "";
    body = `${String(a.xPost.text ?? "").trim()}${quoted}`.trim();
  } else {
    body = (a.bodyText ?? a.excerpt ?? "").trim();
  }
  if (!body) body = a.title;
  const at = a.publishedAt ?? a.discoveredAt ?? null;
  return [
    "请按系统规则评估以下单篇材料所代表的事件。只输出 attentionScore。",
    `【发布时间（北京时间）】\n${at ? scoreInputTime(at) : ""}`,
    `【标题】\n${a.title.trim()}`,
    `【完整正文】\n${body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body}`,
  ].join("\n\n");
}

// Step outputs

/** A date, or a date with a time on the announcement's own clock. Anything else is dropped before it
 *  reaches a reader. */
const DEADLINE_AT = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;

/** A value that is only a day, with no clock on it. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const PrefilterSchema = z.object({
  label: z.preprocess((v) => String(v ?? "").trim().toUpperCase(), z.enum(["PASS", "BLOCK", "UNKNOWN"])),
  reason: z.string().max(200).catch(""),
});

const FactSchema = z
  .object({
    title: z.string().max(80),
    subject: z.string().max(80).nullable().optional(),
    action: z.string().max(80).nullable().optional(),
    object: z.string().max(160).nullable().optional(),
    occurredAt: z.string().nullable().optional(),
    evidence: z.string().trim().max(600).nullable().catch(null),
    conditions: z.array(z.object({
      // Older reusable receipts may also contain a paraphrase. New extraction only copies evidence.
      text: z.string().trim().min(1).max(200).optional().catch(undefined),
      quote: z.string().trim().min(1).max(400),
    }).nullable().catch(null)).catch([]),
    // The deadline radar's raw material: only entries whose quote is found verbatim in the original survive.
    deadlines: z.array(z.object({
      kind: z.enum(DEADLINE_KINDS).catch("other"),
      at: z.string().trim().min(1).max(20),
      note: z.string().trim().max(60).nullable().optional().catch(null),
      quote: z.string().trim().min(1).max(400),
    }).nullable().catch(null)).catch([]),
  })
  .nullable()
  .catch(null);

export const StructureSchema = z.object({
  scope: z.enum(["single", "composite", "unknown"]).catch("unknown"),
  category: z.enum(CATEGORY_KEYS).nullable().catch(null),
  tags: z.array(z.string()).max(12).catch([]),
  subjects: z.array(z.string()).max(6).catch([]),
  fact: FactSchema,
});

/** What the show itself is (prompts/live-ticket.md). Everything but the name has to be found in the
 *  original text; a field the announcement does not state stays null. */
const LiveSchema = z.object({
  title: z.string().trim().max(80).nullable().catch(null),
  venue: z.string().trim().max(80).nullable().catch(null),
  startsTime: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().catch(null),
  endsOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  status: z.enum(["scheduled", "cancelled", "postponed"]).catch("scheduled"),
  rounds: z.array(z.object({
    kind: z.enum(TICKET_ROUND_KINDS).catch("general"),
    platform: z.string().trim().max(60).nullable().catch(null),
    applyStart: z.string().trim().regex(DEADLINE_AT).nullable().catch(null),
    applyEnd: z.string().trim().regex(DEADLINE_AT).nullable().catch(null),
    resultOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
    paymentDueOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
    // The sentence this round was read from: every other field has to be found inside it.
    quote: z.string().trim().max(600).catch(""),
  })).max(8).catch([]),
});

const UnderstandSchema = z.object({
  itemType: z.enum(ITEM_TYPES),
  authorRole: z.enum(["principal", "observer", "relayer"]).catch("relayer"),
  // The understanding prompt asks for tags; the public ones come from the structure step.
  tags: z.array(z.string()).max(12).catch([]),
  editorialJudgment: z.string().max(400).catch(""),
  titleZh: z.string().trim().min(1).max(200),
  summaryZh: z.string().trim().min(1).max(4000),
});

const SummarizeSchema = z.object({ titleZh: z.string(), summaryZh: z.string(), bodyZh: z.string() });

const ZH_COUNT = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

/** The structure step owns the public category and tags, as well as grouping evidence (filled from the pack's vocabulary). */
export const STRUCTURE_SYSTEM = promptText("structure", {
  categoryCount: ZH_COUNT[CATEGORIES.length] ?? String(CATEGORIES.length),
  categoryGuide: CATEGORY_GUIDE,
  categoryTags: CATEGORY_TAGS.join("、"),
  topicTags: TOPIC_TAGS.join("、"),
  entityTags: ENTITY_TAGS.join("、"),
  entities: Object.entries(ENTITIES).map(([id, e]) => `${id}（${e.aliases.slice(0, 3).join("/")}）`).join("，"),
});

/** What the show itself is, for Live and ticket material (industry/prompts/live-ticket.md). */
export const LIVE_SYSTEM = promptText("live-ticket");

/** Keep only quotes present both in the original material and in the text the structure model saw. */
export function normalizeStructure(data: z.infer<typeof StructureSchema>, a: AnalyzeInputArticle) {
  const visible = collapseWhitespace(buildMaterial(a));
  const originals = (a.xPost
    ? [String(a.xPost.text ?? a.title), String(a.xPost.quoted?.text ?? "")]
    : [a.bodyText ?? a.excerpt ?? ""]).map(collapseWhitespace);
  // A title is not the unseen contents of a video/article, regardless of the model's confidence.
  const scope = originals.some(Boolean) ? data.scope : "unknown";
  const grounded = (quote: string | null | undefined) => {
    const text = collapseWhitespace(quote ?? "");
    return text && visible.includes(text) && originals.some((original) => original.includes(text)) ? text : null;
  };
  const fact = !originals.some(Boolean) || scope === "composite" || !data.fact ? null : {
    ...data.fact,
    evidence: grounded(data.fact.evidence),
    conditions: data.fact.conditions.flatMap((c) => {
      if (!c) return [];
      const quote = grounded(c.quote);
      return quote ? [{ text: c.text ?? quote, quote }] : [];
    }).slice(0, 4),
    deadlines: (data.fact.deadlines ?? []).flatMap((d) => {
      if (!d || !DEADLINE_AT.test(d.at)) return [];
      const quote = grounded(d.quote);
      return quote ? [{ kind: d.kind, at: d.at, note: d.note ?? null, quote }] : [];
    }).slice(0, 6),
  };
  return {
    category: data.category, tags: normalizeTags(data.tags),
    subjects: [...new Set(data.subjects.map((s) => s.trim().toLowerCase()).filter((s) => s in ENTITIES))],
    scope, fact,
  };
}

/** One acceptance window of a live: FC 先行 opens, 一般贩售 opens, each with its own dates. */
export interface LiveRound {
  kind: TicketRoundKind;
  platform: string | null;
  applyStart: string | null;
  applyEnd: string | null;
  resultOn: string | null;
  paymentDueOn: string | null;
  /** The sentence it was read from, already checked to be in the original. */
  quote: string;
}

/** The show itself, as read from the announcement: `output.live` on the stored judgement. */
export interface LiveRead {
  title: string | null;
  venue: string | null;
  startsTime: string | null;
  endsOn: string | null;
  status: LiveStatus;
  rounds: LiveRound[];
}

/** A clock time written out in the original: `18:30`, `18時30分` and `18時30` all count. A value that
 *  carries a date too needs both halves in the text — the original writes `10月3日(金) 20:00`, not the
 *  `2026-10-03T20:00` we store, so checking the joined form alone would drop every window. */
function clockInText(text: string, value: string | null): string | null {
  if (!value) return null;
  const day = DATE_ONLY.test(value) ? value : value.includes("T") ? value.slice(0, 10) : null;
  if (day !== null && dateInText(text, day) === null) return null;
  const clock = value.includes("T") ? value.slice(11) : DATE_ONLY.test(value) ? null : value;
  if (clock === null) return value;
  const [h, m] = clock.split(":");
  const forms = [clock, `${Number(h)}:${m}`, `${Number(h)}時${Number(m)}分`, `${Number(h)}時${Number(m)}`];
  return forms.some((f) => text.includes(f)) ? value : null;
}

/** A date written out in the original: ISO, `2026/11/3`, `2026年11月3日`, `11月3日`. */
function dateInText(text: string, value: string | null): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-");
  const forms = [value, `${y}/${m}/${d}`, `${y}年${Number(m)}月${Number(d)}日`, `${Number(m)}月${Number(d)}日`];
  return forms.some((f) => text.includes(f)) ? value : null;
}

/** The platform named, in the glossary's own writing (`ローチケ` → `ローソンチケット`), else as stated. */
function platformOf(stated: string | null, text: string): string | null {
  if (stated) return glossaryHits(stated, ["platform"])[0]?.forms[0] ?? stated;
  const hits = glossaryHits(text, ["platform"]);
  return hits.length === 1 ? (hits[0]!.forms[0] ?? null) : null;
}

/**
 * Keep the rounds the announcement really states. A round only exists when the sentence it was read
 * from is in the original, and each date has to be found in that sentence — so a "通常是这样" date the
 * model filled in is dropped rather than shown as something to plan around. A round with nothing left
 * is no round at all.
 */
export function normalizeRounds(rounds: z.infer<typeof LiveSchema>["rounds"], text: string): LiveRound[] {
  const seen = new Set<string>();
  const out: LiveRound[] = [];
  for (const r of rounds) {
    const quote = collapseWhitespace(r.quote);
    if (!quote || !text.includes(quote)) continue;
    const key = `${r.kind}|${r.applyStart ?? ""}`;
    if (seen.has(key)) continue;
    const round: LiveRound = {
      kind: r.kind,
      platform: platformOf(r.platform, text),
      applyStart: clockInText(quote, r.applyStart),
      applyEnd: clockInText(quote, r.applyEnd),
      resultOn: dateInText(quote, r.resultOn),
      paymentDueOn: dateInText(quote, r.paymentDueOn),
      quote,
    };
    if (!round.platform && !round.applyStart && !round.applyEnd && !round.resultOn && !round.paymentDueOn) continue;
    seen.add(key);
    out.push(round);
    if (out.length === 6) break;
  }
  return out;
}

/**
 * Keep only what the announcement actually states. A venue or a start time the model "knows" about the
 * tour but that is not in the text is dropped, so one show never borrows another's venue. The name is
 * the reader-facing Chinese one and is not checked against the text; nothing at all readable means no
 * live section at all.
 */
export function normalizeLive(data: z.infer<typeof LiveSchema>, a: AnalyzeInputArticle): LiveRead | null {
  const text = collapseWhitespace(buildMaterial(a));
  const title = data.title ?? null;
  const venue = data.venue && text.includes(collapseWhitespace(data.venue)) ? data.venue : null;
  const startsTime = clockInText(text, data.startsTime);
  const endsOn = dateInText(text, data.endsOn);
  // Only an announcement that says so can cancel or postpone a show.
  const status = data.status === "scheduled" || /中止|延期|振替|見送|キャンセル|cancel|取消|推迟/i.test(text) ? data.status : "scheduled";
  const rounds = normalizeRounds(data.rounds, text);
  return title || venue || startsTime || endsOn || rounds.length > 0 ? { title, venue, startsTime, endsOn, status, rounds } : null;
}

/** The live step only has something to say about Live or ticket material with a start date to key on. */
export function readsLive(category: string | null, fact: { deadlines?: readonly { kind: string }[] | null } | null): boolean {
  return !!category && LIVE_CATEGORIES.has(category) && !!fact?.deadlines?.some((d) => d?.kind === "event");
}

export interface AnalysisRun {
  prefilter: { label: "PASS" | "BLOCK" | "UNKNOWN"; reason: string; model: string; receiptId: number; reused: boolean };
  /**
   * The independent score calls and the tier threshold they are held against; absent when the material
   * is not scored. `refused`: the model's content filter declined it, so it is not selected.
   */
  scores: { model: string; threshold: number; values: number[]; receiptIds: number[]; reused: boolean; refused?: boolean } | null;
  /** The reader-facing copy: `understand` (selected, near-selected), `summarize`, `verbatim` (a Chinese short post), `none`. */
  writing: {
    kind: "understand" | "summarize" | "verbatim" | "none";
    model: string | null;
    titleZh: string;
    summaryZh: string;
    reasonZh: string | null;
    itemType?: string;
    authorRole?: string;
    identityGuard?: IdentityGuard;
    receiptIds: number[];
    reused: boolean;
  } | null;
  structure: (ReturnType<typeof normalizeStructure> & { model: string; receiptId: number; reused: boolean }) | null;
  /** What the show itself is; null when the material is not a Live, or states nothing about it. */
  live: (LiveRead & { model: string; receiptId: number; reused: boolean }) | null;
}

const isContentFilter = (error: unknown) => error instanceof ProviderRejectedError && !error.retryable && /contentFilter|"1301"/.test(error.message);

/** Only a title or a feed summary, and a page to fetch: the article is judged on the page. */
export function waitsForPage(a: AnalyzeInputArticle): boolean {
  return a.bodyStatus === "pending" && !a.bodyText && !a.xPost && pageFetchable(a.url, a.source.kind);
}

type StepOpts = { attemptTag?: string; scoreModel?: string };
type ReceiptObserver = (receiptId: number) => void;
export class AnalysisInterruptedError extends Error {}

const observableReceiptId = (error: unknown): number | null =>
  error instanceof ModelOutputError || error instanceof ReceiptUnknownError ? error.receiptId : null;

function checkAnalysisRunning() {
  if (shutdownSignal.signal.aborted) throw new AnalysisInterruptedError("worker shutting down between analysis stages");
}

const subjectOf = (a: AnalyzeInputArticle) => `article:${a.id}@${a.revision}`;
const tagged = (attemptTag: string | undefined, step: string) => [attemptTag, step].filter(Boolean).join(":") || undefined;

async function runPrefilter(a: AnalyzeInputArticle, opts: StepOpts): Promise<AnalysisRun["prefilter"]> {
  const model = await modelFor("prefilter");
  checkAnalysisRunning();
  const res = await chatJson({
    model,
    purpose: "prefilter_article",
    subject: subjectOf(a),
    promptVersion: PROMPT_VERSIONS.prefilter,
    system: PREFILTER_SYSTEM,
    user: prefilterUser(a),
    schema: PrefilterSchema,
    temperature: 0,
    maxTokens: 512,
    attemptTag: opts.attemptTag,
  });
  // A BLOCK without material to back it counts as UNKNOWN (which goes on).
  const label = res.data.label === "BLOCK" && missingEvidence(a) ? "UNKNOWN" : res.data.label;
  return { label, reason: res.data.reason, model: res.model, receiptId: res.receiptId, reused: res.reused };
}

/** The production prefilter step, exposed separately so SelectBench can preserve partial receipt evidence. */
export async function runSelectionPrefilter(
  a: AnalyzeInputArticle,
  opts: StepOpts = {},
  onReceipt?: ReceiptObserver,
): Promise<AnalysisRun["prefilter"]> {
  try {
    const result = await runPrefilter(a, opts);
    onReceipt?.(result.receiptId);
    return result;
  } catch (error) {
    const receiptId = observableReceiptId(error);
    if (receiptId !== null) onReceipt?.(receiptId);
    throw error;
  }
}

async function runScores(
  a: AnalyzeInputArticle,
  threshold: number,
  opts: StepOpts,
  onReceipt?: ReceiptObserver,
): Promise<NonNullable<AnalysisRun["scores"]>> {
  const model = opts.scoreModel ?? (await modelFor("score"));
  const call = scoreCall(model);
  const input = buildScoreInput(a);
  const values: number[] = [];
  const receiptIds: number[] = [];
  let reused = true;
  // One after the other: the second call reuses the provider's cached prompt.
  for (let i = 0; i < SCORE_CALLS; i++) {
    checkAnalysisRunning();
    try {
      const res = await chatJson({
        model, purpose: "score_article", subject: subjectOf(a), promptVersion: PROMPT_VERSIONS.score, system: SCORE_SYSTEM, user: input,
        schema: ScoreSchema, temperature: call.temperature, maxTokens: call.maxTokens, timeoutMs: call.timeoutMs,
        // Each call is its own paid request; an explicit re-evaluation gets new ones.
        attemptTag: tagged(opts.attemptTag, `score-${i + 1}`),
      });
      onReceipt?.(res.receiptId);
      values.push(res.data.attentionScore);
      receiptIds.push(res.receiptId);
      reused &&= res.reused;
    } catch (error) {
      const receiptId = observableReceiptId(error);
      if (receiptId !== null) onReceipt?.(receiptId);
      // The model's content filter declines the material (Zhipu 1301): not scored, so not selected.
      if (isContentFilter(error)) return { model, threshold, values, receiptIds, reused: false, refused: true };
      throw error;
    }
  }
  return { model, threshold, values, receiptIds, reused };
}

/** The production score step; its threshold stays case-specific even when an evaluator shares model output. */
export async function runSelectionScores(
  a: AnalyzeInputArticle,
  opts: StepOpts = {},
  onReceipt?: ReceiptObserver,
): Promise<AnalysisRun["scores"]> {
  const threshold = tierThreshold(a.source.tier);
  return threshold === null ? null : runScores(a, threshold, opts, onReceipt);
}

export async function runStructure(a: AnalyzeInputArticle, opts: StepOpts = {}): Promise<NonNullable<AnalysisRun["structure"]>> {
  const model = await modelFor("structure");
  checkAnalysisRunning();
  const res = await chatJson({
    model,
    purpose: "structure_article",
    subject: subjectOf(a),
    promptVersion: PROMPT_VERSIONS.structure,
    system: STRUCTURE_SYSTEM,
    user: buildMaterial(a),
    schema: StructureSchema,
    temperature: 0.2,
    maxTokens: 1200,
    attemptTag: tagged(opts.attemptTag, "structure"),
  });
  return { ...normalizeStructure(res.data, a), model: res.model, receiptId: res.receiptId, reused: res.reused };
}

/** What the show itself is: the name, the venue, the start time, the last day, the announced status. */
export async function runLiveTicket(
  a: AnalyzeInputArticle,
  structure: NonNullable<AnalysisRun["structure"]>,
  opts: StepOpts = {},
): Promise<AnalysisRun["live"]> {
  // Same kind of work as the structure step (extraction only, no reader-facing prose), so it runs on
  // the same model rather than a capability of its own with another switch to configure.
  const model = await modelFor("structure");
  checkAnalysisRunning();
  // The dates the structure step already found tell the model which day this report is about.
  const dates = (structure.fact?.deadlines ?? []).map((d) => `${d.kind} ${d.at}${d.note ? ` ${d.note}` : ""}`).join("\n");
  const material = buildMaterial(a);
  const res = await chatJson({
    model,
    purpose: "live_ticket_article",
    subject: subjectOf(a),
    promptVersion: PROMPT_VERSIONS.live,
    system: LIVE_SYSTEM,
    user: dates ? `${material}\n\n【结构步骤已抽出的日期】\n${dates}` : material,
    schema: LiveSchema,
    temperature: 0,
    maxTokens: 400,
    attemptTag: tagged(opts.attemptTag, "live"),
  });
  const live = normalizeLive(res.data, a);
  // Nothing readable about the show: leave no live section behind, rather than an empty one.
  return live ? { ...live, model: res.model, receiptId: res.receiptId, reused: res.reused } : null;
}

/** Content understanding grounded in the original; null on a content-filter refusal. */
export async function runUnderstand(a: AnalyzeInputArticle, opts: StepOpts = {}, note?: string): Promise<AnalysisRun["writing"]> {
  const model = await modelFor("understand");
  const text = understandUser(a) + (note ? `\n\n${note}` : "");
  const call = (image: ContentPart | null) => {
    checkAnalysisRunning();
    return chatJson({
      model, purpose: "understand_article", subject: subjectOf(a), promptVersion: PROMPT_VERSIONS.understand, system: UNDERSTAND_SYSTEM,
      user: image ? [{ type: "text", text }, image] : text, schema: UnderstandSchema, temperature: 0.2, maxTokens: 16_384,
      timeoutMs: 180_000, attemptTag: tagged(opts.attemptTag, "understand"),
    });
  };
  // A model that is known not to read images gets the text only.
  const image = MODELS[model]?.vision === false ? null : await firstImagePart(a);
  let res: Awaited<ReturnType<typeof call>>;
  try {
    res = await call(image);
  } catch (error) {
    if (isContentFilter(error)) return null;
    // The model refused the image (download, format): the text is written without it.
    if (!image || !(error instanceof ProviderRejectedError) || error.retryable) throw error;
    try {
      res = await call(null);
    } catch (retryError) {
      if (isContentFilter(retryError)) return null;
      throw retryError;
    }
  }
  const d = res.data;
  const copy = finalizeCopy(translateInputOf(a), { titleZh: d.titleZh, summaryZh: d.summaryZh });
  return {
    kind: "understand", model: res.model, titleZh: copy.titleZh, summaryZh: copy.summaryZh, reasonZh: d.editorialJudgment.trim() || null,
    itemType: d.itemType, authorRole: d.authorRole, identityGuard: copy.identityGuard, receiptIds: [res.receiptId], reused: res.reused,
  };
}

/** The title/summary prompts (articles, long and short posts). */
async function runSummarize(a: AnalyzeInputArticle, opts: StepOpts, note?: string): Promise<NonNullable<AnalysisRun["writing"]>> {
  const t = translateInputOf(a);
  const isX = t.sourceKind === "x_search";
  const short = isShortTweetInput(t);
  const main = collapseWhitespace(t.mainText || t.title);
  const plain = { reasonZh: null, receiptIds: [] as number[], reused: true };
  // A short post already in Chinese is its own copy, and too little text is not written up from a title.
  if (short && !needsShortTweetTranslation(main)) return { kind: "verbatim", model: null, titleZh: main, summaryZh: main, ...plain };
  if (!short && t.text.trim().length < 20) return { kind: "none", model: null, titleZh: looksChinese(t.title) ? t.title : "", summaryZh: "", ...plain };
  const model = await modelFor("summarize");
  checkAnalysisRunning();
  const user = short ? buildShortTweetPrompt(t) : isX ? buildLongTweetPrompt(t) : buildArticlePrompt(t);
  const res = await chatJson({
    model,
    purpose: "summarize_article",
    subject: subjectOf(a),
    promptVersion: PROMPT_VERSIONS.summarize,
    system: "",
    user: note ? `${user}\n\n${note}` : user,
    schema: SummarizeSchema,
    json: false,
    parse: parseTranslateOutput,
    temperature: 0.2,
    maxTokens: 2048,
    attemptTag: tagged(opts.attemptTag, "summarize"),
  });
  const p = res.data;
  const draft = short
    ? { titleZh: p.titleZh || (looksChinese(main) ? main : ""), summaryZh: p.bodyZh || p.summaryZh }
    : isX
      ? { titleZh: p.titleZh, summaryZh: p.summaryZh || p.bodyZh }
      : { titleZh: p.titleZh || (looksChinese(t.title) ? t.title : ""), summaryZh: p.summaryZh };
  const copy = finalizeCopy(t, draft);
  return { kind: "summarize", model: res.model, titleZh: copy.titleZh, summaryZh: copy.summaryZh, reasonZh: null, identityGuard: copy.identityGuard, receiptIds: [res.receiptId], reused: res.reused };
}

/** Why an item that passed the prefilter is not on the site, as the runs page and the alert show it. */
export const NO_COPY_ERROR = "写作步骤没有给出中文标题或摘要，已重试一次";

/** What a reader of this site needs from the copy step: a Chinese title, and a summary under it. */
const hasCopy = (w: AnalysisRun["writing"] | null | undefined): boolean =>
  !!collapseWhitespace(w?.titleZh ?? "") && !!(w?.summaryZh ?? "").trim();

/**
 * Nothing goes on the site without Chinese copy, so an item whose writer returned no usable title or
 * summary is asked once more — as a new paid request, because repeating the same one would only replay
 * its receipt and get the same answer back. What went wrong is said to the model in the retry. A
 * verbatim or too-short item had no model writing it and there is nothing to write from: left alone.
 */
async function ensureCopy(a: AnalyzeInputArticle, opts: StepOpts, wrote: AnalysisRun["writing"]): Promise<AnalysisRun["writing"]> {
  if (hasCopy(wrote) || !wrote || wrote.kind === "verbatim" || wrote.kind === "none") return wrote;
  const note = wrote.identityGuard?.outcome === "fallback"
    ? "上一次的中文标题里出现了原文没有提到的名字，整条被丢弃了。请只用原文里确实出现的名字重写标题和摘要。"
    : "上一次没有给出可用的中文标题或摘要。标题必须是有信息量的中文，摘要要回答这条消息说了什么。";
  const retry = { ...opts, attemptTag: tagged(opts.attemptTag, "copy-retry") };
  const again = wrote.kind === "understand" ? await runUnderstand(a, retry, note) : await runSummarize(a, retry, note);
  if (!again || !hasCopy(again)) return wrote;
  // Both receipts are kept: the first request was paid for too, and it is why the second one ran.
  const receipts = [...wrote.receiptIds, ...again.receiptIds];
  const reused = wrote.reused && again.reused;
  return { ...again, receiptIds: receipts, reused };
}

/** Runs the steps on the material as it is (or reuses their receipts) without writing business results. */
export async function runAnalysis(a: AnalyzeInputArticle, opts: StepOpts = {}): Promise<AnalysisRun> {
  checkAnalysisRunning();
  const prefilter = await runSelectionPrefilter(a, opts);
  // UNKNOWN is let through (its material is as complete as it will get); BLOCK stops here.
  if (prefilter.label === "BLOCK") return { prefilter, scores: null, writing: null, structure: null, live: null };
  // The structure step needs nothing from the scores: it runs beside them.
  const structure = runStructure(a, opts).then((value) => ({ value }), (error: unknown) => ({ error }));
  try {
    const scores = await runSelectionScores(a, opts);
    const sum = scores && !scores.refused && scores.values.length === SCORE_CALLS ? scores.values.reduce((total, v) => total + v, 0) : null;
    const near = sum !== null && (sum >= scores!.threshold * SCORE_CALLS || sum > UNDERSTAND_FLOOR * SCORE_CALLS);
    const s = await structure;
    if ("error" in s) throw s.error;
    const wrote = (near ? await runUnderstand(a, opts) : null) ?? (await runSummarize(a, opts));
    const writing = await ensureCopy(a, opts, wrote);
    // Only a Live or ticket announcement with a start date has a show to describe: the date is what the
    // Live identity is keyed on (lives/link.ts), so reading the rest of it without one buys nothing.
    const live = readsLive(s.value.category, s.value.fact) ? await runLiveTicket(a, s.value, opts) : null;
    return { prefilter, scores, writing, structure: s.value, live };
  } finally {
    // A score/writing error or deploy must not let the job finish while a paid structure request
    // still owns a response. It settles and stores its receipt before shutdown can close the DB.
    await structure;
  }
}

/** One judgement from the steps: the selection rule, the reader-facing copy and the structure. */
export function normalizeAnalysis(run: AnalysisRun) {
  const label = run.prefilter.label;
  const titleZh = collapseWhitespace(run.writing?.titleZh ?? "");
  const summaryZh = (run.writing?.summaryZh ?? "").trim();
  // Past the prefilter (PASS or UNKNOWN) an item is relevant, but without a usable Chinese title and
  // summary it cannot be published: it is marked failed rather than parked in "analyzed".
  const relevance = label === "BLOCK" ? "block" : run.writing && (!titleZh || !summaryZh) ? "unknown" : "pass";
  // Selected when the two scores add up to twice the tier threshold; the mean, floored, is the score
  // shown (it never decides a half point on its own).
  const values = run.scores && !run.scores.refused ? run.scores.values : null;
  const sum = values?.length === SCORE_CALLS ? values.reduce((total, v) => total + v, 0) : null;
  const score = sum === null ? null : Math.floor(sum / SCORE_CALLS);
  const threshold = run.scores?.threshold ?? null;
  const selected = relevance === "pass" && sum !== null && threshold !== null && sum >= threshold * SCORE_CALLS;
  const subjects = run.structure?.subjects ?? [];
  const tags = [...(run.structure?.tags ?? [])];
  for (const s of subjects) {
    const display = ENTITIES[s]?.displayTag;
    if (display && !tags.includes(display)) tags.push(display);
  }
  return {
    relevance,
    selected,
    score,
    scores: values,
    scoreModel: run.scores?.model ?? null,
    scoreRefused: run.scores?.refused ?? false,
    threshold,
    category: run.structure?.category ?? null,
    tags,
    subjects,
    titleZh,
    summaryZh,
    reasonZh: run.writing?.reasonZh ?? null,
    scope: run.structure?.scope ?? "unknown",
    fact: run.structure?.fact ?? null,
  };
}

export interface AnalyzeResult {
  analysisId: number | null;
  stale: boolean;
  /** The article page is to be fetched first; nothing was committed. */
  needsBody?: boolean;
  output: ReturnType<typeof normalizeAnalysis> | null;
  receiptIds: number[];
  reused: boolean;
}

/**
 * Analyses the current revision and commits the judgement. A result computed for an older revision
 * is kept for traceability but never overwrites a newer input (stale = true).
 */
export async function analyzeArticle(articleId: string, opts: StepOpts = {}): Promise<AnalyzeResult | null> {
  const input = await loadAnalyzeInput(articleId);
  if (!input) return null;
  // Its page first; extraction queues the analysis again (normally the queue already routed it there).
  if (waitsForPage(input)) return { analysisId: null, stale: false, needsBody: true, output: null, receiptIds: [], reused: true };
  const run = await runAnalysis(input, opts);
  const out = normalizeAnalysis(run);
  const receiptIds = [
    run.prefilter.receiptId, ...(run.scores?.receiptIds ?? []), ...(run.writing?.receiptIds ?? []), ...(run.structure ? [run.structure.receiptId] : []),
    ...(run.live ? [run.live.receiptId] : []),
  ];
  const w = run.writing;
  const detail = {
    prefilter: { label: run.prefilter.label, reason: run.prefilter.reason },
    scores: out.scores, scoreModel: out.scoreModel, threshold: out.threshold, ...(out.scoreRefused ? { scoreRefused: true } : {}),
    ...(w ? { writer: w.kind, writerModel: w.model, itemType: w.itemType ?? null, authorRole: w.authorRole ?? null } : {}),
    ...(w?.identityGuard?.outcome === "fallback" ? { identityGuard: w.identityGuard } : {}),
    scope: out.scope, fact: out.fact,
    // What the show itself is (Live and ticket material only); lives/link.ts reads it back to name a
    // Live, and lives/tickets.ts turns `rounds` into the acceptance windows the radar shows.
    ...(run.live ? {
      live: {
        title: run.live.title, venue: run.live.venue, startsTime: run.live.startsTime, endsOn: run.live.endsOn,
        status: run.live.status, rounds: run.live.rounds,
      },
    } : {}),
  };
  const committed = await sql.begin(async (tx) => {
    const [current] = await tx<{ revision: number }[]>`SELECT revision FROM articles WHERE id = ${articleId} FOR UPDATE`;
    const stale = !current || current.revision !== input.revision;
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO analyses (article_id, input_revision, origin, model, prompt_version, receipt_ids, relevance, category, tags,
        subjects, title_zh, summary_zh, reason_zh, score, selected, output)
      VALUES (${articleId}, ${input.revision}, 'model', ${w?.model ?? run.prefilter.model}, ${ANALYZE_PROMPT_VERSION}, ${receiptIds},
        ${out.relevance}, ${out.category}, ${out.tags}, ${out.subjects}, ${out.titleZh}, ${out.summaryZh}, ${out.reasonZh},
        ${out.score}, ${out.selected}, ${tx.json(detail as never)})
      RETURNING id`;
    for (const id of receiptIds) await completeReceipt(tx, id);
    if (!stale) {
      // Past the prefilter an item is relevant, but without Chinese copy it cannot go on the site.
      // "analyzed" is terminal and nothing sweeps it again, so an item a writer gave no copy for twice
      // would disappear silently; "failed" puts it on the runs page and in the ops alert, where the
      // owner can see it and retry it. Material too thin to write up at all is not that: nothing ran.
      const gaveUp = out.relevance === "unknown" && (w?.kind === "understand" || w?.kind === "summarize");
      const state = out.relevance === "block" ? "blocked" : gaveUp ? "failed" : "analyzed";
      await tx`UPDATE articles SET processing_state = ${state}, processing_error = ${gaveUp ? NO_COPY_ERROR : null} WHERE id = ${articleId}`;
    }
    return { analysisId: row!.id, stale };
  });
  const reused = run.prefilter.reused && (run.scores?.reused ?? true) && (w?.reused ?? true) && (run.structure?.reused ?? true)
    && (run.live?.reused ?? true);
  return { analysisId: committed.analysisId, stale: committed.stale, output: out, receiptIds, reused };
}
