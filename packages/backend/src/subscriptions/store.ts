// 订阅者：一个邮箱一行。这里只做存取和状态流转，不发信（发送在 send.ts，内容在 content.ts）。
//
// 两条不能破的规矩：
//   1. 公开接口永远不告诉调用方「这个邮箱是否已经订阅」——只回一句「去收信」。
//   2. 确认信必须由收信人点一下才生效。没有这一步，任何人都能把别人的邮箱订上。
import { randomBytes } from "node:crypto";
import { ENTITIES } from "@aihot/industry/taxonomy";
import { sql, type Db } from "../db.ts";

export type SubscriberStatus = "pending" | "confirmed" | "unsubscribed" | "bounced";

/** 一封信能带的乐队数上限：够用，又不至于让一封邮件长到没人看。 */
const BAND_LIMIT = 40;
const EMAIL_MAX = 254;
const CONFIRM_TTL_MS = 48 * 3600_000;
/** 和反馈同一套宽松校验：真正的可达性由确认信证明，这里只挡住明显不是地址的东西。 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Subscriber {
  id: number;
  email: string;
  status: SubscriberStatus;
  token: string;
  confirmToken: string;
  confirmExpiresAt: Date | null;
  bands: string[];
  wantsDeadlines: boolean;
  wantsDigest: boolean;
  confirmedAt: Date | null;
  unsubscribedAt: Date | null;
  createdAt: Date;
}

interface Row {
  id: number;
  email: string;
  email_key: string;
  status: SubscriberStatus;
  token: string;
  confirm_token: string;
  confirm_expires_at: Date | null;
  wants_deadlines: boolean;
  wants_digest: boolean;
  confirmed_at: Date | null;
  unsubscribed_at: Date | null;
  created_at: Date;
}

const COLUMNS = sql`id, email, email_key, status, token, confirm_token, confirm_expires_at,
                    wants_deadlines, wants_digest, confirmed_at, unsubscribed_at, created_at`;

/** 小写并去掉首尾空白；不是地址就返回 null。 */
export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value.length < 5 || value.length > EMAIL_MAX) return null;
  if (!EMAIL_SHAPE.test(value)) return null;
  return value;
}

/** 只保留本站认识的乐队或企划 id：写进库的每个值都能在页面上渲染出名字。乐队与企划是两种 kind
 *  （industry/taxonomy.ts），都可以订阅；只是渲染时不能把企划当乐队叫。 */
export function cleanBands(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    const key = String(id).trim();
    if (key in ENTITIES) seen.add(key);
    if (seen.size >= BAND_LIMIT) break;
  }
  return [...seen];
}

const token = () => randomBytes(24).toString("base64url");

async function bandsOf(id: number, tx: Db = sql): Promise<string[]> {
  const rows = await tx<{ entity_id: string }[]>`
    SELECT entity_id FROM subscriber_bands WHERE subscriber_id = ${id} ORDER BY entity_id`;
  return rows.map((r) => r.entity_id);
}

async function hydrate(row: Row, tx: Db = sql): Promise<Subscriber> {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    token: row.token,
    confirmToken: row.confirm_token,
    confirmExpiresAt: row.confirm_expires_at,
    bands: await bandsOf(row.id, tx),
    wantsDeadlines: row.wants_deadlines,
    wantsDigest: row.wants_digest,
    confirmedAt: row.confirmed_at,
    unsubscribedAt: row.unsubscribed_at,
    createdAt: row.created_at,
  };
}

export async function byToken(value: string): Promise<Subscriber | null> {
  if (!value || value.length > 200) return null;
  const [row] = await sql<Row[]>`SELECT ${COLUMNS} FROM subscribers WHERE token = ${value}`;
  return row ? hydrate(row) : null;
}

async function setBands(id: number, bands: string[], tx: Db): Promise<void> {
  await tx`DELETE FROM subscriber_bands WHERE subscriber_id = ${id}`;
  for (const entityId of bands) {
    await tx`INSERT INTO subscriber_bands (subscriber_id, entity_id) VALUES (${id}, ${entityId})
             ON CONFLICT DO NOTHING`;
  }
}

export interface SubscribeInput {
  email: string;
  bands: string[];
  wantsDeadlines: boolean;
  wantsDigest: boolean;
  source?: string | null;
  sourceHash?: string | null;
}

export interface SubscribeOutcome {
  /** 已确认的老订阅者：不动他的设置，也不再发信。 */
  alreadyConfirmed: boolean;
  /** 需要发一封确认信（新订阅，或确认信过期/退订后重新订阅）。 */
  needsConfirm: boolean;
  subscriber: Subscriber;
}

/**
 * 公开接口的入口。已确认的邮箱不做任何修改：一个未经验证的 POST 不该能改别人的收信设置，
 * 想改乐队得用邮件里那条带令牌的链接。
 */
export async function subscribe(input: SubscribeInput): Promise<SubscribeOutcome | null> {
  const emailKey = normalizeEmail(input.email);
  if (!emailKey) return null;
  const bands = cleanBands(input.bands);

  return sql.begin(async (tx) => {
    const [existing] = await tx<Row[]>`SELECT ${COLUMNS} FROM subscribers WHERE email_key = ${emailKey} FOR UPDATE`;
    if (existing && existing.status === "confirmed") {
      return { alreadyConfirmed: true, needsConfirm: false, subscriber: await hydrate(existing, tx) };
    }
    if (existing) {
      // 待确认、已退订、退信：都重新发一封确认信，确认令牌轮换（旧链接随即作废）。
      const [row] = await tx<Row[]>`
        UPDATE subscribers
        SET email = ${input.email.trim()}, status = 'pending', token = ${token()}, confirm_token = ${token()},
            confirm_expires_at = ${new Date(Date.now() + CONFIRM_TTL_MS)},
            wants_deadlines = ${input.wantsDeadlines}, wants_digest = ${input.wantsDigest},
            source = ${input.source ?? null}, source_hash = ${input.sourceHash ?? null},
            unsubscribed_at = NULL, updated_at = now()
        WHERE id = ${existing.id} RETURNING ${COLUMNS}`;
      await setBands(existing.id, bands, tx);
      return { alreadyConfirmed: false, needsConfirm: true, subscriber: await hydrate(row!, tx) };
    }
    const [row] = await tx<Row[]>`
      INSERT INTO subscribers (email, email_key, status, token, confirm_token, confirm_expires_at,
                               wants_deadlines, wants_digest, source, source_hash)
      VALUES (${input.email.trim()}, ${emailKey}, 'pending', ${token()}, ${token()},
              ${new Date(Date.now() + CONFIRM_TTL_MS)}, ${input.wantsDeadlines}, ${input.wantsDigest},
              ${input.source ?? null}, ${input.sourceHash ?? null})
      RETURNING ${COLUMNS}`;
    await setBands(row!.id, bands, tx);
    return { alreadyConfirmed: false, needsConfirm: true, subscriber: await hydrate(row!, tx) };
  });
}

export type ConfirmResult =
  | { ok: true; subscriber: Subscriber }
  | { ok: false; reason: "invalid" | "expired" };

export async function confirm(value: string): Promise<ConfirmResult> {
  if (!value || value.length > 200) return { ok: false, reason: "invalid" };
  const [row] = await sql<Row[]>`SELECT ${COLUMNS} FROM subscribers WHERE confirm_token = ${value}`;
  if (!row) return { ok: false, reason: "invalid" };
  if (row.status === "confirmed") return { ok: true, subscriber: await hydrate(row) };
  if (!row.confirm_expires_at || row.confirm_expires_at.getTime() < Date.now()) return { ok: false, reason: "expired" };
  const [updated] = await sql<Row[]>`
    UPDATE subscribers
    SET status = 'confirmed', confirmed_at = now(), unsubscribed_at = NULL,
        -- 确认令牌用完就换掉：同一封邮件里的链接点第二次不该再有作用。
        confirm_token = ${token()}, confirm_expires_at = NULL, updated_at = now()
    WHERE id = ${row.id} RETURNING ${COLUMNS}`;
  return { ok: true, subscriber: await hydrate(updated!) };
}

export interface PreferencesInput {
  bands: string[];
  wantsDeadlines: boolean;
  wantsDigest: boolean;
}

/** 改偏好。已退订的人改偏好等于重新订阅：他自己点的链接，不用再确认一次。 */
export async function updatePreferences(value: string, input: PreferencesInput): Promise<Subscriber | null> {
  const current = await byToken(value);
  if (!current) return null;
  const bands = cleanBands(input.bands);
  return sql.begin(async (tx) => {
    const [row] = await tx<Row[]>`
      UPDATE subscribers
      SET status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), unsubscribed_at = NULL,
          wants_deadlines = ${input.wantsDeadlines}, wants_digest = ${input.wantsDigest}, updated_at = now()
      WHERE id = ${current.id} RETURNING ${COLUMNS}`;
    await setBands(current.id, bands, tx);
    return hydrate(row!, tx);
  });
}

export async function unsubscribe(value: string): Promise<boolean> {
  if (!value || value.length > 200) return false;
  const rows = await sql`
    UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = now(), updated_at = now()
    WHERE token = ${value} AND status <> 'unsubscribed' RETURNING id`;
  return rows.length > 0;
}

export interface Recipient {
  id: number;
  email: string;
  token: string;
  bands: string[];
}

/** 确认过、没退订、并且开着这一类邮件的人。乐队过滤交给调用方（内容已经算好一次了）。 */
export async function recipients(kind: "deadline" | "digest", limit = 5000): Promise<Recipient[]> {
  const column = kind === "deadline" ? sql`wants_deadlines` : sql`wants_digest`;
  const rows = await sql<{ id: number; email: string; token: string; bands: string[] | null }[]>`
    SELECT s.id, s.email, s.token,
           (SELECT array_agg(b.entity_id ORDER BY b.entity_id) FROM subscriber_bands b WHERE b.subscriber_id = s.id) AS bands
    FROM subscribers s
    WHERE s.status = 'confirmed' AND ${column}
    ORDER BY s.id LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, email: r.email, token: r.token, bands: r.bands ?? [] }));
}

/** 一次发信运行的人数与开关，用于日志和后台。 */
export async function subscriberCounts(): Promise<{ confirmed: number; pending: number; unsubscribed: number }> {
  const rows = await sql<{ status: SubscriberStatus; n: number }[]>`
    SELECT status, count(*)::int AS n FROM subscribers GROUP BY status`;
  const at = (s: SubscriberStatus) => rows.find((r) => r.status === s)?.n ?? 0;
  return { confirmed: at("confirmed"), pending: at("pending"), unsubscribed: at("unsubscribed") };
}
