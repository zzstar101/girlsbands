// Historical content review, read-only. It takes rows exported from the public projection and marks
// what a person still has to check: pairs whose titles look alike or that quote the same post, and the
// daily-lane rows today's rules would keep, move out, or exclude. No pair is declared a duplicate,
// nothing is merged or reclassified, and no input row is changed. The export it reads is produced by
// scripts/export-content-review.sql; the CLI is scripts/preview-content-review.ts.

export type ReviewScope = "single" | "composite" | "unknown";

/** One exported public row. Field names match the SQL aliases and the JSONL lines the CLI reads. */
export interface ReviewRow {
  id: string;
  title: string;
  summary: string | null;
  category: string | null;
  selected: boolean;
  eligible: boolean;
  /** Internal fact id; `null` when the report holds no fact. */
  factId: number | null;
  /** Public fact id, kept for review notes because the internal id is not stable across imports. */
  factPublicId?: string | null;
  factVersion?: number | null;
  scope: ReviewScope;
  /** Source is a member account: the same predicate as publication/scope.ts memberSourceCondition. */
  member: boolean;
  /** An X repost: the post carries `x_post.retweetedBy` as an object. */
  retweet: boolean;
  quotedUrl: string | null;
  originalUrl: string;
  sourceName: string;
  /** Original body, already truncated to 6000 characters by the export. */
  body: string;
  revision: number;
  timelineAt?: string | null;
}

export type DuplicateReason = "shared-quote" | "similar-title";

export interface ReviewEvidence {
  id: string;
  title: string;
  summary: string | null;
  originalUrl: string;
  sourceName: string;
  factId: number | null;
  factPublicId: string | null;
  factVersion: number | null;
  revision: number;
  scope: ReviewScope;
  timelineAt: string | null;
}

/**
 * A pair for a person to review. `status` is always `needs-review`: a shared quote, a similar title or
 * a shared fact is evidence, never permission to merge. `reason` is the strongest signal found.
 */
export interface DuplicateCandidate {
  a: string;
  b: string;
  reason: DuplicateReason;
  status: "needs-review";
  detail: string;
  /** 0..1, only for `similar-title`. */
  similarity?: number;
  /** Only for `shared-quote`; may be a non-HTTP string, so renderers must not link it blindly. */
  sharedQuotedUrl?: string;
  evidence: { a: ReviewEvidence; b: ReviewEvidence };
}

/** A signal conflict on a daily-lane row. It only asks for a human look; the category is not changed. */
export interface DailyReviewHint {
  id: string;
  reason: string;
}

export interface DailyLane {
  /** Member posts in the daily category, kept as daily. */
  keep: string[];
  /** Member posts that are not daily: work messages that must leave the daily lane. */
  removeWork: string[];
  /** Pure reposts, excluded from daily regardless of category. */
  removeReposts: string[];
  /** Conflicts that need a person, never an automatic reclassification. */
  review: DailyReviewHint[];
  /** Evidence for every member row above, so the JSON preview is self-contained. */
  evidence: ReviewEvidence[];
}

export interface ContentReviewCounts {
  rows: number;
  duplicateCandidates: number;
  dailyKeep: number;
  dailyRemoveWork: number;
  dailyRemoveReposts: number;
  dailyReview: number;
}

export interface ContentReview {
  rowCount: number;
  duplicateCandidates: DuplicateCandidate[];
  dailyLane: DailyLane;
  counts: ContentReviewCounts;
}

/** Titles shorter than this only count when normalized exactly (a two-character title matches noise). */
const MIN_EXACT_TITLE = 4;
/** Near-duplicate titles need this many normalized characters and this Dice score. */
const MIN_NEAR_TITLE = 10;
const NEAR_TITLE_AT = 0.9;

export function buildContentReview(rows: readonly ReviewRow[]): ContentReview {
  const byPair = new Map<string, DuplicateCandidate>();
  const shapes = new Map<string, string>();
  const grams = new Map<string, Set<string>>();

  for (const row of rows) {
    const shape = titleShape(row.title);
    shapes.set(row.id, shape);
    if (shape.length >= MIN_NEAR_TITLE) grams.set(row.id, bigrams(shape));
  }

  const addPair = (first: ReviewRow, second: ReviewRow, reason: DuplicateReason, extra: { similarity?: number; sharedQuotedUrl?: string } = {}) => {
    if (first.id === second.id || !first.selected || !second.selected) return;
    const [a, b] = first.id < second.id ? [first, second] : [second, first];
    // Same fact + both single means the selected seat already folded them: nothing left to review.
    if (isFolded(a, b)) return;
    const key = pairKey(a.id, b.id);
    // Earlier passes hold the stronger evidence: shared quote, then similar title.
    if (byPair.has(key)) return;
    byPair.set(key, {
      a: a.id,
      b: b.id,
      reason,
      status: "needs-review",
      detail: detailOf(reason, extra),
      ...(extra.similarity !== undefined ? { similarity: extra.similarity } : {}),
      ...(extra.sharedQuotedUrl !== undefined ? { sharedQuotedUrl: extra.sharedQuotedUrl } : {}),
      evidence: { a: evidenceOf(a), b: evidenceOf(b) },
    });
  };

  // 1. The same quoted announcement. This is evidence of overlap, not of one fact: a follow-up can
  // quote the original announcement while adding a new development.
  for (const group of groupsBy(rows, (row) => quotedKey(row.quotedUrl))) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const url = group[i]!.quotedUrl!.trim();
        addPair(group[i]!, group[j]!, "shared-quote", { sharedQuotedUrl: url });
      }
    }
  }

  // 2. Similar normalized titles. Only flagged; a high score is not a merge decision.
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!;
    const aShape = shapes.get(a.id) ?? "";
    if (aShape.length < MIN_EXACT_TITLE) continue;
    const aGrams = grams.get(a.id);
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j]!;
      const bShape = shapes.get(b.id) ?? "";
      if (bShape.length < MIN_EXACT_TITLE) continue;
      let similarity: number;
      if (aShape === bShape) similarity = 1;
      else {
        // Dice cannot reach 0.9 when lengths differ by much; skip the set work for those pairs.
        if (Math.min(aShape.length, bShape.length) / Math.max(aShape.length, bShape.length) < 0.75) continue;
        const bGrams = grams.get(b.id);
        if (!aGrams || !bGrams) continue;
        similarity = dice(aGrams, bGrams);
      }
      if (similarity < NEAR_TITLE_AT) continue;
      addPair(a, b, "similar-title", { similarity: Math.round(similarity * 100) / 100 });
    }
  }

  const duplicateCandidates = [...byPair.values()].sort((x, y) => compareText(x.a, y.a) || compareText(x.b, y.b));
  const dailyLane = buildDailyLane(rows);
  return { rowCount: rows.length, duplicateCandidates, dailyLane, counts: countsOf(rows.length, duplicateCandidates, dailyLane) };
}

function buildDailyLane(rows: readonly ReviewRow[]): DailyLane {
  const lane: DailyLane = { keep: [], removeWork: [], removeReposts: [], review: [], evidence: [] };
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.member) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    lane.evidence.push(evidenceOf(row));
    if (row.retweet) {
      lane.removeReposts.push(row.id);
      continue;
    }
    if (row.category === "daily") {
      lane.keep.push(row.id);
      // A daily post that is also selected or pool-eligible carries two conflicting signals: it may
      // hold substantive work information. Only say so; never move it automatically.
      if (row.selected || row.eligible) {
        lane.review.push({
          id: row.id,
          reason: "daily 分类同时带精选或入池标记：可能含实质工作信息，需人工确认是否只发消息，本次不自动改分类。",
        });
      }
      continue;
    }
    lane.removeWork.push(row.id);
  }
  return lane;
}

function countsOf(rowCount: number, candidates: readonly DuplicateCandidate[], lane: DailyLane): ContentReviewCounts {
  return {
    rows: rowCount,
    duplicateCandidates: candidates.length,
    dailyKeep: lane.keep.length,
    dailyRemoveWork: lane.removeWork.length,
    dailyRemoveReposts: lane.removeReposts.length,
    dailyReview: lane.review.length,
  };
}

function isFolded(a: ReviewRow, b: ReviewRow): boolean {
  return a.factId !== null && a.factId === b.factId && a.scope === "single" && b.scope === "single";
}

function pairKey(a: string, b: string): string {
  return `${a}\u0000${b}`;
}

function evidenceOf(row: ReviewRow): ReviewEvidence {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    originalUrl: row.originalUrl,
    sourceName: row.sourceName,
    factId: row.factId,
    factPublicId: row.factPublicId ?? null,
    factVersion: row.factVersion ?? null,
    revision: row.revision,
    scope: row.scope,
    timelineAt: row.timelineAt ?? null,
  };
}

function detailOf(reason: DuplicateReason, extra: { similarity?: number }): string {
  switch (reason) {
    case "shared-quote":
      return "两条内容引用同一原帖；同引用不等于同一事实，需人工打开原帖核对后再决定。";
    case "similar-title":
      return `标题规范化后相似度约 ${Math.round((extra.similarity ?? 0) * 100)}%；不足以自动合并，仅提示人工核对。`;
  }
}

function quotedKey(url: string | null | undefined): string | null {
  const value = url?.trim();
  return value ? value : null;
}

/** Groups rows by a non-null key, preserving input order inside each group. */
function groupsBy<T>(rows: readonly T[], keyOf: (row: T) => string | null): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()];
}

/** NFKC + lowercase, URLs and punctuation/symbols removed: dates and names still differ. */
function titleShape(title: string): string {
  return String(title ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < text.length; i++) out.add(text.slice(i, i + 2));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const gram of small) if (large.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// JSONL input and Markdown output
// ---------------------------------------------------------------------------

/**
 * Reads the export: one ReviewRow per line, or a JSON array (handy for small hand-written samples).
 * Unknown keys are dropped and every field is checked, so a truncated export fails with its line
 * number instead of silently producing a misleading preview.
 */
export function parseReviewRows(text: string): ReviewRow[] {
  const source = String(text ?? "").replace(/^\uFEFF/, "").trim();
  if (!source) return [];
  if (source.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(`输入不是合法的 JSON 数组：${errorText(error)}`);
    }
    if (!Array.isArray(parsed)) throw new Error("输入不是 ReviewRow 数组");
    return parsed.map((value, index) => readRow(value, `第 ${index + 1} 项`));
  }
  const rows: ReviewRow[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`第 ${i + 1} 行不是合法的 JSON：${errorText(error)}`);
    }
    rows.push(readRow(value, `第 ${i + 1} 行`));
  }
  return rows;
}

function readRow(value: unknown, where: string): ReviewRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where}不是对象`);
  const v = value as Record<string, unknown>;
  const text = (key: string, optional = false): string | null => {
    const field = v[key];
    if (typeof field === "string") return field;
    if (field === null || field === undefined) {
      if (optional) return null;
    }
    throw new Error(`${where}的 ${key} 必须是字符串${optional ? "或 null" : ""}`);
  };
  const flag = (key: string): boolean => {
    const field = v[key];
    if (typeof field === "boolean") return field;
    throw new Error(`${where}的 ${key} 必须是布尔值`);
  };
  const integer = (key: string, optional = false): number | null => {
    const field = v[key];
    if (typeof field === "number" && Number.isSafeInteger(field)) return field;
    if (field === null || field === undefined) {
      if (optional) return null;
    }
    throw new Error(`${where}的 ${key} 必须是整数${optional ? "或 null" : ""}`);
  };
  const scope = v.scope;
  if (scope !== "single" && scope !== "composite" && scope !== "unknown" && scope !== null && scope !== undefined) {
    throw new Error(`${where}的 scope 必须是 single、composite 或 unknown`);
  }
  const id = text("id", false)!;
  if (!id) throw new Error(`${where}的 id 不能为空`);
  const title = text("title", false)!;
  const originalUrl = text("originalUrl", false)!;
  const sourceName = text("sourceName", false)!;
  return {
    id,
    title,
    summary: text("summary", true),
    category: text("category", true),
    selected: flag("selected"),
    eligible: flag("eligible"),
    factId: integer("factId", true),
    factPublicId: text("factPublicId", true),
    factVersion: integer("factVersion", true),
    scope: scope === "single" || scope === "composite" ? scope : "unknown",
    member: flag("member"),
    retweet: flag("retweet"),
    quotedUrl: text("quotedUrl", true),
    originalUrl,
    sourceName,
    body: text("body", true) ?? "",
    revision: integer("revision", false)!,
    timelineAt: text("timelineAt", true),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface MarkdownOptions {
  generatedAt?: Date | string;
  /** Shown for provenance; escaped, never linked. */
  input?: string;
}

/**
 * Renders the preview as Markdown. All row text is escaped (raw HTML, links and Markdown syntax cannot
 * get through), and only HTTP(S) URLs become links: a `javascript:` or other scheme is shown as code.
 */
export function renderContentReviewMarkdown(review: ContentReview, rows: readonly ReviewRow[], options: MarkdownOptions = {}): string {
  const evidenceById = new Map(review.dailyLane.evidence.map((item) => [item.id, item]));
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const lines: string[] = [];

  lines.push("# 历史内容整理只读预览");
  lines.push("");
  const stamp = options.generatedAt instanceof Date ? options.generatedAt.toISOString() : options.generatedAt;
  if (stamp) lines.push(`- 生成时间：${escapeInline(stamp)}`);
  if (options.input) lines.push(`- 输入：${codeSpan(options.input)}`);
  lines.push(`- 输入行数：${review.rowCount}`);
  lines.push(`- 相似标题 / 同引用候选：${review.duplicateCandidates.length}`);
  lines.push(`- 日常：保留 ${review.dailyLane.keep.length}，移出工作消息 ${review.dailyLane.removeWork.length}，排除纯转帖 ${review.dailyLane.removeReposts.length}，待人工检查 ${review.dailyLane.review.length}`);
  lines.push("");
  lines.push("> 本预览只读：不合并、不改分类、不写数据库。所有候选状态都是 `needs-review`，需人工核对原帖后另行决定。原文链接只渲染 HTTP(S) 地址，其它协议按纯文本显示。");
  lines.push("");

  lines.push(`## 一、相似标题 / 同引用候选（${review.duplicateCandidates.length}）`);
  lines.push("");
  if (review.duplicateCandidates.length === 0) {
    lines.push("（没有需要复核的相似标题或同引用候选。）");
    lines.push("");
  }
  review.duplicateCandidates.forEach((candidate, index) => {
    lines.push(`### ${index + 1}. ${codeSpan(candidate.a)} ↔ ${codeSpan(candidate.b)}`);
    lines.push("");
    lines.push("- 状态：`needs-review`");
    lines.push(`- 原因：${reasonLabel(candidate.reason)}`);
    if (candidate.reason === "shared-quote") lines.push(`- 共同引用：${linkOrPlain(candidate.sharedQuotedUrl)}`);
    if (candidate.similarity !== undefined) lines.push(`- 标题相似度：${candidate.similarity.toFixed(2)}`);
    lines.push(`- 说明：${escapeInline(candidate.detail)}`);
    lines.push(`- A：${evidenceLine(candidate.evidence.a)}`);
    lines.push(`- B：${evidenceLine(candidate.evidence.b)}`);
    lines.push("");
  });

  lines.push(`## 二、日常分区（只列成员账号，${review.dailyLane.evidence.length} 条）`);
  lines.push("");
  dailySection(lines, "保留在日常", review.dailyLane.keep, "预览建议：保留在日常", evidenceById, rowById);
  dailySection(lines, "移出日常：非 daily 工作消息", review.dailyLane.removeWork, "预览建议：移出日常", evidenceById, rowById);
  dailySection(lines, "排除：纯转帖", review.dailyLane.removeReposts, "预览建议：不进日常", evidenceById, rowById);

  lines.push(`### 仅提示人工检查（${review.dailyLane.review.length}）`);
  lines.push("");
  if (review.dailyLane.review.length === 0) lines.push("（没有需要人工检查的日常冲突。）");
  for (const hint of review.dailyLane.review) {
    const evidence = evidenceById.get(hint.id);
    const title = evidence ? ` · 《${escapeInline(evidence.title)}》` : "";
    lines.push(`- ${codeSpan(hint.id)}${title}：${escapeInline(hint.reason)}`);
  }
  lines.push("");

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function dailySection(
  lines: string[],
  title: string,
  ids: readonly string[],
  action: string,
  evidenceById: ReadonlyMap<string, ReviewEvidence>,
  rowById: ReadonlyMap<string, ReviewRow>,
): void {
  lines.push(`### ${title}（${ids.length}）`);
  lines.push("");
  if (ids.length === 0) {
    lines.push("（无）");
  }
  for (const id of ids) {
    const evidence = evidenceById.get(id);
    if (!evidence) {
      lines.push(`- ${codeSpan(id)}（导出里没有对应成员行）`);
      continue;
    }
    const row = rowById.get(id);
    const category = row?.category ? ` · 分类：${escapeInline(row.category)}` : "";
    lines.push(`- ${codeSpan(id)}《${escapeInline(evidence.title)}》 · 来源：${escapeInline(evidence.sourceName)}${category} · ${action} · 原文：${linkOrPlain(evidence.originalUrl)}`);
  }
  lines.push("");
}

function evidenceLine(evidence: ReviewEvidence): string {
  const fact = evidence.factId === null
    ? "无事实 ID"
    : `事实 ${evidence.factId}${evidence.factPublicId ? `（public ${codeSpan(evidence.factPublicId)}）` : ""}${evidence.factVersion !== null ? ` v${evidence.factVersion}` : ""}`;
  const parts = [
    codeSpan(evidence.id),
    `《${escapeInline(evidence.title)}》`,
    `来源：${escapeInline(evidence.sourceName)}`,
    fact,
    `revision ${evidence.revision}`,
    `scope ${escapeInline(evidence.scope)}`,
    `原文：${linkOrPlain(evidence.originalUrl)}`,
  ];
  if (evidence.summary) parts.push(`摘要：${escapeInline(evidence.summary)}`);
  return parts.join(" · ");
}

function reasonLabel(reason: DuplicateReason): string {
  switch (reason) {
    case "shared-quote": return "同引用原帖";
    case "similar-title": return "标题相似";
  }
}

/** Only http(s) links are rendered as links; anything else stays inert code. */
function linkOrPlain(raw: string | null | undefined): string {
  const safe = httpUrl(raw);
  if (safe) return `[原文](<${safe}>)`;
  const value = String(raw ?? "").trim();
  return value ? `${codeSpan(value)}（不是 HTTP(S) 链接，未渲染）` : "（无）";
}

function httpUrl(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value || /[\u0000-\u001F\u007F]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/</g, "%3C").replace(/>/g, "%3E");
  } catch {
    return null;
  }
}

/** Escapes text for inline Markdown/HTML: raw tags and link syntax cannot survive. */
function escapeInline(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`/g, "\\`")
    .replace(/([*_[\]|~])/g, "\\$1");
}

/** A code span for ids and refused URLs: backticks and control characters become spaces. */
function codeSpan(value: unknown): string {
  const text = String(value ?? "").replace(/[\u0000-\u001F\u007F`]/g, " ").trim();
  return `\`${text}\``;
}
