// 把 fact 挂到它对应的演出上。facts 的属主是 events/（tests/architecture.test.ts 的表属主规则），
// 所以写回 `facts.live_event_id` 的那一句必须在这里，而不是在 lives/ 里；lives/link.ts 只负责算出
// 是哪一场、建好那一行。轮次（ticket_rounds）由 lives/tickets.ts 写，这里只按顺序调用。
import { sql } from "../db.ts";
import { linkFactLiveEvent } from "../lives/link.ts";
import { syncFactTicketRounds } from "../lives/tickets.ts";

/**
 * 挂上一条事实的演出身份，返回 `live_events.id`（推不出来就 null）。同一场演出的后续报告也会走到
 * 这里：那时身份不变，但公告里可能第一次写出受理日期，所以每次同步都读一遍轮次（只补空，不会重复）。
 */
export async function linkLiveEvent(factId: number, articleId: string): Promise<number | null> {
  return await sql.begin(async (tx) => {
    const id = await linkFactLiveEvent(tx, factId, articleId);
    if (id === null) return null;
    await tx`UPDATE facts SET live_event_id = ${id}, updated_at = now() WHERE id = ${factId} AND live_event_id IS DISTINCT FROM ${id}`;
    await syncFactTicketRounds(tx, id, factId, articleId);
    return id;
  });
}
