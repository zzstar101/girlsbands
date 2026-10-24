// 一场演出的每一次受理（ticket_rounds）。写入点与 live_events 相同：events/live.ts 把 fact 挂上演出之后
// 紧跟一次同步 —— 演出名与轮次出自同一个模型步骤（editorial/analyze.ts 的 live-ticket），拆成两次调用
// 只会多花钱。
//
// 轮次只补空、不覆盖：同一条公告重跑两次不会写第二行（唯一索引），后来的报告能补上截止日、当落日与
// 缴款期限。每补上一种节点，就往 ticket_round_events 追加一行（append-only 的时间线）；页面上的状态
// 是读取时按日期与这条时间线算出来的，库里不存副本。
import { TICKET_ROUND_KINDS, type TicketRoundKind, type Timezone } from "@girlsbands/contracts/site";
import type { Db } from "../db.ts";
import { newShortId } from "../lib/ids.ts";
import { isTimezone, splitDeadlineAt, statedTimezone, timezoneOf } from "../sources/timezone.ts";

const KINDS: ReadonlySet<string> = new Set<string>(TICKET_ROUND_KINDS);

/** 落库前再验一遍：`analyses.output` 是模型写的 JSON，读回来不能当真。 */
interface StoredRound {
  kind: TicketRoundKind;
  platform: string | null;
  applyStart: string | null;
  applyEnd: string | null;
  resultOn: string | null;
  paymentDueOn: string | null;
  quote: string | null;
}

/** `YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm`，与 deadlines 的 `at` 同一套形状；splitDeadlineAt 自己会验。 */
function atOf(value: unknown): string | null {
  return typeof value === "string" && splitDeadlineAt(value) ? value : null;
}

function roundOf(value: unknown): StoredRound | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const round: StoredRound = {
    kind: typeof r.kind === "string" && KINDS.has(r.kind) ? (r.kind as TicketRoundKind) : "general",
    platform: typeof r.platform === "string" && r.platform.trim() ? r.platform.trim().slice(0, 60) : null,
    applyStart: atOf(r.applyStart),
    applyEnd: atOf(r.applyEnd),
    resultOn: atOf(r.resultOn),
    paymentDueOn: atOf(r.paymentDueOn),
    quote: typeof r.quote === "string" && r.quote.trim() ? r.quote.trim().slice(0, 600) : null,
  };
  // 一个日期都没有的轮次不落库：它不能给读者任何可行动的日期，页面上的状态也无从谈起。
  return round.applyStart || round.applyEnd || round.resultOn || round.paymentDueOn ? round : null;
}

async function writeRound(
  db: Db,
  liveEventId: number,
  factId: number,
  articleId: string,
  round: StoredRound,
  timezone: Timezone,
  zoneStated: boolean,
  observedAt: Date,
): Promise<void> {
  const [saved] = await db<{ id: string }[]>`
    INSERT INTO ticket_rounds (public_id, live_event_id, kind, platform, timezone, apply_start_at, apply_end_at,
                               result_on, payment_due_on, first_fact_id, first_article_id, quote, first_seen_at, updated_at)
    VALUES (${`t${newShortId(8)}`}, ${liveEventId}, ${round.kind}, ${round.platform}, ${timezone}, ${round.applyStart},
            ${round.applyEnd}, ${round.resultOn}, ${round.paymentDueOn}, ${factId}, ${articleId}, ${round.quote},
            ${observedAt}, ${observedAt})
    ON CONFLICT (live_event_id, kind, COALESCE(substring(apply_start_at FROM 1 FOR 10), '')) DO UPDATE SET
      platform = COALESCE(ticket_rounds.platform, EXCLUDED.platform),
      -- 公告点名了钟（「現地時間」）才改；只有来源的钟时不动已经存下的。
      timezone = CASE WHEN ${zoneStated} THEN EXCLUDED.timezone ELSE ticket_rounds.timezone END,
      -- 唯一会被后一条报告改掉的日期：原先只写到日、新的写明了时刻。那是精度变好，不是改期。
      apply_start_at = CASE
        WHEN ticket_rounds.apply_start_at LIKE '____-__-__' AND EXCLUDED.apply_start_at LIKE '____-__-__T%'
          THEN EXCLUDED.apply_start_at
        ELSE COALESCE(ticket_rounds.apply_start_at, EXCLUDED.apply_start_at) END,
      apply_end_at = COALESCE(ticket_rounds.apply_end_at, EXCLUDED.apply_end_at),
      result_on = COALESCE(ticket_rounds.result_on, EXCLUDED.result_on),
      payment_due_on = COALESCE(ticket_rounds.payment_due_on, EXCLUDED.payment_due_on),
      quote = COALESCE(ticket_rounds.quote, EXCLUDED.quote),
      first_fact_id = COALESCE(ticket_rounds.first_fact_id, EXCLUDED.first_fact_id),
      first_article_id = COALESCE(ticket_rounds.first_article_id, EXCLUDED.first_article_id),
      updated_at = EXCLUDED.updated_at
    RETURNING id`;
  if (!saved) return;
  // 时间线：某一种节点第一次出现时追加一行；重复同步撞唯一索引，什么也不写。
  await db`
    INSERT INTO ticket_round_events (ticket_round_id, kind, observed_at, fact_id, quote)
    SELECT ${Number(saved.id)}, e.kind, ${observedAt}, ${factId}, ${round.quote}
    FROM (VALUES
      ('opened', ${round.applyStart}::text),
      ('closed', ${round.applyEnd}::text),
      ('result', ${round.resultOn}::text),
      ('payment_due', ${round.paymentDueOn}::text)
    ) AS e(kind, at)
    WHERE e.at IS NOT NULL
    ON CONFLICT (ticket_round_id, kind) DO NOTHING`;
}

/**
 * 把一条公告里读出来的轮次写进库里（`analyses.output.live.rounds`，由 live 步骤写入）。返回写下的轮次数；
 * 公告里没讲受理就是 0，不是错误。
 */
export async function syncFactTicketRounds(
  db: Db,
  liveEventId: number,
  factId: number,
  articleId: string,
  observedAt = new Date(),
): Promise<number> {
  const rows = await db<{ config: Record<string, unknown> | null; rounds: unknown; live_zone: string | null }[]>`
    SELECT s.config, an.output->'live'->'rounds' AS rounds,
           (SELECT timezone FROM live_events WHERE id = ${liveEventId}) AS live_zone
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN LATERAL (
      SELECT output FROM analyses WHERE article_id = a.id ORDER BY input_revision DESC, id DESC LIMIT 1
    ) an ON true
    WHERE a.id = ${articleId}`;
  const row = rows[0];
  if (!row) return 0;
  const sourceZone = timezoneOf(row.config);
  const liveZone = isTimezone(row.live_zone) ? row.live_zone : null;
  const stored = Array.isArray(row.rounds) ? row.rounds : [];
  const rounds = stored.map(roundOf).filter((r): r is StoredRound => r !== null).slice(0, 6);
  for (const round of rounds) {
    // 一轮受理的时刻只在它自己那句话写明「現地時間」或点名了钟时才换钟，否则还是来源那一地的钟。
    const stated = round.quote ? statedTimezone(round.quote, liveZone) : null;
    await writeRound(db, liveEventId, factId, articleId, round, stated ?? sourceZone, stated !== null, observedAt);
  }
  return rounds.length;
}
