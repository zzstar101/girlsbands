import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildContentReview, parseReviewRows, renderContentReviewMarkdown, type ReviewRow } from '@girlsbands/backend/operations/content-review';

const row = (id: string, patch: Partial<ReviewRow> = {}): ReviewRow => ({ id, title: 'MyGO 神户公演付款 10 月 13 日 21:00 截止', summary: '同一轮付款截止提醒', category: 'ticket', selected: true, eligible: true, factId: 1, scope: 'single', member: false, retweet: false, quotedUrl: null, originalUrl: `https://x.com/official/status/${id}`, sourceName: '官方', body: '', revision: 1, ...patch });

test('preview flags distinct facts but does not mark already folded reports as duplicates', () => {
  const result = buildContentReview([row('a'), row('b'), row('c', { factId: 2 })]);
  assert.ok(result.duplicateCandidates.some(p => p.a === 'a' && p.b === 'c'));
  assert.ok(!result.duplicateCandidates.some(p => p.a === 'a' && p.b === 'b'));
  assert.ok(result.duplicateCandidates.every(p => p.status === 'needs-review'));
});
test('duplicate card candidates require both reports to be selected', () => {
  const result = buildContentReview([row('a'), row('b', { factId: 2, selected: false })]);
  assert.deepEqual(result.duplicateCandidates, []);
});
test('shared quoted announcement is evidence to review, not permission to merge different developments', () => {
  const result = buildContentReview([row('a', { quotedUrl: 'https://x.com/a/status/99' }), row('b', { factId: 2, title: '宣布追加席', quotedUrl: 'https://x.com/a/status/99' })]);
  assert.equal(result.duplicateCandidates[0]?.reason, 'shared-quote');
  assert.equal(result.duplicateCandidates[0]?.status, 'needs-review');
});
test('preview separates retained daily posts, removed work posts, and pure reposts without modifying input', () => {
  const rows = [row('daily', { member: true, category: 'daily', selected: false, eligible: false }), row('work', { member: true }), row('rt', { member: true, retweet: true }), row('official')];
  const before = JSON.stringify(rows);
  const result = buildContentReview(rows);
  assert.deepEqual(result.dailyLane.keep, ['daily']);
  assert.deepEqual(result.dailyLane.removeWork, ['work']);
  assert.deepEqual(result.dailyLane.removeReposts, ['rt']);
  assert.equal(JSON.stringify(rows), before);
});
test('a real composite with no primary fact can still be reviewed against the quoted announcement', () => {
  const quote = 'https://x.com/official/status/99';
  const result = buildContentReview([row('a', { scope: 'composite', factId: null, quotedUrl: quote }), row('b', { scope: 'single', quotedUrl: quote })]);
  assert.equal(result.duplicateCandidates[0]?.reason, 'shared-quote');
  assert.equal(result.duplicateCandidates[0]?.status, 'needs-review');
});
test('a daily post carrying pool flags is kept and only asks for a human check', () => {
  const result = buildContentReview([row('d', { member: true, category: 'daily', selected: true, eligible: true })]);
  assert.deepEqual(result.dailyLane.keep, ['d']);
  assert.equal(result.dailyLane.review[0]?.id, 'd');
  assert.ok(!result.dailyLane.removeWork.includes('d'));
});
test('markdown preview escapes HTML and refuses non-HTTP source links', () => {
  const rows = [
    row('a', { member: true, category: 'ticket', selected: true, eligible: true, title: '<img src=x onerror=alert(1)>', summary: '[点我](javascript:alert(1))', originalUrl: 'javascript:alert(1)' }),
    row('b', { member: true, category: 'ticket', selected: true, eligible: true, title: '<img src=x onerror=alert(1)>', summary: '', factId: 2 }),
  ];
  const result = buildContentReview(rows);
  const markdown = renderContentReviewMarkdown(result, rows, { generatedAt: new Date('2026-10-18T00:00:00Z'), input: '/tmp/rows.jsonl' });
  assert.ok(!markdown.includes('<img'));
  assert.ok(markdown.includes('&lt;img'));
  assert.ok(markdown.includes('\\[点我\\](javascript:alert(1))'));
  assert.ok(!/(?<!\\)\]\(javascript:/.test(markdown));
  assert.ok(markdown.includes('不是 HTTP(S) 链接，未渲染'));
  assert.ok(markdown.includes('https://x.com/official/status/b'));
});
test('jsonl parser accepts one row per line or an array and reports the failing line', () => {
  const text = `${JSON.stringify(row('a'))}\n\n${JSON.stringify(row('b'))}\n`;
  assert.deepEqual(parseReviewRows(text).map((item) => item.id), ['a', 'b']);
  assert.deepEqual(parseReviewRows(JSON.stringify([row('c')])).map((item) => item.id), ['c']);
  assert.throws(() => parseReviewRows('{"id":"broken"}'), /第 1 行/);
  assert.throws(() => parseReviewRows(`${JSON.stringify(row('d'))} trailing`), /第 1 行/);
});
test('export SQL is read-only, bounded and shaped like ReviewRow', () => {
  const text = readFileSync(new URL('../scripts/export-content-review.sql', import.meta.url), 'utf8');
  assert.match(text, /BEGIN\s+TRANSACTION\s+READ\s+ONLY/i);
  assert.match(text, /SET\s+LOCAL\s+statement_timeout\s*=/i);
  assert.match(text, /LIMIT\s+2500/i);
  assert.match(text, /p\.eligible OR \(p\.category = 'daily'/, 'unlisted member rows never appeared in the old daily lane');
  assert.match(text, /AND\s+\(NOT p\.selected OR p\.visible_after <= now\(\)\)/i, 'release gate must cover member rows too, not only selected branch');
  assert.match(text, /left\s*\(\s*coalesce\s*\(\s*a\.body_text\s*,\s*''\s*\)\s*,\s*6000\s*\)/i);
  for (const key of ['"id"', '"title"', '"summary"', '"category"', '"selected"', '"eligible"', '"factId"', '"factPublicId"', '"factVersion"', '"scope"', '"member"', '"retweet"', '"quotedUrl"', '"originalUrl"', '"sourceName"', '"body"', '"revision"', '"timelineAt"']) {
    assert.ok(text.includes(key), `missing ${key}`);
  }
});
