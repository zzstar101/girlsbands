// 曲目单抽取（W16）：这篇报告写没写出那天唱了哪些曲子。落库不在这里 —— 这里只回答「原文里有没有」，
// lives/setlists.ts 负责写进 setlist_entries 并记下「这场找过了」。
//
// 与结构、演出、发售三个抽取步骤同一条规矩：模型给的每一行都要能在原文里指到出处（groundedFor），
// 指不到就丢掉。曲名照原文写法：不译、不改大小写，也不进 industry/glossary —— 进词表会让
// GLOSSARY_VERSION 变，全库翻译回执跟着失效。
import { z } from "zod";
import { chatJson } from "../providers/llm.ts";
import { collapseWhitespace } from "../lib/text.ts";
import { groundedFor, type AnalyzeInputArticle } from "./analyze.ts";
import { buildMaterial } from "./input.ts";
import { modelFor } from "./models.ts";
import { promptText, promptVersion } from "./prompts.ts";

/** industry/prompts/setlist.md */
export const SETLIST_SYSTEM = promptText("setlist");
export const SETLIST_PROMPT_VERSION = promptVersion("setlist");

/** 一场演出最多显示这么多首：原文列得再长也要有个上限。 */
export const MAX_SETLIST_ENTRIES = 40;

const SetlistSchema = z.object({
  songs: z.array(z.object({
    title: z.string().max(120),
    encore: z.boolean().catch(false),
    cover: z.boolean().catch(false),
    quote: z.string().max(500),
  })).max(60).catch([]),
});

export interface SetlistLine {
  title: string;
  isEncore: boolean;
  isCover: boolean;
  /** 原文里写出这一行的句子，已核对过出处。 */
  quote: string;
}

/**
 * 只留下原文里真的写着的那几行：引文要能在原文里找到（groundedFor），曲名还要在这一句引文里 ——
 * 模型把两处拼成一句、或按「这场大概会唱这些」补全时，这里都会拦下来。同名的曲子只留第一次出现的。
 */
export function normalizeSetlist(data: z.infer<typeof SetlistSchema>, a: AnalyzeInputArticle): SetlistLine[] {
  const grounded = groundedFor(a);
  const seen = new Set<string>();
  const lines: SetlistLine[] = [];
  for (const song of data.songs) {
    const title = collapseWhitespace(song.title);
    const quote = grounded(song.quote);
    if (!title || !quote || !quote.toLowerCase().includes(title.toLowerCase())) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ title, isEncore: song.encore === true, isCover: song.cover === true, quote });
    if (lines.length >= MAX_SETLIST_ENTRIES) break;
  }
  return lines;
}

export interface SetlistRead {
  lines: SetlistLine[];
  model: string;
  receiptId: number;
  /** 同一篇文章重跑时回执按输入去重，不再付一次钱。 */
  reused: boolean;
}

/** 抽一篇报告的曲目单。空数组是结论（「这篇没写」），不是失败：调用方据此决定要不要换一篇报告再试。 */
export async function extractSetlist(a: AnalyzeInputArticle, opts: { attemptTag?: string } = {}): Promise<SetlistRead> {
  // 与 structure / live / release 同一种活（只抽字段，不写读者文字），所以用同一个模型，不另开一个开关。
  const model = await modelFor("structure");
  const res = await chatJson({
    model,
    purpose: "setlist_article",
    subject: `article:${a.id}@${a.revision}`,
    promptVersion: SETLIST_PROMPT_VERSION,
    system: SETLIST_SYSTEM,
    user: buildMaterial(a),
    schema: SetlistSchema,
    temperature: 0,
    maxTokens: 2000,
    attemptTag: opts.attemptTag,
  });
  return { lines: normalizeSetlist(res.data, a), model: res.model, receiptId: res.receiptId, reused: res.reused };
}
