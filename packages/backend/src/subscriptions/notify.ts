// 两个定时任务：截止提醒和精选摘要。
//
// 每个人单独一封信：乐队过滤、退订链接、去重键都是按人算的。全量数据（雷达、精选）一轮只查一次。
// 没有要紧事就不发信，所以「这次发了 0 封」是正常结果，不是故障。
import { emailStyle } from "@girlsbands/industry/email/registry";
import { beijingDate } from "@girlsbands/contracts/time";
import { config } from "../config.ts";
import { deadlineData, digestData } from "./content.ts";
import { deliverEmail, mailer, markStaleEmailSends } from "./send.ts";
import { recipients } from "./store.ts";

export interface EmailRun {
  sent: number;
  failed: number;
  /** 这个收件人这次没内容可发（不是错误）。 */
  empty: number;
  /** 整轮没跑起来的原因，例如安全阀关着。 */
  reason?: string;
}

const style = () => emailStyle(config.emailStyle);

/** 发信前先确认这条路是通的；发不出去就明说，不要一行行地失败。 */
async function canRun(): Promise<string | null> {
  if (!config.emailEnabled) return "EMAIL_ENABLED is off";
  const state = mailer();
  return state.ready ? null : (state as { reason: string }).reason;
}

export async function sendDeadlineReminders(now = new Date()): Promise<EmailRun> {
  const blocked = await canRun();
  if (blocked) return { sent: 0, failed: 0, empty: 0, reason: blocked };
  await markStaleEmailSends(now);
  const list = await recipients("deadline");
  const dedupeKey = `deadline:${beijingDate(now)}`;
  const render = style();
  let sent = 0;
  let failed = 0;
  let empty = 0;
  for (const recipient of list) {
    try {
      const data = await deadlineData(recipient, now);
      if (!data) {
        empty += 1;
        continue;
      }
      const mail = render.render(data);
      const outcome = await deliverEmail(recipient.id, "deadline", dedupeKey, {
        to: recipient.email,
        ...mail,
        headers: listHeaders(recipient.token),
      });
      if (outcome.status === "sent") sent += 1;
      else if (outcome.status === "failed") failed += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ level: "warn", msg: "deadline reminder failed", subscriber: recipient.id, error: String(error) }));
    }
  }
  return { sent, failed, empty };
}

export async function sendDigest(now = new Date()): Promise<EmailRun> {
  const blocked = await canRun();
  if (blocked) return { sent: 0, failed: 0, empty: 0, reason: blocked };
  await markStaleEmailSends(now);
  const list = await recipients("digest");
  const dedupeKey = `digest:${beijingDate(now)}`;
  const render = style();
  let sent = 0;
  let failed = 0;
  let empty = 0;
  for (const recipient of list) {
    try {
      const data = await digestData(recipient, now);
      if (!data) {
        empty += 1;
        continue;
      }
      const mail = render.render(data);
      const outcome = await deliverEmail(recipient.id, "digest", dedupeKey, {
        to: recipient.email,
        ...mail,
        headers: listHeaders(recipient.token),
      });
      if (outcome.status === "sent") sent += 1;
      else if (outcome.status === "failed") failed += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ level: "warn", msg: "digest failed", subscriber: recipient.id, error: String(error) }));
    }
  }
  return { sent, failed, empty };
}

/**
 * 邮件客户端自带的「退订」按钮（RFC 8058）：只接受 POST，扫描器点不到，读者不用翻到信底。
 * 确认信不带——那封信里还没有「订阅」这回事。
 */
function listHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${config.siteUrl}/api/site/subscribe/one-click?token=${encodeURIComponent(token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
