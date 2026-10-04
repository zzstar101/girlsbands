// Milestone failures to guard before implementing the new deterministic rules:
// - a useful interview, roundup or archive notice is presented as a historical milestone;
// - a stronger later report moves an event's date, or an explicit occurrence loses to collection time;
// - cached titles survive a score/category/subject correction, while the selected list should stay readable.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { beijingDate } from "@aihot/contracts/time";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadTopicPage } from "@aihot/backend/publication/topics";
import { overrideFields } from "@aihot/backend/admin/content";

const T = tag();
const BAND = "ave-mujica";
const NAMES: Record<string, string> = { roselia: "Roselia", "bang-dream": "BanG Dream!", mygo: "MyGO!!!!!" };
const SOURCE = `test-topic-rules-${T}`;
const now = new Date();
const at = new Date(now.getTime() - 6 * 3600_000);
let serial = 0;
let cached: string;
let cachedFact: number;
before(async () => {
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,owner_entity_id,next_fetch_at)
    VALUES (${SOURCE},'Official','rss','T1','editorial',${BAND},'2100-01-01')`;
  cachedFact = await fact(null, BAND);
  cached = await report({ company: BAND, title: "トゲナシトゲアリ 新 Live 公布", category: "live", factId: cachedFact, score: 90 });
  await loadTopicPage(BAND, 1); // Warm once; all corrections below happen before expiry.
});
after(async () => { await stopBoss(); await closeDb(); });

async function fact(storyId: number | null, subject: string, occurred: Date | null = null, action = "公布"): Promise<number> {
  const [f] = await sql<{id: number}[]>`INSERT INTO facts (public_id,story_id,title,subject,action,object,occurred_at)
    VALUES (${`f-${randomUUID()}`},${storyId},'新 Live 公布',${subject},${action},'Live',${occurred}) RETURNING id`;
  return f!.id;
}
async function story() {
  const id = randomUUID();
  const [s] = await sql<{id: number}[]>`INSERT INTO stories (public_id,title,first_report_at,latest_at) VALUES (${id},'新 Live',${at},${at}) RETURNING id`;
  return { id: s!.id, publicId: id };
}
async function report(o: {company?: string; title: string; category?: string; tags?: string[]; score?: number; factId?: number; published?: Date; timeline?: Date}) {
  const published = o.published ?? at;
  const timeline = o.timeline ?? published;
  const {articleId} = await upsertMaterial({sourceId: SOURCE,url:`https://example.com/topic-rules-${T}-${++serial}`,title:o.title,
    publishedAt:published,bodyText:'Supported report',bodyHtml:'<p>Supported report</p>',bodyStatus:'ok',via:'fetch'});
  await sql`UPDATE articles SET discovered_at=${timeline},timeline_at=${timeline},grouped_at=now() WHERE id=${articleId}`;
  await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected,subjects,tags)
    VALUES (${articleId},1,'rule','pass',${o.category ?? 'live'},${o.title},'新的消息',${o.score ?? 90},true,
    ${o.company ? [o.company] : []},${o.tags ?? ['新 Live']})`;
  if (o.factId) await sql`INSERT INTO fact_articles (fact_id,article_id,role) VALUES (${o.factId},${articleId},'report')`;
  await publishArticle(articleId,{releasedAt:new Date(timeline.getTime()+60000)});
  return articleId;
}
const page = async (slug: string) => {const p=await loadTopicPage(slug,1,new Date()); assert.ok(p); return p;};

test("topics whose content is not a milestone keep selected reading without manufacturing milestones or SEO highlights", async () => {
  for (const [slug, tag] of [['media-interviews','媒体访谈'],['goods','周边商品'],['archive','Archive 回放']] as const) {
    const id=await report({title:`高分内容 ${slug} ${T}`,category:'other',tags:[tag],score:99});
    const p=await page(slug);
    assert.deepEqual(p.chronicle,[],slug);
    assert.deepEqual(p.highlights,[],`${slug}: search snippets use the same milestone rules`);
    assert.ok(p.items.some(r=>r.id===id));
  }
});

// A Live can include a viewing guide or a chart result; those suffixes do not change its main action.
test("launches keep their milestones when the headline also mentions supporting guides or chart results", async () => {
  const launch = await report({company:'togenashi-togeari',title:'トゲナシトゲアリ 8th ONE-MAN LIVE 開催決定，附新人观演指南',category:'live',score:87});
  const release = await report({company:'mygo',title:'MyGO!!!!! 新作 Single 发售，Billboard Japan 榜单登顶',category:'release',score:79});
  const merch = await report({company:'mygo',title:'MyGO!!!!! 新周边开售（附选购指南）',category:'merch',tags:['周边商品'],score:76});
  const guide = await report({company:'togenashi-togeari',title:'トゲナシトゲアリ 现场观演指南：如何选择站位',category:'media',tags:['媒体访谈'],score:99});
  const view = await fact(null,'togenashi-togeari',null,'opinion');
  const opinion = await report({company:'togenashi-togeari',title:'トゲナシトゲアリ 成员谈未来的 Live 形式',category:'media',tags:['媒体访谈'],factId:view,score:99});
  const togenashi=await page('togenashi-togeari');
  assert.deepEqual(togenashi.milestones.map(m=>m.href),[`/items/${launch}`]);
  assert.ok(togenashi.items.some(r=>r.id===guide)&&togenashi.items.some(r=>r.id===opinion));
  const mygo=await page('mygo');
  assert.deepEqual(new Set(mygo.milestones.map(m=>m.href)),new Set([release,merch].map(id=>`/items/${id}`)));
});

test("event dates use an explicit occurrence, otherwise the earliest publication, and do not move with the stronger report", async () => {
  const month=beijingDate(now).slice(0,7);
  const boundary=new Date(`${month}-01T00:00:00+08:00`);
  const earlier=new Date(boundary.getTime()-40*86400000);
  const later=new Date(boundary.getTime()-2*86400000);
  const occurred=new Date(earlier.getTime()-86400000);
  for(const [band,useOccurrence,sameFact] of [['roselia',true,false],['bang-dream',false,false],['mygo',false,true]] as const) {
    const event=await story();
    const original=await fact(event.id,band,useOccurrence?occurred:null);
    const follow=sameFact ? original : await fact(event.id,band);
    const old=await report({company:band,title:`${NAMES[band]} 新 Live 公布 ${T}`,category:'live',published:earlier,timeline:new Date(earlier.getTime()+3600000),factId:original,score:69});
    const stronger=await report({company:band,title:`${NAMES[band]} 新 Live 正式公告 ${T}`,category:'live',published:later,factId:follow,score:95});
    const p=await page(band);
    const entries=p.milestones.filter(m=>m.href===`/story/${event.publicId}`);
    assert.equal(entries.length,1);
    assert.equal(entries[0]!.date,beijingDate(useOccurrence?occurred:earlier));
    assert.ok(p.items.some(r=>r.id===stronger));
    if (sameFact) assert.ok(!p.items.some(r=>r.id===old),'the old fact representative no longer holds a selected seat');
    else assert.ok(p.items.some(r=>r.id===old));
  }
});

test("cached milestone eligibility follows current score, category and fact subject corrections", async () => {
  assert.ok((await loadTopicPage(BAND,1))?.milestones.length);
  await sql`UPDATE analyses SET score=1 WHERE article_id=${cached}`;
  await publishArticle(cached,{releasedAt:at});
  assert.deepEqual((await loadTopicPage(BAND,1))?.milestones,[],'score changes apply without waiting for cached counts');
  await sql`UPDATE analyses SET score=90 WHERE article_id=${cached}`;
  await overrideFields(cached,{fields:{category:'media',tags:['媒体访谈',`entity:${BAND}`]},version:0,reason:'实际是访谈'},'topic-rules');
  assert.deepEqual((await loadTopicPage(BAND,1))?.milestones,[],'the current category is checked');
  await overrideFields(cached,{fields:{category:'live',tags:['新 Live',`entity:${BAND}`]},version:1,reason:'恢复已核实 Live'},'topic-rules');
  await sql`UPDATE facts SET subject='MyGO!!!!!' WHERE id=${cachedFact}`;
  assert.deepEqual((await loadTopicPage(BAND,1))?.milestones,[],'a known different action subject cannot remain an Ave Mujica milestone');
  assert.ok((await loadTopicPage(BAND,1))?.items.some(r=>r.id===cached),'chronicle rules do not remove the selected report');
});
