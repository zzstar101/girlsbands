// 邮件订阅的公开接口：不泄露「这个地址订没订过」，改设置必须带令牌，退订在浏览器里是两步、
// 在邮件客户端里是一键。
import "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { buildApp } from "../apps/api/src/app.ts";

const app = await buildApp();
const saved = { enabled: config.emailEnabled, dryRun: config.emailDryRun };

before(() => {
  process.env.EMAIL_FROM = "AniBand Radar <radar@example.org>";
  config.emailEnabled = true;
  config.emailDryRun = true;
});
after(async () => {
  config.emailEnabled = saved.enabled;
  config.emailDryRun = saved.dryRun;
  delete process.env.EMAIL_FROM;
  await app.close();
  await closeDb();
});

// Every request claims a different client address: the per-source limiter is meant to stop a person
// hammering the endpoint, not this test.
let ip = 0;
const from = () => `10.9.${Math.floor((ip += 1) / 250)}.${ip % 250}`;
const inject = (opts: { method: "GET" | "POST"; url: string; payload?: unknown }) =>
  app.inject({
    method: opts.method,
    url: opts.url,
    headers: { "x-real-ip": from(), "user-agent": "test" },
    ...(opts.payload === undefined ? {} : { payload: opts.payload as object }),
  });

let n = 0;
const address = () => `route-${Date.now()}-${(n += 1)}@example.org`;

test("with the valve off the endpoint says so plainly and writes nothing", async () => {
  config.emailEnabled = false;
  try {
    const res = await inject({ method: "POST", url: "/api/site/subscribe", payload: { email: address(), bands: [] } });
    assert.equal(res.statusCode, 503);
    assert.match(String(res.headers["content-type"]), /^application\/problem\+json/);
    assert.equal(res.json().detail, "邮件订阅暂未开放。");
    assert.equal(res.headers["retry-after"], "3600");
    assert.equal(await rowCount(), 0, "no half-finished subscriber row is left behind");
  } finally {
    config.emailEnabled = true;
  }
});

async function rowCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM subscribers`;
  return row!.n;
}

test("a malformed address is refused without a hint about anyone else's subscription", async () => {
  const res = await inject({ method: "POST", url: "/api/site/subscribe", payload: { email: "not-an-address" } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().detail, "邮箱格式不正确。");
});

test("subscribing sends exactly one confirmation mail and answers the same thing twice", async () => {
  const email = address();
  const first = await inject({
    method: "POST",
    url: "/api/site/subscribe",
    payload: { email, bands: ["mygo", "not-a-band"], wantsDeadlines: true, wantsDigest: false },
  });
  assert.equal(first.statusCode, 202, first.body);
  assert.deepEqual(first.json(), { ok: true });
  assert.equal(first.headers["cache-control"], "no-store");

  const [row] = await sql<{ id: number; status: string; token: string; confirm_token: string }[]>`
    SELECT id, status, token, confirm_token FROM subscribers WHERE email_key = ${email}`;
  assert.ok(row);
  assert.equal(row!.status, "pending");
  const [band] = await sql<{ entity_id: string }[]>`SELECT entity_id FROM subscriber_bands WHERE subscriber_id = ${row!.id}`;
  assert.equal(band!.entity_id, "mygo");

  const [send] = await sql<{ kind: string; status: string; dedupe_key: string }[]>`
    SELECT kind, status, dedupe_key FROM email_sends WHERE subscriber_id = ${row!.id}`;
  assert.equal(send!.kind, "confirm");
  assert.equal(send!.status, "sent");
  assert.equal(send!.dedupe_key, `confirm:${row!.confirm_token}`);

  // Confirming, then submitting the same address again: same answer, and no second letter.
  const confirmed = await inject({ method: "GET", url: `/api/site/subscribe/confirm?token=${row!.confirm_token}` });
  assert.equal(confirmed.statusCode, 302);
  assert.equal(confirmed.headers.location, "/subscribe/confirmed?state=ok");

  const again = await inject({ method: "POST", url: "/api/site/subscribe", payload: { email, bands: ["roselia"], wantsDeadlines: false, wantsDigest: true } });
  assert.equal(again.statusCode, 202);
  assert.deepEqual(again.json(), { ok: true });
  const sends = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM email_sends WHERE subscriber_id = ${row!.id}`;
  assert.equal(sends[0]!.n, 1);
  const state = await inject({ method: "GET", url: `/api/site/subscribe/state?token=${row!.token}` });
  assert.deepEqual(state.json(), { email, bands: ["mygo"], wantsDeadlines: true, wantsDigest: false, confirmed: true });
});

test("a used or unknown confirmation link lands on a Chinese page, never a JSON error", async () => {
  const unknown = await inject({ method: "GET", url: "/api/site/subscribe/confirm?token=nope" });
  assert.equal(unknown.statusCode, 302);
  assert.equal(unknown.headers.location, "/subscribe/confirmed?state=invalid");

  const out = await inject({ method: "POST", url: "/api/site/subscribe", payload: { email: address() } });
  assert.equal(out.statusCode, 202);
  const [row] = await sql<{ confirm_token: string }[]>`SELECT confirm_token FROM subscribers ORDER BY id DESC LIMIT 1`;
  assert.equal((await inject({ method: "GET", url: `/api/site/subscribe/confirm?token=${row!.confirm_token}` })).headers.location, "/subscribe/confirmed?state=ok");
  assert.equal((await inject({ method: "GET", url: `/api/site/subscribe/confirm?token=${row!.confirm_token}` })).headers.location, "/subscribe/confirmed?state=invalid");
});

test("an expired confirmation link says expired, not invalid", async () => {
  const out = await inject({ method: "POST", url: "/api/site/subscribe", payload: { email: address() } });
  assert.equal(out.statusCode, 202);
  const [row] = await sql<{ id: number; confirm_token: string }[]>`SELECT id, confirm_token FROM subscribers ORDER BY id DESC LIMIT 1`;
  await sql`UPDATE subscribers SET confirm_expires_at = ${new Date(Date.now() - 1000)} WHERE id = ${row!.id}`;
  const res = await inject({ method: "GET", url: `/api/site/subscribe/confirm?token=${row!.confirm_token}` });
  assert.equal(res.headers.location, "/subscribe/confirmed?state=expired");
});

test("state and preferences both need a real token", async () => {
  const missing = await inject({ method: "GET", url: "/api/site/subscribe/state?token=" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().detail, "链接无效或已失效。");
  const noPrefs = await inject({ method: "POST", url: "/api/site/subscribe/preferences", payload: { token: "nope", bands: [] } });
  assert.equal(noPrefs.statusCode, 404);
  const noUnsub = await inject({ method: "POST", url: "/api/site/subscribe/preferences", payload: { token: "nope", unsubscribe: true } });
  assert.equal(noUnsub.statusCode, 404);

  const email = address();
  assert.equal((await inject({ method: "POST", url: "/api/site/subscribe", payload: { email, bands: ["mygo"] } })).statusCode, 202);
  const [row] = await sql<{ token: string; confirm_token: string }[]>`SELECT token, confirm_token FROM subscribers WHERE email_key = ${email}`;
  await inject({ method: "GET", url: `/api/site/subscribe/confirm?token=${row!.confirm_token}` });

  const saved = await inject({
    method: "POST",
    url: "/api/site/subscribe/preferences",
    payload: { token: row!.token, bands: ["roselia", "nope"], wantsDeadlines: false, wantsDigest: true },
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json(), { ok: true, status: "saved" });
  const after = await inject({ method: "GET", url: `/api/site/subscribe/state?token=${row!.token}` });
  assert.deepEqual(after.json(), { email, bands: ["roselia"], wantsDeadlines: false, wantsDigest: true, confirmed: true });
});

test("one-click unsubscribe works from a POST and always answers 200; a GET does nothing", async () => {
  const email = address();
  assert.equal((await inject({ method: "POST", url: "/api/site/subscribe", payload: { email } })).statusCode, 202);
  const [row] = await sql<{ id: number; token: string; confirm_token: string }[]>`SELECT id, token, confirm_token FROM subscribers WHERE email_key = ${email}`;
  await inject({ method: "GET", url: `/api/site/subscribe/confirm?token=${row!.confirm_token}` });

  // A link scanner following the URL in an email must not be able to unsubscribe anyone.
  const scanned = await inject({ method: "GET", url: `/api/site/subscribe/one-click?token=${row!.token}` });
  assert.equal(scanned.statusCode, 404);
  assert.equal((await status(row!.id)), "confirmed");

  const clicked = await inject({ method: "POST", url: `/api/site/subscribe/one-click?token=${row!.token}` });
  assert.equal(clicked.statusCode, 200);
  assert.match(String(clicked.headers["content-type"]), /^text\/plain/);
  assert.equal(clicked.body, "已退订。");
  assert.equal((await status(row!.id)), "unsubscribed");

  // A stale or bogus token still answers 200: the mail client must not show an error dialog.
  const bogus = await inject({ method: "POST", url: "/api/site/subscribe/one-click?token=nope" });
  assert.equal(bogus.statusCode, 200);
  assert.equal(bogus.body, "已退订。");
});

async function status(id: number): Promise<string> {
  const [row] = await sql<{ status: string }[]>`SELECT status FROM subscribers WHERE id = ${id}`;
  return row!.status;
}
