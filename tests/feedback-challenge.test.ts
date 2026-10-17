import { Reply, stub } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { buildApp } from '../apps/api/src/app.ts';
import { closeDb, sql } from '@girlsbands/backend/db';
import { config } from '@girlsbands/backend/config';

process.env.FEISHU_INTERNAL_ENABLED = 'false';
process.env.TURNSTILE_SITE_KEY = 'local-site-key';
process.env.TURNSTILE_SECRET_KEY = 'local-secret';
let verdict: unknown = { success: true, hostname: new URL(config.siteUrl).hostname, action: 'feedback' };
const requests: Record<string, unknown>[] = [];
const verifier = await stub((_n, req) => { requests.push(JSON.parse(req.body)); return verdict; });
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  assert.equal(String(input), 'https://challenges.cloudflare.com/turnstile/v0/siteverify', 'no external network in test');
  return originalFetch(verifier.url, init);
}, { preconnect: originalFetch.preconnect });
const app = await buildApp();
after(async () => { globalThis.fetch = originalFetch; await app.close(); await verifier.close(); await closeDb(); });
let n = 0;
async function submit(token?: string, address?: string, headers: Record<string, string> = {}) {
  const form = new FormData(); form.set('content', '这是本地防机器人测试');
  if (token !== undefined) form.set('cf-turnstile-response', token);
  const request = new Request('http://local', { method: 'POST', body: form });
  const contentType = request.headers.get('content-type')!;
  return app.inject({ method: 'POST', url: '/api/site/feedback', remoteAddress: address ?? `203.0.113.${++n}`, headers: { 'content-type': contentType, ...headers }, payload: Buffer.from(await request.arrayBuffer()) });
}

test('missing token cannot store feedback or call verification', async () => {
  const before = await sql`SELECT count(*) n FROM feedback`;
  assert.equal((await submit()).statusCode, 400);
  assert.equal(requests.length, 0);
  assert.equal((await sql`SELECT count(*) n FROM feedback`)[0]!.n, before[0]!.n);
});
test('verified anonymous feedback succeeds with hostname and action binding', async () => {
  assert.equal((await submit('valid-token')).statusCode, 201);
  assert.equal(requests.at(-1)?.secret, 'local-secret');
  assert.equal(requests.at(-1)?.response, 'valid-token');
});
test('forged, replayed, wrong-host and wrong-action tokens are rejected before storage', async () => {
  for (const result of [{ success: false, 'error-codes': ['timeout-or-duplicate'] }, { success: true, hostname: 'other.example', action: 'feedback' }, { success: true, hostname: new URL(config.siteUrl).hostname, action: 'login' }]) {
    verdict = result;
    const before = (await sql`SELECT count(*) n FROM feedback`)[0]!.n;
    assert.equal((await submit('bad-token')).statusCode, 400);
    assert.equal((await sql`SELECT count(*) n FROM feedback`)[0]!.n, before);
  }
});
test('provider outage fails closed; oversized tokens never reach the provider', async () => {
  verdict = new Reply(503, { error: 'outage' });
  const before = (await sql`SELECT count(*) n FROM feedback`)[0]!.n;
  assert.equal((await submit('token')).statusCode, 503);
  const requestsBefore = requests.length;
  assert.equal((await submit('x'.repeat(2049))).statusCode, 400);
  assert.equal(requests.length, requestsBefore);
  assert.equal((await sql`SELECT count(*) n FROM feedback`)[0]!.n, before);
});
test('rotating user-agent and x-real-ip cannot bypass per-connection verification limits', async () => {
  verdict = { success: false };
  const start = requests.length;
  for (const [i, agent] of ['Chrome', 'Safari', 'Firefox', 'Edg', 'Mobile'].entries()) {
    assert.equal((await submit('bad-token', '203.0.113.200', { 'x-real-ip': `198.51.100.${i}`, 'user-agent': agent })).statusCode, 400);
  }
  assert.equal((await submit('bad-token', '203.0.113.200', { 'x-real-ip': '198.51.100.99', 'user-agent': 'Android' })).statusCode, 429);
  assert.equal(requests.length - start, 5);
});
test('missing configuration fails closed and never leaks the secret', async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  assert.equal((await submit('token')).statusCode, 503);
  const result = await app.inject({ method: 'GET', url: '/api/site/feedback/config' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().siteKey, null);
  assert.ok(!result.body.includes('local-secret'));
});
