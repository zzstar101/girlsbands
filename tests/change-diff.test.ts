// 情报变更（W14）：同一件事相对上一版报道变了什么。写的是它会出错的方式：只改了日期却把综述重写一遍
// （白花一次模型费）、取消的演出还挂在截止雷达上等人抢票、延期之后新旧两个日期一起列出来、迁移之前
// 的存量事件被误报成「全变了」、注意事项的措辞变了却因为模型挂了把这一版写没了。
import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { changeSnapshot, diffChangeSnapshots } from "@girlsbands/backend/events/change-diff";
import { composeStoryDigest } from "@girlsbands/backend/events/digest";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { deadlineRange } from "@girlsbands/backend/publication/deadlines";
import { loadStoryDetail } from "@girlsbands/backend/publication/stories";
import { loadTimeline } from "@girlsbands/backend/publication/timeline";
import type { StoryChange } from "@girlsbands/contracts/site";

const key = `change-${tag()}`;
const now = new Date();
const at = (hours: number) => new Date(+now - hours * 3600_000);
/** 措辞那一次调用要走哪条路：说人话，还是（模型挂了）降级成模板。 */
let wording = "worded";
let wordingCalls = 0;
const prompts: string[] = [];
const provider = await stub((_hit, req) => {
  const user = (JSON.parse(req.body).messages as Array<{ content: string }>)[1]!.content;
  prompts.push(user);
  if (user.includes("这一版新出现的注意事项")) {
    wordingCalls += 1;
    return { id: "local", choices: [{ message: { content: wording === "broken" ? "这不是 JSON" : JSON.stringify({ changes: ["新增：入场需另付 1 杯饮品费"] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
  }
  return { id: "local", choices: [{ message: { content: JSON.stringify({ title: "标题", digest: "这是一段足够长的综述文本，用来满足最短长度要求。" }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
});
process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
process.env.DEEPSEEK_API_KEY = "test-key";
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

let n = 0;

interface Story { storyId: number; storyPublicId: string; factId: number; title: string }

async function source(): Promise<string> {
  const id = `${key}-s${++n}`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,config,first_party,next_fetch_at)
    VALUES (${id},${`媒体 ${n}`},'rss','T1','editorial',${sql.json({} as never)},true,'2100-01-01')`;
  return id;
}

async function story(title?: string): Promise<Story> {
  const name = title ?? `事件 ${key}-${++n}`;
  const [s] = await sql`INSERT INTO stories (public_id,title,first_report_at,latest_at)
    VALUES (${randomUUID()},${name},${at(100)},${at(0)}) RETURNING id, public_id`;
  const [f] = await sql`INSERT INTO facts (public_id,story_id,title,subject,action,object,conditions)
    VALUES (${`f-${randomUUID()}`},${s!.id},${name},'トゲナシトゲアリ','举办','演唱会','抽选需要序列号') RETURNING id`;
  return { storyId: Number(s!.id), storyPublicId: s!.public_id as string, factId: Number(f!.id), title: name };
}

interface ReportOpts {
  hours: number;
  title?: string;
  conditions?: unknown[];
  deadlines?: unknown[];
  live?: Record<string, unknown> | null;
  release?: Record<string, unknown> | null;
}

/** 一篇报道的抽取结果，形状与 editorial/analyze.ts 写下的那个 output 一致。 */
function output(opts: ReportOpts): Record<string, unknown> {
  return {
    scope: "single",
    fact: {
      evidence: "Lottery entries need a serial number.",
      conditions: opts.conditions ?? [{ text: "抽选需要序列号", quote: "Lottery entries need a serial number." }],
      deadlines: opts.deadlines ?? [],
    },
    ...(opts.live ? { live: { status: "scheduled", venue: null, startsTime: null, endsOn: null, rounds: [], ...opts.live } } : {}),
    ...(opts.release ? { release: { releaseOn: null, editions: [], ...opts.release } } : {}),
  };
}

async function report(sourceId: string, g: Story, opts: ReportOpts): Promise<string> {
  const id = `${key}-${randomUUID()}`;
  const date = at(opts.hours);
  const title = opts.title ?? `报道 ${++n}`;
  await sql`INSERT INTO articles (id,source_id,identity_key,url,title,timeline_at,discovered_at,published_at)
    VALUES (${id},${sourceId},${id},${`https://example.org/${id}`},${title},${date},${date},${date})`;
  const [a] = await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,title_zh,summary_zh,score,selected,output)
    VALUES (${id},1,'rule','pass',${title},${title},70,true,${sql.json(output(opts) as never)}) RETURNING id`;
  await sql`INSERT INTO publications (article_id,analysis_id,source_id,title,summary,url,channel,first_party,timeline_at,discovered_at,published_at,sort_at,
    story_id,fact_id,selected,eligible,visible_after,tags,body_mode,score)
    VALUES (${id},${a!.id},${sourceId},${title},${title},${`https://example.org/${id}`},'news',true,${date},${date},${date},${date},
    ${g.storyId},${g.factId},true,true,${date},${[key]},'full',70)`;
  await sql`INSERT INTO fact_articles (fact_id,article_id,role,evidence) VALUES (${g.factId},${id},'report','Lottery entries need a serial number.')`;
  return id;
}

/** 阶段 B 重跑：同一条公告带着改过的抽取结果回来。 */
async function rewrite(articleId: string, opts: ReportOpts): Promise<void> {
  await sql`UPDATE analyses SET output = ${sql.json(output(opts) as never)} WHERE article_id = ${articleId}`;
}

interface Version { version: number; change_kinds: string[] | null; changes: StoryChange[] | null; created_at: Date }

async function latestVersion(storyId: number): Promise<Version> {
  const [row] = await sql<Version[]>`SELECT version, change_kinds, changes, created_at FROM story_digests
    WHERE story_id = ${storyId} ORDER BY version DESC LIMIT 1`;
  return row!;
}

test("只改开演日期与时刻：多写一版快照、变化算得出来，却不再问模型要一遍综述", async () => {
  const s = await source();
  const g = await story();
  const article = await report(s, g, { hours: 3, title: "演出定档", deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00" } });
  assert.equal((await composeStoryDigest(g.storyId)).updated, true);
  const calls = provider.hits();

  await rewrite(article, { hours: 3, title: "演出定档", deadlines: [{ kind: "event", at: "2026-11-05" }], live: { venue: "Zepp DiverCity", startsTime: "16:30" } });
  assert.equal((await composeStoryDigest(g.storyId)).updated, true, "日期变了就该留下新的一版");
  assert.equal(provider.hits(), calls, "只改了日期，综述本身没变，不该再花一次模型调用");

  const row = await latestVersion(g.storyId);
  assert.deepEqual(row.change_kinds, ["time"]);
  const texts = (row.changes ?? []).map((c) => c.text);
  assert.ok(texts.some((t) => t.includes("2026-11-03") && t.includes("2026-11-05")), `开演日期的变化要写出来：${texts.join(" / ")}`);
  assert.ok(texts.some((t) => t.includes("17:00") && t.includes("16:30")), `开演时刻的变化要写出来：${texts.join(" / ")}`);

  const detail = (await loadStoryDetail(g.storyId, now))!;
  assert.deepEqual(detail.changes?.kinds, ["time"]);
  assert.equal(detail.changes?.items.length, 2);
  assert.ok(detail.changes!.items.every((c) => c.itemId === article), "每条变化都要指得回是哪一篇报道说的");
});

test("取消的演出从雷达上下来；延期的只按最新一篇公告的日期算", async () => {
  const s = await source();

  const postponed = await story();
  const original = await report(s, postponed, { hours: 3, deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00" } });
  assert.equal((await composeStoryDigest(postponed.storyId)).updated, true);
  const moved = await report(s, postponed, { hours: 2, deadlines: [{ kind: "event", at: "2026-12-10" }], live: { venue: "Zepp DiverCity", startsTime: "17:00", status: "postponed" } });
  assert.equal((await composeStoryDigest(postponed.storyId)).updated, true);
  const rows = await deadlineRange(now, { from: "2026-11-01", to: "2026-12-31", itemIds: [original, moved] });
  assert.deepEqual(rows.map((r) => r.day), ["2026-12-10"], "延期之后不该把原定日期也一起列出来");
  assert.deepEqual((await latestVersion(postponed.storyId)).change_kinds, ["postponed", "time"]);

  const cancelled = await story();
  const alone = await report(s, cancelled, { hours: 3, deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00" } });
  assert.equal((await composeStoryDigest(cancelled.storyId)).updated, true);
  assert.equal((await deadlineRange(now, { from: "2026-11-01", to: "2026-12-31", itemIds: [alone] })).length, 1);
  await rewrite(alone, { hours: 3, deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00", status: "cancelled" } });
  assert.equal((await composeStoryDigest(cancelled.storyId)).updated, true);
  assert.deepEqual((await latestVersion(cancelled.storyId)).change_kinds, ["cancelled"]);
  assert.equal((await deadlineRange(now, { from: "2026-11-01", to: "2026-12-31", itemIds: [alone] })).length, 0, "取消的演出不该再挂在雷达上等人抢票");
});

test("迁移之前的存量版本没有快照，不误报「全变了」", async () => {
  const s = await source();
  const g = await story();
  const article = await report(s, g, { hours: 3, deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00" } });
  assert.equal((await composeStoryDigest(g.storyId)).updated, true);
  await sql`UPDATE story_digests SET facts = NULL, facts_hash = NULL WHERE story_id = ${g.storyId}`;

  await rewrite(article, { hours: 3, conditions: [{ text: "每人限购两张", quote: "Up to two tickets per person." }], deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00" } });
  assert.equal((await composeStoryDigest(g.storyId)).updated, true, "条件变了，综述要重写");
  const row = await latestVersion(g.storyId);
  assert.deepEqual(row.changes, [], "上一版没有快照就说不出变化，不能把整份内容当成一次变更");
  assert.deepEqual(row.change_kinds, []);
  assert.equal((await loadStoryDetail(g.storyId, now))!.changes, null);
});

test("只有注意事项的措辞变了才花一次模型调用；模型说不出人话就降级模板", async () => {
  const s = await source();
  const lines = { text: "每人限购两张", quote: "Up to two tickets per person." };

  const worded = await story();
  const first = await report(s, worded, { hours: 3, deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00" } });
  assert.equal((await composeStoryDigest(worded.storyId)).updated, true);
  const before = wordingCalls;
  await rewrite(first, { hours: 3, conditions: [lines], deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00" } });
  assert.equal((await composeStoryDigest(worded.storyId)).updated, true);
  assert.equal(wordingCalls, before + 1, `自由文本的变化要说人话，花一次调用；这一版实际问了模型这些：${prompts.join(" / ")}`);
  assert.deepEqual((await loadStoryDetail(worded.storyId, now))!.changes, {
    items: [{ kind: "text", text: "新增：入场需另付 1 杯饮品费", itemId: first }], kinds: [], at: (await latestVersion(worded.storyId)).created_at.toISOString(),
  }, "措辞变化照列，但不属于醒目四类");

  wording = "broken";
  // 同一个提示词只会付一次钱（receipt 按输入去重），所以这一版要换一句注意事项才走得到模型。
  const other = { text: "全场禁止录像", quote: "Recording is prohibited." };
  const broken = await story();
  const second = await report(s, broken, { hours: 3, deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00" } });
  assert.equal((await composeStoryDigest(broken.storyId)).updated, true);
  const brokenBefore = wordingCalls;
  await rewrite(second, { hours: 3, conditions: [other], deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00" } });
  assert.equal((await composeStoryDigest(broken.storyId)).updated, true, "模型挂了也要写下去");
  assert.equal(wordingCalls, brokenBefore + 1, `模型挂了也照样问了它一次；这一版实际问了：${prompts.slice(-3).join(" / ")}`);
  assert.deepEqual((await loadStoryDetail(broken.storyId, now))!.changes?.items, [
    { kind: "text", text: "新增注意：全场禁止录像", itemId: second },
    { kind: "text", text: "取消注意：抽选需要序列号", itemId: second },
  ], "模型说不出人话也要把变化列出来");
  wording = "worded";
});

test("时间线角标只在最近 7 天内有醒目变化时出现", async () => {
  const s = await source();
  const g = await story();
  await report(s, g, { hours: 3, deadlines: [{ kind: "event", at: "2026-11-03" }], live: { venue: "Zepp DiverCity", startsTime: "17:00" } });
  assert.equal((await composeStoryDigest(g.storyId)).updated, true);
  await report(s, g, { hours: 2, deadlines: [{ kind: "event", at: "2026-11-05" }], live: { venue: "Zepp DiverCity", startsTime: "16:30" } });
  assert.equal((await composeStoryDigest(g.storyId)).updated, true);

  const q = { channel: "all" as const, category: null, tag: key, subjects: [], now };
  const card = (await loadTimeline(q)).cards.find((c) => c.key === `f${g.factId}`)!;
  assert.deepEqual(card.change?.kinds, ["time"]);
  assert.equal(card.change?.storyPublicId, g.storyPublicId);
  assert.equal(card.change?.at, (await latestVersion(g.storyId)).created_at.toISOString());

  await sql`UPDATE story_digests SET created_at = now() - interval '30 days' WHERE story_id = ${g.storyId}`;
  assert.equal((await loadTimeline(q)).cards.find((c) => c.key === `f${g.factId}`)!.change, undefined, "角标是提醒不是日志，过期就撤");
});

test("纯函数：醒目四类与照列类别，上一版为空或认不出时清单为空", () => {
  const entries = (id: string, day: string, parts: Partial<Record<"structured_fact" | "structured_live" | "structured_release", unknown>>) =>
    changeSnapshot([{ id, at: new Date(`${day}T00:00:00Z`), ...parts }]);
  const before = entries("a1", "2026-10-01", {
    structured_fact: { conditions: [{ text: "抽选需要序列号", quote: "q" }], deadlines: [{ kind: "event", at: "2026-11-03" }] },
    structured_live: { status: "scheduled", venue: "Zepp DiverCity", startsTime: "17:00", rounds: [{ kind: "fc", platform: "official", applyStart: "2026-10-10", applyEnd: null, quote: "" }] },
    structured_release: { releaseOn: "2026-12-01", editions: [{ name: "初回限定盘", priceYen: 5500 }] },
  });
  const after = entries("a2", "2026-10-02", {
    structured_fact: { conditions: [{ text: "每人限购两张", quote: "q2" }], deadlines: [{ kind: "event", at: "2026-11-05" }] },
    structured_live: { status: "postponed", venue: "LINE CUBE SHIBUYA", startsTime: "16:30", rounds: [{ kind: "general", platform: "e+", applyStart: "2026-10-20", applyEnd: null, quote: "" }] },
    structured_release: { releaseOn: "2026-12-03", editions: [{ name: "初回限定盘", priceYen: 6600 }] },
  });

  const diff = diffChangeSnapshots(before, after);
  assert.deepEqual(diff.kinds, ["postponed", "venue", "time"], "只有取消 / 延期 / 会场 / 开演时间敲警钟");
  const kinds = new Set(diff.items.map((i) => i.kind));
  assert.deepEqual([...kinds].sort(), ["postponed", "release", "rounds", "time", "venue"]);
  const texts = diff.items.map((i) => i.text).join(" / ");
  assert.ok(texts.includes("新增价格 初回限定盘 6,600 日元"), texts);
  assert.ok(texts.includes("不再有价格 初回限定盘 5,500 日元"), texts);
  assert.ok(texts.includes("发售日 2026-12-01 → 2026-12-03"), texts);
  assert.ok(texts.includes("受理"), texts);
  assert.deepEqual(diff.text, { added: ["每人限购两张"], removed: ["抽选需要序列号"], itemId: "a2" });
  assert.equal(diff.anchored, true);

  assert.deepEqual(diffChangeSnapshots(null, after), { items: [], kinds: [], text: null, anchored: false }, "上一版认不出就不算变更");
  assert.deepEqual(diffChangeSnapshots(before, []), { items: [], kinds: [], text: null, anchored: false });
  const noAnchor = entries("a3", "2026-10-03", { structured_fact: { conditions: [{ text: "每人限购两张", quote: "q" }] } });
  assert.equal(diffChangeSnapshots(before, noAnchor).anchored, false, "没有日程 / 演出 / 发售这类锚点时不打扰读者");
});
