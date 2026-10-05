// 把 fact 挂到它对应的演出上。facts 的属主是 events/（tests/architecture.test.ts 的表属主规则），
// 所以写回 `facts.live_event_id` 的那一句必须在这里，而不是在 lives/ 里；lives/link.ts 只负责算出
// 是哪一场、建好那一行。
import { sql } from "../db.ts";
import { linkFactLiveEvent } from "../lives/link.ts";

/** 挂上一条事实的演出身份，返回 `live_events.id`（推不出来就 null）。 */
export async function linkLiveEvent(factId: number, articleId: string): Promise<number | null> {
  return await sql.begin(async (tx) => {
    const id = await linkFactLiveEvent(tx, factId, articleId);
    if (id === null) return null;
    await tx`UPDATE facts SET live_event_id = ${id}, updated_at = now() WHERE id = ${factId} AND live_event_id IS DISTINCT FROM ${id}`;
    return id;
  });
}
