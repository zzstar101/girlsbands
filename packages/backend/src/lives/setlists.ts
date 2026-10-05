// 演出散场之后的曲目单（W16）。这里有两件事，也是 setlist_entries 与 live_events.setlist_scanned_at
// 的唯一写入点（架构测试的 OWNERS 表）：散场之后的一次性扫描（sweepSetlists），以及后台把读者通过
// /feedback 补的那份采纳进来（adoptReaderSetlist）。
//
// 扫描只对已经结束的演出跑：结果写进 live_events.setlist_scanned_at —— 页面据此区分「还没找过」与
// 「找过，原文里确实没有」。同一篇公告重跑不重复付费（回执按输入去重）；找过之后又有新报道进来，
// 那一场会再看一眼（散场当晚报没写曲目单、第二天补发的情况很常见）。
import { config } from "../config.ts";
import { sql, type Db } from "../db.ts";
import { audit } from "../audit.ts";
import { loadAnalyzeInput } from "../editorial/input.ts";
import { MAX_SETLIST_ENTRIES, extractSetlist, type SetlistLine } from "../editorial/setlist.ts";
import { collapseWhitespace } from "../lib/text.ts";
import { isFinished, type StageInput } from "./stage.ts";

/** 一次扫描最多处理几场：每一场都要花几次模型调用，宁可下一个小时再来。 */
const MAX_PER_SWEEP = 5;
/** 一场演出最多读几篇报告：曲目单一般就在散场之后的那一两篇里。 */
const MAX_REPORTS = 3;

export interface SetlistSweepResult {
  /** 这一轮真正问过的场次数。 */
  scanned: number;
  /** 落库的曲目行数。 */
  entries: number;
  /** 一篇都没问成的场次数（模型报错）：它们不会被标成「找过了」，下一轮重试。 */
  failed: number;
  /** 模型调用被关掉时不去试，也不报错 —— 那是配置，不是故障。 */
  skipped?: "model-calls-disabled";
}

/**
 * 散场之后的扫描：找出已经结束、还没找过曲目单的演出，拿它最新的一两篇报告去问模型。第一篇里问答出
 * 曲目就用它，然后记下「找过了」；一篇都没有也记 —— 页面要能说清「找过，原文里没有」。问不出来的
 * 那一场留白，下一个小时再来，不让一次模型故障变成永久的空白。找过之后又有新报道的那一场也要再看一眼：
 * 散场当晚的报道常常还没写曲目单。
 */
export async function sweepSetlists(now = new Date()): Promise<SetlistSweepResult> {
  if (!config.modelCallsEnabled) return { scanned: 0, entries: 0, failed: 0, skipped: "model-calls-disabled" };
  const candidates = await sql<(StageInput & { id: number })[]>`
    SELECT le.id, le.status, le.starts_on::text AS starts_on, le.ends_on::text AS ends_on, le.timezone
    FROM live_events le
    WHERE le.status = 'scheduled'
      AND (le.setlist_scanned_at IS NULL OR EXISTS (
        SELECT 1 FROM facts f
        JOIN fact_articles fa ON fa.fact_id = f.id
        JOIN articles a ON a.id = fa.article_id
        WHERE f.live_event_id = le.id AND a.discovered_at > le.setlist_scanned_at
      ))
    ORDER BY COALESCE(le.ends_on, le.starts_on) DESC
    LIMIT 50`;
  let scanned = 0;
  let entries = 0;
  let failed = 0;
  for (const live of candidates.filter((row) => isFinished(row, now)).slice(0, MAX_PER_SWEEP)) {
    const found = await scanLive(live.id, now);
    if (found === null) {
      failed += 1;
      continue;
    }
    scanned += 1;
    entries += found;
  }
  return { scanned, entries, failed };
}

/** 一场演出：问过的报告里第一篇有曲目的就是它。返回落库行数，一篇都没问成时返回 null。 */
async function scanLive(liveEventId: number, now: Date): Promise<number | null> {
  const articles = await sql<{ id: string }[]>`
    SELECT fa.article_id AS id
    FROM facts f
    JOIN fact_articles fa ON fa.fact_id = f.id
    JOIN articles a ON a.id = fa.article_id
    WHERE f.live_event_id = ${liveEventId}
    GROUP BY fa.article_id
    ORDER BY max(a.published_at) DESC NULLS LAST
    LIMIT ${MAX_REPORTS}`;
  let asked = false;
  for (const article of articles) {
    let lines: SetlistLine[];
    try {
      const input = await loadAnalyzeInput(article.id);
      if (!input) continue;
      lines = (await extractSetlist(input, { attemptTag: `setlist-${liveEventId}` })).lines;
    } catch {
      // 这一步失败只说明这篇没问成：换下一篇，都不成的话整场留白给下一轮。
      continue;
    }
    asked = true;
    if (lines.length > 0) {
      await replaceArticleLines(liveEventId, article.id, lines, now);
      return lines.length;
    }
  }
  if (!asked) return null;
  await sql`UPDATE live_events SET setlist_scanned_at = ${now} WHERE id = ${liveEventId}`;
  return 0;
}

/** 某一篇公告抽到的曲目单：先把这场演出已有的 article 行清掉再写（重扫不叠加，读者补的行不动）。 */
async function replaceArticleLines(liveEventId: number, articleId: string, lines: SetlistLine[], now: Date): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM setlist_entries WHERE live_event_id = ${liveEventId} AND source = 'article'`;
    let position = 0;
    for (const line of lines) {
      position += 1;
      await insertLine(tx, liveEventId, "article", position, line, articleId);
    }
    await tx`UPDATE live_events SET setlist_scanned_at = ${now} WHERE id = ${liveEventId}`;
  });
}

async function insertLine(db: Db, liveEventId: number, source: "article" | "reader", position: number, line: SetlistLine, articleId: string | null): Promise<void> {
  await db`INSERT INTO setlist_entries (live_event_id, source, position, title, is_encore, is_cover, quote, article_id)
           VALUES (${liveEventId}, ${source}, ${position}, ${line.title}, ${line.isEncore}, ${line.isCover}, ${line.quote}, ${articleId})`;
}

export type ReaderSetlistResult =
  | { ok: true; liveEventId: number; added: number }
  | { ok: false; reason: "not-found" | "no-target" | "no-lines" };

/**
 * 后台把读者补的一份曲目单采纳进来：反馈的 page_url 指回是哪个页面（演出页直接认 public_id；事件页认
 * 它挂着的那一场），content 里一行一首（一行一首怎么认，见 parseReaderLines）。先把这个演出的 reader
 * 行清掉再写，点两次不会写两份。
 */
export async function adoptReaderSetlist(feedbackId: number, actor: string): Promise<ReaderSetlistResult> {
  const [feedback] = await sql<{ content: string; page_url: string | null }[]>`
    SELECT content, page_url FROM feedback WHERE id = ${feedbackId}`;
  if (!feedback) return { ok: false, reason: "not-found" };
  const liveEventId = await liveEventOf(feedback.page_url);
  if (liveEventId === null) return { ok: false, reason: "no-target" };
  const lines = parseReaderLines(feedback.content);
  if (lines.length === 0) return { ok: false, reason: "no-lines" };
  await sql.begin(async (tx) => {
    await tx`DELETE FROM setlist_entries WHERE live_event_id = ${liveEventId} AND source = 'reader'`;
    let position = 0;
    for (const line of lines) {
      position += 1;
      await insertLine(tx, liveEventId, "reader", position, line, null);
    }
  });
  await audit(actor, "feedback.setlist", `feedback:${feedbackId}`, "采纳为演出的曲目单", null, { liveEventId, added: lines.length });
  return { ok: true, liveEventId, added: lines.length };
}

/** 反馈是从哪个页面发来的：演出页与事件页都认，其它一律不认（让管理员去演出页补）。 */
async function liveEventOf(pageUrl: string | null): Promise<number | null> {
  if (!pageUrl) return null;
  const live = /\/live\/([A-Za-z0-9_-]+)/.exec(pageUrl);
  if (live) {
    const [row] = await sql<{ id: number }[]>`SELECT id FROM live_events WHERE public_id = ${live[1]}`;
    return row?.id ?? null;
  }
  const story = /\/story\/([A-Za-z0-9_-]+)/.exec(pageUrl);
  if (story) {
    const [row] = await sql<{ id: number }[]>`
      SELECT le.id FROM live_events le
      JOIN stories st0 ON st0.id = le.story_id
      JOIN stories st ON st.id = COALESCE(st0.merged_into, st0.id)
      WHERE st.public_id = ${story[1]}
      ORDER BY le.starts_on DESC
      LIMIT 1`;
    return row?.id ?? null;
  }
  return null;
}

/** 「アンコール」单独成行：它后面的是安可曲。 */
const ENCORE_HEAD = /^(?:アンコール曲?|encore|安可|返场|返場)[\s:：。．.\-—–]*$/i;
/** 只说明「这是曲目单」的标题行，不是歌名。 */
const HEAD = /^(?:セットリスト|セトリ|曲目リスト?|曲目|歌单|曲目单|本編|本编)[\s:：。．.\-—–]*$/i;
const COVER = /(?:カバー|カヴァー|翻唱|cover)/i;
/** 行首的编号与项目符号：M12 / No.3 / 3. / - 。 */
const NUMBERING = /^\s*(?:M\s*\d{1,2}|No\.?\s*\d{1,2}|\d{1,2}\s*[.、)．]|[-–—*・•·>])\s*/;
/** 曲名外面那层引号与括号不属于歌名。 */
const WRAPPED = /^["'「『（(“]+|["'」』）)”]+$/g;
/** 结尾那层只写「翻唱」的括号也剥掉：它已经落在 is_cover 上。 */
const COVER_TAIL = /[\s(（[]*(?:カバー|カヴァー|翻唱|cover)[\s)）\]]*$/i;

/**
 * 读者写的一行一首。空行与「曲目单」这类标题行丢掉；アンコール那一行之后的行算安可；行里提到翻唱就算
 * 翻唱。曲名照读者写的留着（不中译、不猜），quote 存原始那一行。
 */
export function parseReaderLines(text: string): SetlistLine[] {
  const lines: SetlistLine[] = [];
  let encore = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (ENCORE_HEAD.test(line)) {
      encore = true;
      continue;
    }
    if (HEAD.test(line)) continue;
    const title = cleanTitle(line);
    if (!title) continue;
    lines.push({ title: title.slice(0, 120), isEncore: encore, isCover: COVER.test(line), quote: line.slice(0, 500) });
    if (lines.length >= MAX_SETLIST_ENTRIES) break;
  }
  return lines;
}

function cleanTitle(line: string): string {
  let title = line.replace(NUMBERING, "").replace(COVER_TAIL, "").trim();
  for (let previous = ""; previous !== title;) {
    previous = title;
    title = title.replace(WRAPPED, "").trim();
  }
  return collapseWhitespace(title);
}
