// 发信：SMTP 传输、发送日志、去重。
//
// 三层保护，缺一个都会出问题：
//   1. 安全阀 EMAIL_ENABLED（和 COLLECT_ENABLED 一样，默认关）：关着的时候连 SMTP 都不连。
//   2. EMAIL_DRY_RUN：走 nodemailer 的 json 传输，把整封信生成出来但不投递，用来对内容掉包。
//   3. email_sends 的 (subscriber_id, dedupe_key) 唯一键：同一个收件人同一封信只会发一次，
//      定时任务重跑、进程中途重启都不会重复打扰读者。
import nodemailer, { type Transporter } from "nodemailer";
import { config, credential } from "../config.ts";
import { sql } from "../db.ts";

export type MailKind = "confirm" | "deadline" | "digest";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** 例如 List-Unsubscribe；只有摘要和提醒信带，确认信不带。 */
  headers?: Record<string, string>;
}

export interface Mailer {
  transporter: Transporter;
  from: string;
  replyTo: string | null;
}

export type MailerState = { ready: true; mailer: Mailer } | { ready: false; reason: string };

let cached: { key: string; mailer: Mailer } | null = null;

/**
 * SMTP 设置在 integrations 组（.env 或 AIHOT_CREDENTIALS_DIR/integrations.env）：
 * SMTP_HOST、SMTP_PORT、SMTP_USER、SMTP_PASS、SMTP_SECURE、EMAIL_FROM、EMAIL_REPLY_TO。
 * 缺任何一项必要的，就当作「没配好」——宁可明说没配，也不要静默地发不出去。
 */
export function mailer(): MailerState {
  if (!config.emailEnabled) return { ready: false, reason: "EMAIL_ENABLED is off" };
  const from = credential("integrations", "EMAIL_FROM");
  if (!from) return { ready: false, reason: "EMAIL_FROM is not configured" };
  const host = credential("integrations", "SMTP_HOST");
  if (!host && !config.emailDryRun) return { ready: false, reason: "SMTP_HOST is not configured" };

  const port = Number.parseInt(credential("integrations", "SMTP_PORT") ?? "587", 10);
  const secureRaw = credential("integrations", "SMTP_SECURE");
  const user = credential("integrations", "SMTP_USER");
  const pass = credential("integrations", "SMTP_PASS");
  const key = JSON.stringify({ dry: config.emailDryRun, host, port, secure: secureRaw, user, from });
  if (cached && cached.key === key) return { ready: true, mailer: cached.mailer };

  const transporter = config.emailDryRun
    // json 传输把整封信（含 MIME 结构）交回来，不碰网络。
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: host!,
        port,
        secure: secureRaw ? secureRaw === "true" : port === 465,
        // 没配账号的通常是本机或内网中继，不加认证。
        ...(user ? { auth: { user, pass: pass ?? "" } } : {}),
        // 网络出问题时不要挂住 worker：连接 10 秒、整体 20 秒。
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
  const mailer = { transporter, from, replyTo: credential("integrations", "EMAIL_REPLY_TO") };
  cached = { key, mailer };
  return { ready: true, mailer };
}

async function send(mail: Mail): Promise<{ status: "sent" | "failed"; response: string }> {
  const state = mailer();
  if (!state.ready) return { status: "failed", response: state.reason };
  try {
    const info = await state.mailer.transporter.sendMail({
      from: state.mailer.from,
      to: mail.to,
      ...(state.mailer.replyTo ? { replyTo: state.mailer.replyTo } : {}),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(mail.headers ? { headers: mail.headers } : {}),
    });
    return { status: "sent", response: (info.messageId ?? "sent").slice(0, 500) };
  } catch (error) {
    // SMTP 的报错常常很长且含地址，只留摘要；不自动重试——下一班定时任务会带上新的去重键。
    return { status: "failed", response: String((error as Error)?.message ?? error).slice(0, 500) };
  }
}

/**
 * 认领一封信：插入 email_sends 并把状态推进到 sending。返回 null 表示这封信已经发过（或正在发），
 * 调用方直接跳过。已失败的可以重发，已发送的不行。
 */
async function claim(subscriberId: number, kind: MailKind, dedupeKey: string, subject: string): Promise<number | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ id: number; status: string }[]>`
      SELECT id, status FROM email_sends
      WHERE subscriber_id = ${subscriberId} AND dedupe_key = ${dedupeKey} FOR UPDATE`;
    if (row?.status === "sent" || row?.status === "sending") return null;
    if (row) {
      const [updated] = await tx<{ id: number }[]>`
        UPDATE email_sends SET status = 'sending', attempts = attempts + 1, subject = ${subject}, updated_at = now()
        WHERE id = ${row.id} RETURNING id`;
      return updated!.id;
    }
    const [inserted] = await tx<{ id: number }[]>`
      INSERT INTO email_sends (subscriber_id, kind, dedupe_key, status, attempts, subject)
      VALUES (${subscriberId}, ${kind}, ${dedupeKey}, 'sending', 1, ${subject}) RETURNING id`;
    return inserted!.id;
  });
}

export interface DeliveryOutcome {
  status: "sent" | "failed" | "skipped";
  response: string;
}

/** 发一封带日志的信。dedupeKey 决定「同一封信」的边界，调用方负责让它一天一个。 */
export async function deliverEmail(
  subscriberId: number,
  kind: MailKind,
  dedupeKey: string,
  mail: Mail,
): Promise<DeliveryOutcome> {
  const id = await claim(subscriberId, kind, dedupeKey, mail.subject);
  if (id === null) return { status: "skipped", response: "already sent" };
  const result = await send(mail);
  await sql`UPDATE email_sends SET status = ${result.status}, response = ${result.response}, sent_at = ${result.status === "sent" ? new Date() : null}, updated_at = now() WHERE id = ${id}`;
  return result;
}

/**
 * 进程在认领之后、记录结果之前被杀掉，会留下一条 sending：超过 15 分钟就当作失败，
 * 让重跑能够补上（收件人最多看到两封，而不是永远收不到）。
 */
export async function markStaleEmailSends(now = new Date()): Promise<number> {
  const rows = await sql`
    UPDATE email_sends SET status = 'failed', response = 'stale claim', updated_at = now()
    WHERE status = 'sending' AND updated_at < ${new Date(now.getTime() - 15 * 60_000)} RETURNING id`;
  return rows.length;
}
