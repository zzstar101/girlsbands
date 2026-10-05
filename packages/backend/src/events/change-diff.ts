// 情报变更（W14）：一个事件相对上一版报道变了什么。写入发生在 events/digest.ts 的那一次事务里 ——
// 每次重写综述都顺手记一份「当时每篇报道怎么说」的快照，并与上一版比出变化清单。
// 快照只取抽取结果里受控的那些字段，不取 facts.subject/action/object：那三列是编辑器可以改的投影
// （events/digest.ts 里同一句注释），拿它做 diff 永远为空。快照与输入指纹 inputs_hash 无关，
// 所以「只改了日期」也会多写一版，但不会多花一次模型调用（见 composeStoryDigest 的 res 那一行）。
import { z } from "zod";
import { DEADLINE_LABELS, TICKET_ROUND_LABELS, isLoudChange, type ChangeKind, type StoryChange } from "@girlsbands/contracts/site";
import { modelFor } from "../editorial/models.ts";
import { promptText, promptVersion } from "../editorial/prompts.ts";
import { chatJson } from "../providers/llm.ts";
import { sha256, stableJson } from "../lib/ids.ts";

export const CHANGE_PROMPT_VERSION = promptVersion("story-changes");

export const CHANGE_SYSTEM = promptText("story-changes");

const ChangeWordingSchema = z.object({ changes: z.array(z.string().min(1).max(200)).max(4) });

/** 每篇报道一条：写这一版综述时，它自己的抽取结果里受控的那些字段。 */
const SnapshotEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  conditions: z.array(z.string()),
  deadlines: z.array(z.object({ kind: z.string(), at: z.string() })),
  status: z.string().nullable(),
  venue: z.string().nullable(),
  startsTime: z.string().nullable(),
  endsOn: z.string().nullable(),
  rounds: z.array(z.string()),
  prices: z.array(z.string()),
  releaseOn: z.string().nullable(),
});

export type ChangeSnapshotEntry = z.infer<typeof SnapshotEntrySchema>;

const SnapshotSchema = z.array(SnapshotEntrySchema);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function conditionTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((condition) => {
    const line = text(record(condition).text);
    return line === null ? [] : [line];
  });
}

/** 日程只留种类与日期：`note` 是公告自己的说法，比较日期时用不上。 */
function deadlineRows(value: unknown): Array<{ kind: string; at: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Map<string, { kind: string; at: string }>();
  for (const raw of value) {
    const row = record(raw);
    const kind = text(row.kind);
    const at = text(row.at);
    if (kind && at) seen.set(`${kind}|${at}`, { kind, at });
  }
  return [...seen.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.at.localeCompare(b.at));
}

/** 一个轮次写成一行可比对的规范形：换行与字段顺序都不能影响「变了没有」。 */
function roundRows(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>();
  for (const raw of value) {
    const round = record(raw);
    const kind = text(round.kind);
    if (kind) set.add([kind, text(round.platform) ?? "", text(round.applyStart) ?? "", text(round.applyEnd) ?? ""].join("|"));
  }
  return [...set].sort();
}

function priceRows(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>();
  for (const raw of value) {
    const edition = record(raw);
    if (typeof edition.priceYen !== "number") continue;
    set.add([text(edition.name) ?? "通常盘", String(edition.priceYen)].join("|"));
  }
  return [...set].sort();
}

/** 这一版综述写的时候，每篇报道各自说了什么。按报道时间排序，与 inputs_hash 无关。 */
export function changeSnapshot(reports: Array<{ id: string; at: Date; structured_fact?: unknown; structured_live?: unknown; structured_release?: unknown }>): ChangeSnapshotEntry[] {
  return reports.map((report) => {
    const fact = record(report.structured_fact);
    const live = record(report.structured_live);
    const release = record(report.structured_release);
    return {
      id: report.id,
      at: report.at.toISOString(),
      conditions: conditionTexts(fact.conditions),
      deadlines: deadlineRows(fact.deadlines),
      status: text(live.status),
      venue: text(live.venue),
      startsTime: text(live.startsTime),
      endsOn: text(live.endsOn),
      rounds: roundRows(live.rounds),
      prices: priceRows(release.editions),
      releaseOn: text(release.releaseOn),
    };
  });
}

export function changeSnapshotHash(snapshot: ChangeSnapshotEntry[]): string {
  return sha256(stableJson(snapshot));
}

export interface ChangeDiff {
  items: StoryChange[];
  /** 其中属于醒目四类的那些 —— 页面的 ⚠️ 与时间线角标按它显示。 */
  kinds: ChangeKind[];
  /** 注意事项这类自由文本的变化：要说人话得花一次模型调用，只在结构化字段没变时用。 */
  text: { added: string[]; removed: string[]; itemId: string | null } | null;
  /** 这一版有没有可比较的结构化锚点（演出 / 日程 / 发售）：没有就不为措辞变化打扰读者。 */
  anchored: boolean;
}

/**
 * 每一项取「最新一篇说出它的报道」当当前值：新报道没提就沿用上一篇说过的，不算变化。
 * 上一版没有快照（迁移之前的存量行）时一律视为无变化，不误报「全变了」。
 */
function newest<T>(entries: ChangeSnapshotEntry[], pick: (entry: ChangeSnapshotEntry) => T | null): { value: T; id: string } | null {
  let best: { value: T; id: string; at: string } | null = null;
  for (const entry of entries) {
    const value = pick(entry);
    if (value === null || value === undefined || value === "") continue;
    if (!best || entry.at > best.at || (entry.at === best.at && entry.id < best.id)) best = { value, id: entry.id, at: entry.at };
  }
  return best ? { value: best.value, id: best.id } : null;
}

function deadlineLabel(kind: string): string {
  return (DEADLINE_LABELS as Record<string, { label: string } | undefined>)[kind]?.label ?? "日程";
}

function roundText(row: string): string {
  const [kind, platform, applyStart] = row.split("|");
  const label = (TICKET_ROUND_LABELS as Record<string, string | undefined>)[kind] ?? "票务";
  return `${label}受理${platform ? `（${platform}）` : ""}${applyStart ? `，${applyStart} 起` : ""}`;
}

function priceText(row: string): string {
  const [name, price] = row.split("|");
  return `${name} ${Number(price).toLocaleString("en-US")} 日元`;
}

export function diffChangeSnapshots(previous: unknown, next: ChangeSnapshotEntry[]): ChangeDiff {
  const parsed = SnapshotSchema.safeParse(previous);
  const before = parsed.success ? parsed.data : [];
  const empty: ChangeDiff = { items: [], kinds: [], text: null, anchored: false };
  if (before.length === 0 || next.length === 0) return empty;
  const items: StoryChange[] = [];
  const push = (kind: ChangeKind, text: string, itemId: string | null) => { items.push({ kind, text, itemId }); };

  const status = newest(next, (e) => e.status);
  const wasStatus = newest(before, (e) => e.status);
  if (status && status.value !== wasStatus?.value) {
    if (status.value === "cancelled") push("cancelled", "演出已取消", status.id);
    else if (status.value === "postponed") push("postponed", "演出已延期", status.id);
    // 撤回取消 / 延期同样是读者要立刻知道的事，但类别不是那两类本身，所以归到日程。
    else if (wasStatus && (wasStatus.value === "cancelled" || wasStatus.value === "postponed")) push("time", "取消 / 延期已撤回，演出照常举行", status.id);
  }

  const venue = newest(next, (e) => e.venue);
  const wasVenue = newest(before, (e) => e.venue);
  if (venue && venue.value !== wasVenue?.value) push("venue", wasVenue ? `会场 ${wasVenue.value} → ${venue.value}` : `会场确定为 ${venue.value}`, venue.id);

  const starts = newest(next, (e) => e.startsTime);
  const wasStarts = newest(before, (e) => e.startsTime);
  if (starts && wasStarts && starts.value !== wasStarts.value) push("time", `开演时间 ${wasStarts.value} → ${starts.value}`, starts.id);

  const ends = newest(next, (e) => e.endsOn);
  const wasEnds = newest(before, (e) => e.endsOn);
  if (ends && wasEnds && ends.value !== wasEnds.value) push("time", `结束日 ${wasEnds.value} → ${ends.value}`, ends.id);

  const kinds = new Set([...before, ...next].flatMap((e) => e.deadlines.map((d) => d.kind)));
  for (const kind of [...kinds].sort()) {
    const nowAt = newest(next, (e) => e.deadlines.find((d) => d.kind === kind)?.at ?? null);
    const wasAt = newest(before, (e) => e.deadlines.find((d) => d.kind === kind)?.at ?? null);
    if (!nowAt || !wasAt || nowAt.value === wasAt.value) continue;
    push(kind === "event" ? "time" : "rounds", `${deadlineLabel(kind)} ${wasAt.value} → ${nowAt.value}`, nowAt.id);
  }

  const rounds = newest(next, (e) => (e.rounds.length ? e.rounds : null));
  const wasRounds = newest(before, (e) => (e.rounds.length ? e.rounds : null));
  if (rounds && wasRounds && rounds.value.join("|") !== wasRounds.value.join("|")) {
    for (const row of rounds.value) if (!wasRounds.value.includes(row)) push("rounds", `新增${roundText(row)}`, rounds.id);
    for (const row of wasRounds.value) if (!rounds.value.includes(row)) push("rounds", `不再有${roundText(row)}`, rounds.id);
  }

  const prices = newest(next, (e) => (e.prices.length ? e.prices : null));
  const wasPrices = newest(before, (e) => (e.prices.length ? e.prices : null));
  if (prices && wasPrices && prices.value.join("|") !== wasPrices.value.join("|")) {
    for (const row of prices.value) if (!wasPrices.value.includes(row)) push("release", `新增价格 ${priceText(row)}`, prices.id);
    for (const row of wasPrices.value) if (!prices.value.includes(row)) push("release", `不再有价格 ${priceText(row)}`, prices.id);
  }

  const releaseOn = newest(next, (e) => e.releaseOn);
  const wasReleaseOn = newest(before, (e) => e.releaseOn);
  if (releaseOn && wasReleaseOn && releaseOn.value !== wasReleaseOn.value) push("release", `发售日 ${wasReleaseOn.value} → ${releaseOn.value}`, releaseOn.id);

  const conditions = newest(next, (e) => (e.conditions.length ? e.conditions.join("\n") : null));
  const wasConditions = newest(before, (e) => (e.conditions.length ? e.conditions.join("\n") : null));
  let text: ChangeDiff["text"] = null;
  if (conditions && wasConditions && conditions.value !== wasConditions.value) {
    const nowLines = conditions.value.split("\n");
    const wasLines = wasConditions.value.split("\n");
    const added = nowLines.filter((line) => !wasLines.includes(line));
    const removed = wasLines.filter((line) => !nowLines.includes(line));
    if (added.length > 0 || removed.length > 0) text = { added, removed, itemId: conditions.id };
  }

  const anchored = next.some((e) => e.deadlines.length > 0 || e.rounds.length > 0 || e.status !== null
    || e.venue !== null || e.startsTime !== null || e.endsOn !== null || e.releaseOn !== null);
  return { items, kinds: [...new Set(items.map((i) => i.kind))].filter(isLoudChange), text, anchored };
}

export interface WordedChanges {
  items: StoryChange[];
  receiptId: number | null;
}

function clip(value: string): string {
  return value.length > 60 ? `${value.slice(0, 59)}…` : value;
}

/**
 * 注意事项 / 条件的措辞变化交给模型说人话；模型关闭或失败时降级成模板，绝不让这一版写不下去。
 * 只在「结构化字段一处没变、又有结构化锚点」时调用 —— 只改日期的那一版不该花这次钱。
 */
export async function wordTextChanges(opts: { title: string; added: string[]; removed: string[]; itemId: string | null; subject: string }): Promise<WordedChanges> {
  const user = [
    `事件：${opts.title}`,
    `这一版新出现的注意事项 / 条件：\n${opts.added.length ? opts.added.map((t) => `- ${t}`).join("\n") : "（无）"}`,
    `这一版不再出现的注意事项 / 条件：\n${opts.removed.length ? opts.removed.map((t) => `- ${t}`).join("\n") : "（无）"}`,
  ].join("\n");
  try {
    const res = await chatJson({
      model: await modelFor("digest"), purpose: "story_changes", subject: opts.subject,
      promptVersion: CHANGE_PROMPT_VERSION, system: CHANGE_SYSTEM, user,
      schema: ChangeWordingSchema, temperature: 0.2, maxTokens: 400,
    });
    const changes = res.data.changes.map((line) => line.trim()).filter((line) => line !== "").slice(0, 3);
    return { items: changes.map((line) => ({ kind: "text" as const, text: line, itemId: opts.itemId })), receiptId: res.receiptId };
  } catch {
    return {
      items: [
        ...opts.added.map((line) => ({ kind: "text" as const, text: `新增注意：${clip(line)}`, itemId: opts.itemId })),
        ...opts.removed.map((line) => ({ kind: "text" as const, text: `取消注意：${clip(line)}`, itemId: opts.itemId })),
      ],
      receiptId: null,
    };
  }
}
