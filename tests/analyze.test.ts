// The judging and writing steps (editorial/analyze.ts): the prefilter decides relevance, two scores
// against the tier threshold decide 精选, selected and near-selected items are written by the content
// understanding and the rest by the title/summary translation, a structure step gives the category,
// subjects and fact. Material with only a feed summary has its page fetched first. Every prompt in the
// pack renders.
import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { upsertMaterial } from "@girlsbands/backend/content/materials";
import { analyzeArticle, buildMaterial, loadAnalyzeInput, normalizeRounds, normalizeStructure, NO_COPY_ERROR, StructureSchema, tierThreshold } from "@girlsbands/backend/editorial/analyze";
import { queueProcessing, requeueFailed } from "@girlsbands/backend/jobs/content";
import { QUEUES, stopBoss } from "@girlsbands/backend/jobs/queue";
import { compactAnswerFirstSummary, enforceIdentity, MAX_BODY_CHARS, parseTranslateOutput, PREFILTER_SYSTEM } from "@girlsbands/backend/editorial/writing";
import { promptText } from "@girlsbands/backend/editorial/prompts";
import { SITE } from "@girlsbands/industry/site";

const T = tag();
const SOURCE = `test-analyze-${T}`;
const X_SOURCE = `test-analyze-x-${T}`;

type Step = "prefilter" | "score" | "understand" | "summarize" | "structure" | "live";
interface Req { step: Step; marker: string; system: string; user: string }
const requests: Req[] = [];
const MARKERS = ["SHOWGOOD", "SHOWBAD", "STREAMSHOW", "CLEAR", "RESCUE", "LOW", "OFFTOPIC", "BARE", "VAGUE", "THIN", "SENSITIVE", "推文", "BLANK", "EMPTY"];
const scoreAnswers: Record<string, number[]> = { SHOWGOOD: [80, 80], SHOWBAD: [80, 80], STREAMSHOW: [80, 80], CLEAR: [78, 72], RESCUE: [56, 50], LOW: [45, 40], THIN: [70, 70], SENSITIVE: [80, 80], 推文: [40, 40], BARE: [30, 34], VAGUE: [60, 62], BLANK: [40, 40], EMPTY: [40, 40] };

const stepOf = (system: string, user: string): Step =>
  system.includes("宽召回的行业相关性预筛") ? "prefilter" : system.includes("事件注意力评分器") ? "score"
  : system.includes("内容理解编辑") ? "understand" : system.includes("资料结构化助手") ? "structure"
  : system.includes("演出信息抽取助手") ? "live"
  : user.includes("title_zh") ? "summarize" : (() => { throw new Error("unknown request"); })();

// One stub stands in for DashScope (prefilter, structure), Zhipu (score, understand) and DeepSeek (summarize).
const provider = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: unknown }> };
  const system = body.messages[0]!.role === "system" ? String(body.messages[0]!.content) : "";
  const last = body.messages[body.messages.length - 1]!.content;
  const user = typeof last === "string" ? last : JSON.stringify(last);
  const step = stepOf(system, user);
  const marker = MARKERS.find((m) => user.includes(m)) ?? "";
  requests.push({ step, marker, system, user });
  const answer = (content: unknown) => ({ id: `stub-${requests.length}`, model: "stub", choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  if (step === "prefilter") return answer({ label: marker === "OFFTOPIC" || marker === "BARE" ? "BLOCK" : marker === "VAGUE" ? "UNKNOWN" : "PASS", reason: "测试" });
  if (step === "score") return answer({ attentionScore: scoreAnswers[marker]!.shift() });
  if (step === "understand") {
    if (marker === "SENSITIVE") return new Reply(400, { contentFilter: [{ level: 1, role: "user" }], error: { code: "1301", message: "系统检测到输入或生成内容可能包含不安全或敏感内容" } });
    return answer({ itemType: "live_announcement", authorRole: "principal", tags: ["新 Live", "联动企划", "声优", "不存在的标签"], editorialJudgment: `理由 ${marker}`, titleZh: `理解标题 ${marker}`, summaryZh: `理解摘要 ${marker}。第二句补充一个关键数字。` });
  }
  if (step === "structure") {
    // The three SHOW markers are announcements with a start date, which is what the live step keys on.
    if (marker === "SHOWGOOD" || marker === "SHOWBAD" || marker === "STREAMSHOW") {
      return answer({ category: marker === "STREAMSHOW" ? "stream" : "live", tags: ["新 Live"], subjects: ["togenashi-togeari"], scope: "single", fact: { title: `事实 ${marker}`, subject: "トゲナシトゲアリ", action: "公布", object: "新 Live", occurredAt: null, evidence: "a band announced a live tour", conditions: [], deadlines: [{ kind: "event", at: "2026-11-03", note: "开演", quote: "a band announced a live tour" }] } });
    }
    return answer({ category: "live", tags: ["新 Live", "出演阵容"], subjects: ["togenashi-togeari", "unknown-co"], scope: "single", fact: { title: `事实 ${marker}`, subject: "トゲナシトゲアリ", action: "公布", object: "新 Live", occurredAt: null, evidence: "a band announced a live tour", conditions: [] } });
  }
  if (step === "live") {
    // SHOWBAD names a venue and a time the announcement never states (and says the show is off).
    return marker === "SHOWBAD"
      ? answer({ title: `演出名 ${marker}`, venue: "日本武道館", startsTime: "19:00", endsOn: null, status: "cancelled" })
      : answer({ title: `演出名 ${marker}`, venue: "ぴあアリーナMM", startsTime: "18:30", endsOn: null, status: "scheduled" });
  }
  // BLANK and EMPTY both name a band the material never mentions, so the identity guard drops the
  // copy; BLANK writes properly once the retry says so, EMPTY never does.
  if (marker === "EMPTY" || (marker === "BLANK" && !user.includes("上一次的中文标题里出现了原文没有提到的名字"))) {
    return answer("title_zh: Roselia 公布新 Live\nsummary_zh: Roselia 发布了新的演出信息。");
  }
  return answer(`title_zh: 翻译标题 ${marker}\nsummary_zh: 翻译摘要 ${marker}。第二句补充影响。`);
});
for (const env of ["DASHSCOPE_BASE_URL", "ZHIPU_BASE_URL", "DEEPSEEK_BASE_URL"]) process.env[env] = `${provider.url}/v1`;
for (const env of ["DASHSCOPE_API_KEY", "ZHIPU_API_KEY", "DEEPSEEK_API_KEY"]) process.env[env] = "test-key";

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES
    (${SOURCE}, 'Test analyze source', 'rss', 'T1', 'editorial', '2100-01-01'),
    (${X_SOURCE}, 'Test X account', 'x_search', 'T1', 'editorial', '2100-01-01')`;
});
after(async () => {
  await provider.close();
  await stopBoss();
  await closeDb();
});

// The tag keeps each material unique: identical input would reuse an earlier run's paid answers.
const LONG = "a band announced a live tour with ticket details and a venue list. ".repeat(8);
const article = async (marker: string, extra: Record<string, unknown> = {}) =>
  (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/${marker}-${T}`, title: `${marker} live tour ${T}`, bodyText: `${marker}: ${LONG} (${T})`,
    bodyStatus: "ok", via: "fetch", publishedAt: new Date("2026-09-28T01:02:03Z"), ...extra,
  } as never)).articleId;
const calls = (marker: string) => requests.filter((r) => r.marker === marker).map((r) => r.step);
const row = async (id: string) =>
  (await sql<{ selected: boolean; relevance: string; score: string | null; title_zh: string; reason_zh: string | null; category: string | null; tags: string[]; subjects: string[]; receipt_ids: string[]; output: Record<string, any> }[]>`
    SELECT selected, relevance, score, title_zh, reason_zh, category, tags, subjects, receipt_ids, output FROM analyses WHERE article_id = ${id} ORDER BY id DESC LIMIT 1`)[0]!;

test("every prompt in the pack renders, with the site's own name", () => {
  const dir = new URL("../industry/prompts/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  // Every value any prompt asks for, so each renders on its own.
  const names = new Set(files.flatMap((f) => [...readFileSync(new URL(f, dir), "utf8").matchAll(/\{\{\s*([A-Za-z][\w.-]*)\s*\}\}/g)].map((m) => m[1]!)));
  const values = Object.fromEntries([...names].map((n) => [n, "x"]));
  for (const file of files) {
    const text = promptText(file.slice(0, -3), values);
    assert.ok(text.length > 20 && !/\{\{/.test(text), file);
  }
  assert.ok(PREFILTER_SYSTEM.startsWith(`为${SITE.name}做宽召回的行业相关性预筛`));
});

test("a selected item: prefilter, two scores, the content understanding and the structure", async () => {
  assert.equal(tierThreshold("T1"), 54);
  assert.equal(tierThreshold("T2_EVENT"), 54, "domestic event listings carry their own threshold");
  assert.equal(tierThreshold("EXCLUDE_MP"), null, "a tier without a threshold is never scored for 精选");
  const id = await article("CLEAR");
  const res = await analyzeArticle(id);
  assert.deepEqual([res!.output!.selected, res!.output!.score], [true, 75], "78 + 72 = 150 >= 108");
  assert.deepEqual(calls("CLEAR").sort(), ["prefilter", "score", "score", "structure", "understand"]);
  const r = await row(id);
  assert.deepEqual([r.title_zh, r.reason_zh, r.category, r.receipt_ids.length], ["理解标题 CLEAR", "理由 CLEAR", "live", 5]);
  // Failure case: the writer's independent labels contradict the structural category.
  assert.deepEqual(r.tags, ["新 Live", "出演阵容", "トゲナシトゲアリ"], "category and tags come from the same structural judgement, plus the verified subject tag");
  assert.deepEqual(r.subjects, ["togenashi-togeari"]);
  assert.deepEqual([r.output.writer, r.output.itemType, r.output.prefilter.label, r.output.fact.title], ["understand", "live_announcement", "PASS", "事实 CLEAR"]);
  assert.equal(r.output.scope, "single");
  assert.equal(r.output.fact.evidence, "a band announced a live tour");
  const score = requests.find((q) => q.marker === "CLEAR" && q.step === "score")!;
  assert.match(score.user, /【标题】\nCLEAR live tour/, "the score reads the original title, before any writing");
  const understand = requests.find((q) => q.marker === "CLEAR" && q.step === "understand")!;
  assert.ok(understand.user.startsWith("请按系统规则理解以下单篇材料，一次返回全部六个字段。"));
  assert.ok(understand.system.includes("【摘要答案前置规则") && understand.system.includes("【标题自洽规则"));
  const prefilter = requests.find((q) => q.marker === "CLEAR" && q.step === "prefilter")!;
  assert.ok(JSON.parse(prefilter.user).includes("【材料质量】"), "the material context, sent as a JSON string");
});

test("a Live or ticket announcement with a start date reads the show itself, and only what it states", async () => {
  const id = await article("SHOWGOOD", { bodyText: `SHOWGOOD: ${LONG} 会場：ぴあアリーナMM 18:30 開演 (${T})` });
  const res = await analyzeArticle(id);
  assert.deepEqual(calls("SHOWGOOD").sort(), ["live", "prefilter", "score", "score", "structure", "understand"]);
  const r = await row(id);
  assert.deepEqual(r.output.live, { title: "演出名 SHOWGOOD", venue: "ぴあアリーナMM", startsTime: "18:30", endsOn: null, status: "scheduled", place: null, timezone: null, rounds: [] }, "一条没有票务的演出公告照样成页");
  assert.equal(r.receipt_ids.length, 6, "这一步的回执也记在这条分析上");
  assert.equal(res!.reused, false);
  const live = requests.find((q) => q.marker === "SHOWGOOD" && q.step === "live")!;
  assert.ok(live.user.includes("【结构步骤已抽出的日期】\nevent 2026-11-03"), "the dates the structure step found go with it");
  assert.ok(live.system.includes("演出信息抽取助手"));

  // A venue and a time the announcement never states are dropped, the name is not; 中止是原文说的才算。
  const bad = await article("SHOWBAD", { bodyText: `SHOWBAD: ${LONG} この公演は中止となりました (${T})` });
  await analyzeArticle(bad);
  assert.deepEqual((await row(bad)).output.live, { title: "演出名 SHOWBAD", venue: null, startsTime: null, endsOn: null, status: "cancelled", place: null, timezone: null, rounds: [] });

  // A stream is not a show: the start date alone does not earn the step.
  const stream = await article("STREAMSHOW", { bodyText: `STREAMSHOW: ${LONG} 会場：ぴあアリーナMM 18:30 開演 (${T})` });
  await analyzeArticle(stream);
  assert.deepEqual(calls("STREAMSHOW").sort(), ["prefilter", "score", "score", "structure", "understand"]);
  assert.equal((await row(stream)).output.live, undefined, "生放送没有演出这一节");
});

test("a round is kept only when the sentence the model quoted really states it, and never twice", () => {
  const text = "チケット情報 FC先行 10月3日(金) 20:00 〜 10月10日(金) 23:59 受付 一般販売 10月20日(火) 10:00 発売 会場：ぴあアリーナMM";
  const rounds = normalizeRounds([
    { kind: "fc", platform: null, applyStart: "2026-10-03T20:00", applyEnd: "2026-10-10T23:59", resultOn: null, paymentDueOn: null, quote: "FC先行 10月3日(金) 20:00 〜 10月10日(金) 23:59 受付" },
    { kind: "fc", platform: null, applyStart: "2026-10-03T20:00", applyEnd: null, resultOn: null, paymentDueOn: null, quote: "FC先行 10月3日(金) 20:00 〜 10月10日(金) 23:59 受付" },
    { kind: "general", platform: null, applyStart: "2026-10-20T10:00", applyEnd: null, resultOn: null, paymentDueOn: null, quote: "一般販売 10月20日(火) 10:00 発売" },
    { kind: "official", platform: null, applyStart: "2026-11-01", applyEnd: null, resultOn: null, paymentDueOn: null, quote: "公式先行 11月1日 受付" },
    { kind: "general", platform: null, applyStart: "2026-10-20T10:00", applyEnd: null, resultOn: null, paymentDueOn: null, quote: "一般販売 10月20日(火) 10:00 発売" },
    { kind: "day_of", platform: null, applyStart: null, applyEnd: null, resultOn: null, paymentDueOn: null, quote: "当日券" },
  ], text);
  // The repeated pair collapses, the sentence the text never wrote goes, and so does the round with no date at all.
  assert.deepEqual(rounds.map((r) => [r.kind, r.applyStart, r.applyEnd]), [
    ["fc", "2026-10-03T20:00", "2026-10-10T23:59"],
    ["general", "2026-10-20T10:00", null],
  ]);
  assert.equal(rounds[0]!.platform, null, "一个没有写平台的轮次不猜平台");

  // A date-only window survives a quote that writes the date the Japanese way; a clock the quote never wrote does not.
  const plain = normalizeRounds([
    { kind: "official", platform: null, applyStart: "2026-11-01", applyEnd: null, resultOn: null, paymentDueOn: null, quote: "公式先行 11月1日(日) 受付" },
    { kind: "cd_serial", platform: null, applyStart: "2026-11-01T09:00", applyEnd: null, resultOn: null, paymentDueOn: null, quote: "シリアル先行 11月1日(日) 受付" },
  ], "公式先行 11月1日(日) 受付 シリアル先行 11月1日(日) 受付");
  assert.deepEqual(plain.map((r) => [r.kind, r.applyStart]), [["official", "2026-11-01"]], "原文只写日期就只记日期，引文里没有的时刻不认");
});

test("structure retains grounded conditions, rejects invented or unseen quotes, and does not infer missing scope", async () => {
  const input = (await loadAnalyzeInput(await article("CONDITIONS", {
    bodyText: "Preview is free for Pro users until October 10.\n" + "x".repeat(11000) + "\nOnly available in the US. " + "x".repeat(MAX_BODY_CHARS) + "This late detail was not sent.",
  })))!;
  input.translationZh = "仅中文译文中出现的限制";
  const frame = { title: "预览上线", evidence: "Preview is free for Pro users until October 10.", conditions: [
    { text: "仅Pro用户，免费至10月10日", quote: "Preview is free for Pro users until October 10." },
    { text: "仅限美国", quote: "Only available in the US." },
    { text: "无限免费", quote: "Unlimited free access for everyone." },
    { text: "不在模型输入里的句子", quote: "This late detail was not sent." },
  ] };
  const base = { category: "live", tags: [], subjects: [], fact: frame };
  const out = normalizeStructure(StructureSchema.parse(base), input);
  assert.ok(buildMaterial(input).includes("Only available in the US."), "a condition after the old 7000-character cutoff reaches the model");
  assert.ok(buildMaterial(input).includes("后文未提供"));
  assert.equal(out.scope, "unknown", "an older result with a fact is not proof of single scope");
  assert.deepEqual(out.fact?.conditions, frame.conditions.slice(0, 2));
  assert.equal(out.fact?.evidence, frame.evidence);
  const partial = normalizeStructure(StructureSchema.parse({ ...base, fact: { ...frame, conditions: [
    { quote: "x".repeat(401) },
    { quote: "Preview is free... until October 10." },
    { quote: "Only available in the US." },
  ] } }), input);
  assert.deepEqual(partial.fact?.conditions, [{ text: "Only available in the US.", quote: "Only available in the US." }],
    "an invalid sibling cannot discard a valid original condition; spliced quotes remain rejected");
  const invented = normalizeStructure(StructureSchema.parse({ ...base, fact: { ...frame, evidence: input.source.name, conditions: [{ text: "翻译限制", quote: input.translationZh }] } }), input);
  assert.equal(invented.fact?.evidence, null, "source metadata is not original evidence");
  assert.deepEqual(invented.fact?.conditions, [], "a translation does not count as an original quote");
  assert.equal(normalizeStructure(StructureSchema.parse({ ...base, scope: "composite" }), input).fact, null, "composite output cannot also claim one fact");
  const titleOnly = normalizeStructure(StructureSchema.parse({ ...base, scope: "single" }), { ...input, bodyText: null, excerpt: null });
  assert.equal(titleOnly.scope, "unknown", "a confident model cannot supply the missing original material");
  assert.equal(titleOnly.fact, null);
});

test("a near-selected item is written like a selected one; below the floor it is translated", async () => {
  const near = await analyzeArticle(await article("RESCUE"));
  assert.deepEqual([near!.output!.selected, near!.output!.reasonZh], [false, "理由 RESCUE"], "56 + 50 = 106 > 100");
  const lowId = await article("LOW");
  const low = await analyzeArticle(lowId);
  assert.deepEqual([low!.output!.selected, low!.output!.titleZh, low!.output!.reasonZh], [false, "翻译标题 LOW", null]);
  assert.deepEqual(calls("LOW").sort(), ["prefilter", "score", "score", "structure", "summarize"]);
  assert.deepEqual((await row(lowId)).tags, ["新 Live", "出演阵容", "トゲナシトゲアリ"], "structure tags");
});

test("the prefilter's BLOCK stops everything; UNKNOWN goes on like PASS", async () => {
  const off = await analyzeArticle(await article("OFFTOPIC"));
  assert.deepEqual([off!.output!.relevance, off!.output!.selected], ["block", false]);
  assert.deepEqual(calls("OFFTOPIC"), ["prefilter"]);
  // An UNKNOWN with material is judged and written like a PASS, up to 精选 (60 + 62 ≥ 2 × 60).
  const vagueId = await article("VAGUE");
  const vague = await analyzeArticle(vagueId);
  assert.deepEqual([vague!.output!.relevance, vague!.output!.selected, vague!.output!.titleZh], ["pass", true, "理解标题 VAGUE"]);
  assert.equal((await row(vagueId)).output.prefilter.label, "UNKNOWN", "the prefilter's own answer stays on record");
  // Nothing but a title and no page to fetch: the BLOCK counts as UNKNOWN and is scored, but the
  // translation writes nothing from a bare title, so it waits for material instead of being published.
  const bare = await analyzeArticle(await article("BARE", { bodyText: null, excerpt: null, bodyStatus: "none" }));
  assert.deepEqual([bare!.output!.relevance, bare!.output!.selected, bare!.output!.score], ["unknown", false, 32]);
  assert.deepEqual(calls("BARE").sort(), ["prefilter", "score", "score", "structure"]);
});

test("a writer that gives no Chinese copy is asked again, as a new request, and the item goes out", async () => {
  const id = await article("BLANK");
  const res = await analyzeArticle(id);
  assert.deepEqual(calls("BLANK").sort(), ["prefilter", "score", "score", "structure", "summarize", "summarize"], "the retry is a second paid call, not a replay");
  assert.deepEqual([res!.output!.relevance, res!.output!.titleZh, res!.output!.summaryZh], ["pass", "翻译标题 BLANK", "翻译摘要 BLANK。第二句补充影响。"]);
  const retry = requests.filter((r) => r.marker === "BLANK" && r.step === "summarize")[1]!;
  assert.match(retry.user, /上一次的中文标题里出现了原文没有提到的名字/, "the model is told what was wrong");
  assert.equal(res!.receiptIds.length, 6, "every request of the retried run is on record");
  assert.equal((await sql`SELECT processing_state FROM articles WHERE id = ${id}`)[0]!.processing_state, "analyzed");
});

test("an item whose writer gives no Chinese copy twice ends failed, and the owner's retry asks again", async () => {
  const id = await article("EMPTY");
  const res = await analyzeArticle(id);
  assert.deepEqual([res!.output!.relevance, res!.output!.titleZh], ["unknown", ""]);
  const [failed] = await sql<{ processing_state: string; processing_error: string }[]>`SELECT processing_state, processing_error FROM articles WHERE id = ${id}`;
  // Not "analyzed": that state is terminal and nothing sweeps it again, so the item would vanish.
  assert.deepEqual([failed!.processing_state, failed!.processing_error], ["failed", NO_COPY_ERROR]);
  await requeueFailed(null);
  const [queued] = await sql<{ processing_state: string; processing_attempt_tag: string | null }[]>`
    SELECT processing_state, processing_attempt_tag FROM articles WHERE id = ${id}`;
  assert.equal(queued!.processing_state, "new");
  assert.match(queued!.processing_attempt_tag ?? "", /^retry-[0-9a-z]+$/, "an explicit retry is a new request, not the same one again");
});

test("a feed summary alone: the article page is fetched first, then the whole article is judged", async () => {
  const id = await article("THIN", { bodyText: null, bodyStatus: "pending", excerpt: `THIN: a short feed summary (${T}).` });
  // The queue sends it to extraction although its source does not ask for full text (the sweep does
  // the same after a failed fetch, so extraction failures add up to "unconfirmed" and end).
  await queueProcessing(id);
  const [job] = await sql<{ name: string }[]>`SELECT name FROM pgboss.job WHERE data->>'articleId' = ${id}`;
  assert.equal(job?.name, QUEUES.extractBody);
  const first = await analyzeArticle(id);
  assert.deepEqual([first!.needsBody, first!.output], [true, null]);
  assert.deepEqual(calls("THIN"), [], "no model call before the page");
  assert.equal((await sql`SELECT 1 FROM analyses WHERE article_id = ${id}`).length, 0, "nothing committed");
  // What extraction does: the body lands as a new revision.
  await sql`UPDATE articles SET body_text = ${`THIN: ${LONG} (${T}) full page`}, body_status = 'ok', revision = revision + 1 WHERE id = ${id}`;
  const second = await analyzeArticle(id);
  assert.deepEqual([second!.needsBody ?? false, second!.output!.selected], [false, true]);
});

test("a short post in Chinese is its own copy; a content-filter refusal is translated instead", async () => {
  // The tag rides as a hashtag, which the language check strips.
  const text = `推文：今天把新巡演的日程和会场都定下来了，很期待。#t${T}`;
  const { articleId } = await upsertMaterial({
    sourceId: X_SOURCE, url: `https://x.com/test/status/1${Date.now()}`, title: text, via: "fetch", publishedAt: new Date(),
    xPost: { tweetId: `1${Date.now()}`, authorName: "测试", handle: "test", text },
  });
  const post = await analyzeArticle(articleId);
  assert.deepEqual([post!.output!.titleZh, post!.output!.summaryZh], [text, text]);
  assert.ok(!calls("推文").includes("summarize"), "no translation call");
  const sensitive = await analyzeArticle(await article("SENSITIVE"));
  assert.deepEqual([sensitive!.output!.selected, sensitive!.output!.titleZh], [true, "翻译标题 SENSITIVE"]);
  assert.deepEqual(calls("SENSITIVE").filter((s) => s === "understand" || s === "summarize"), ["understand", "summarize"]);
});

test("guards: a company the input does not name is not written in; long summaries are cut at sentences", () => {
  const input = { title: "某乐队公布新巡演", text: "某乐队公布了一次新巡演，日程和会场都有说明。", sourceKind: "rss" };
  const guarded = enforceIdentity(input, { titleZh: "トゲナシトゲアリ 公布新巡演", summaryZh: "某乐队公布新巡演。" });
  assert.deepEqual([guarded.titleZh, guarded.summaryZh, guarded.identityGuard.outcome], ["某乐队公布新巡演", "某乐队公布新巡演。", "fallback"]);
  // The identity lexicon: a Chinese rendering of a company the input names in English is no invention.
  const togenashi = { title: "Togenashi Togeari announces a new live tour", text: "Togenashi Togeari announced a new live tour with ticket details.", sourceKind: "rss" };
  assert.equal(enforceIdentity(togenashi, { titleZh: "トゲナシトゲアリ 公布新巡演", summaryZh: "トゲナシトゲアリ公布了新巡演与票务信息。" }).identityGuard.outcome, "pass");
  const long = "第一句交代了谁做了什么以及关键结果，这一句本身已经足够说明核心事件的来龙去脉。".repeat(3) + "第二句补充数字。".repeat(20);
  assert.ok(compactAnswerFirstSummary(long).length <= 190);
  assert.deepEqual(parseTranslateOutput("title_zh: 标题\nsummary_zh: 第一句。\n第二句。"), { titleZh: "标题", summaryZh: "第一句。\n第二句。", bodyZh: "" });
  assert.equal(parseTranslateOutput("title_zh: 标题\nbody_zh: 我们懂你。\n\n来源：X：PixVerse (@PixVerse)").bodyZh, "我们懂你。", "a repeated prompt line is dropped");
});

test("analysing the same revision again reuses every paid answer", async () => {
  scoreAnswers.CLEAR = [80, 70];
  const id = await article("CLEAR", { url: `https://example.com/CLEAR-again-${T}`, title: `CLEAR live tour again ${T}` });
  const first = await analyzeArticle(id);
  assert.equal(first!.reused, false);
  const hits = provider.hits();
  const again = await analyzeArticle(id);
  assert.equal(provider.hits(), hits, "no new requests");
  assert.deepEqual([again!.reused, again!.receiptIds], [true, first!.receiptIds]);
});
