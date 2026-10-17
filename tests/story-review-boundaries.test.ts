import { stub, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql, closeDb } from '@girlsbands/backend/db';
import { upsertMaterial } from '@girlsbands/backend/content/materials';
import { publishArticle } from '@girlsbands/backend/publication/publish';
import { groupArticle } from '@girlsbands/backend/events/group';
import { consolidate } from '@girlsbands/backend/events/consolidate';
import { stopBoss } from '@girlsbands/backend/jobs/queue';

const T = tag();
const pairs: string[] = [];
const provider = await stub((_n, request) => {
  const text = JSON.parse(request.body).messages[1].content as string;
  if (text.includes('【报道 A】')) {
    pairs.push(text);
    return { choices: [{ message: { content: JSON.stringify({ a: '公告', b: '公告', relation: 'SAME_OCCURRENCE', difference: '', confidence: 1 }) } }] };
  }
  const ids = [...text.matchAll(/【候选 (C\d+)】/g)].map(m => m[1]);
  return { choices: [{ message: { content: JSON.stringify({ query: '公演', decisions: ids.map(id => ({ id, relation: 'SAME_OCCURRENCE', confidence: 1, note: '' })), selection: { addsValue: true, reason: 'fixture' } }) } }] };
});
for (const service of ['DEEPSEEK', 'XIAOMI_MIMO']) {
  process.env[`${service}_BASE_URL`] = `${provider.url}/v1`;
  process.env[`${service}_API_KEY`] = 'test-key';
}
// No embedding key: the real lexical recall path is sufficient for these identical titles.
delete process.env.DASHSCOPE_API_KEY;
delete process.env.EMBEDDING_API_KEY;
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

async function report(label: string, body: string, root: boolean) {
  const source = `review-${T}-${label}`;
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,next_fetch_at) VALUES(${source},${source},'rss','T1','editorial','2100-01-01')`;
  const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.org/${source}`, title: `MyGO 公演与票务 ${T}`, bodyText: body, bodyStatus: 'ok', via: 'fetch', publishedAt: new Date() });
  await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,subjects,score,selected,output)
    VALUES(${articleId},1,'rule','pass','live',${`MyGO 公演与票务 ${T}`},'公演与票务公告',${['mygo']},80,true,${sql.json({ scope: 'single', fact: { title: '公演与票务', subject: 'MyGO!!!!!', action: '公布', object: 'Live', deadlines: [{ kind: 'event', at: '2026-11-14', quote: '11月14日' }] } })})`;
  await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${articleId}`;
  let storyId: number | null = null;
  if (root) {
    const [story] = await sql`INSERT INTO stories(public_id,title) VALUES(${randomUUID()},'公演与票务') RETURNING id`;
    storyId = Number(story!.id);
    const [fact] = await sql`INSERT INTO facts(public_id,story_id,title) VALUES(${randomUUID()},${storyId},'公演与票务') RETURNING id`;
    await sql`INSERT INTO fact_articles(fact_id,article_id,role) VALUES(${fact!.id},${articleId},'primary')`;
    await sql`UPDATE articles SET grouped_at=now(),grouping_status='complete',selection_adds_value=true WHERE id=${articleId}`;
  }
  await publishArticle(articleId);
  return { articleId, storyId };
}

test('historical identity matching must not merge existing stories or rewrite live/ticket projections', async () => {
  const a = await report('old-root-a', '11月14日公演 原文A', true);
  const b = await report('old-root-b', '11月14日公演 原文B', true);
  const incoming = await report('history', '11月14日公演的旧报道', false);
  await sql`UPDATE articles SET backfill=true,published_at=now()-interval '7 days' WHERE id=${incoming.articleId}`;
  const before = (await sql`SELECT count(*) n FROM live_events`)[0]!.n;
  const result = await groupArticle(incoming.articleId);
  assert.ok(result.factId, 'history still receives its own identity');
  const stories = await sql`SELECT merged_into FROM stories WHERE id IN (${a.storyId},${b.storyId})`;
  assert.ok(stories.every(s => s.merged_into === null), 'history must not fuse established story identities');
  assert.equal((await sql`SELECT count(*) n FROM live_events`)[0]!.n, before);
  assert.equal((await sql`SELECT 1 FROM story_signals WHERE article_id=${incoming.articleId}`).length, 0);
});

test('both story consolidation judges receive the original evidence of both roots', async () => {
  const a = await report('evidence-a', '明日开始受理，原文A凭据', true);
  const b = await report('evidence-b', '销售截止而非开始，原文B凭据', true);
  const start = pairs.length;
  await consolidate([a.storyId!, b.storyId!]);
  const calls = pairs.slice(start);
  assert.equal(calls.length, 2);
  for (const text of calls) {
    assert.ok(text.includes('明日开始受理，原文A凭据'));
    assert.ok(text.includes('销售截止而非开始，原文B凭据'));
  }
});
