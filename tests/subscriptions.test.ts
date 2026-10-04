// 邮件订阅：一个邮箱一行、确认信点一下才生效、同一封信只发一次。
//
// 这一套的重点不在「能不能发出去」，而在几条不能被绕过的规矩：
//   1. 公开接口永远不透露某个地址是否已经订阅；
//   2. 确认令牌用完即换，同一封邮件里的链接点第二次无效；
//   3. 安全阀关着的时候连 SMTP 都不碰，也不留下已认领的发送记录（否则阀门打开后那封信再也发不出去）；
//   4. 没有 48 小时内到期的节点、或者没有这个人关心的内容，就不发信。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@girlsbands/backend/config";
import { closeDb, sql } from "@girlsbands/backend/db";
import { cleanBands, confirm, normalizeEmail, recipients, subscribe, subscriberCounts, unsubscribe, updatePreferences } from "@girlsbands/backend/subscriptions/store";
import { deliverEmail, mailer, markStaleEmailSends } from "@girlsbands/backend/subscriptions/send";
import { bandCountLine, bandsSentence, confirmData, deadlineData, digestData, matches } from "@girlsbands/backend/subscriptions/content";
import { BAND_IDS, ENTITIES, PROJECT_IDS, isBand, isProject } from "@girlsbands/industry/taxonomy";
import { decodeHero } from "@girlsbands/industry/email/hero";
import { sendDeadlineReminders, sendDigest } from "@girlsbands/backend/subscriptions/notify";
import { emailStyle } from "@girlsbands/industry/email/registry";

const T = `sub-${tag()}`;
const NOW = new Date();

// The send path is exercised through nodemailer's json transport: a real render, no network, no
// test-only seam (the repo has none, and globalThis.fetch cannot intercept SMTP).
const saved = { enabled: config.emailEnabled, dryRun: config.emailDryRun, style: config.emailStyle };
before(() => {
  process.env.EMAIL_FROM = "少女乐队's <radar@example.org>";
  process.env.EMAIL_REPLY_TO = "reply@example.org";
  config.emailEnabled = true;
  config.emailDryRun = true;
  config.emailStyle = "cover";
});
after(async () => {
  config.emailEnabled = saved.enabled;
  config.emailDryRun = saved.dryRun;
  config.emailStyle = saved.style;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_REPLY_TO;
  await closeDb();
});

let n = 0;
const email = () => `${T}-${(n += 1)}@example.org`;

/** A dated report that a reader can see, so the radar has something to hand a reminder about. */
async function report(opts: { at: string; title?: string; tags?: string[]; selected?: boolean; timelineAt?: Date }) {
  n += 1;
  const id = `${T}-a${n}`;
  const sourceId = `${T}-s${n}`;
  const at = opts.timelineAt ?? new Date(NOW.getTime() - 3600_000);
  const title = opts.title ?? id;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, created_at, next_fetch_at)
            VALUES (${sourceId}, ${`媒体 ${n}`}, 'rss', 'T1', 'editorial', ${at}, '2100-01-01')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
            VALUES (${id}, ${sourceId}, ${id}, ${`https://example.org/${id}`}, ${title}, ${at}, ${at})`;
  const [analysis] = await sql`INSERT INTO analyses (article_id, input_revision, origin, output)
    VALUES (${id}, 1, 'model', ${sql.json({
      scope: "single",
      fact: { deadlines: [{ kind: "lottery_end", at: opts.at, note: "FC先行", quote: "受付は明日まで" }] },
    } as never)}) RETURNING id`;
  await sql`INSERT INTO publications (article_id, analysis_id, revision, visibility, eligible, selected, title, source_id, channel, first_party, url, published_at, visible_after, discovered_at, timeline_at, body_mode, sort_at, tags)
    VALUES (${id}, ${analysis!.id}, 1, 'public', true, ${opts.selected ?? false}, ${title}, ${sourceId}, 'news', false, ${`https://example.org/${id}`}, ${at}, ${at}, ${at}, ${at}, 'summary', ${at}, ${opts.tags ?? []})`;
  return id;
}

/** A JST calendar day this many days ahead of now, as the deadline step would have written it. */
function jstDayAhead(days: number): string {
  return new Date(NOW.getTime() + (9 * 3600_000) + days * 24 * 3600_000).toISOString().slice(0, 10);
}

test("an address is normalised, and only things that look like addresses get in", () => {
  assert.equal(normalizeEmail("  Reader@Example.ORG "), "reader@example.org");
  assert.equal(normalizeEmail("no-at-sign"), null);
  assert.equal(normalizeEmail("a@b"), null);
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail(`${"x".repeat(250)}@example.org`), null);
});

test("only bands this site knows are stored, deduplicated and capped", () => {
  assert.deepEqual(cleanBands(["mygo", "mygo", "not-a-band", "togenashi-togeari"]), ["mygo", "togenashi-togeari"]);
  assert.deepEqual(cleanBands([]), []);
  assert.equal(cleanBands(Array.from({ length: 60 }, (_v, i) => `x${i}`)).length, 0);
});

test("subscribing twice before confirming rotates the token: only the newest link works", async () => {
  const address = email();
  const first = await subscribe({ email: address, bands: ["mygo"], wantsDeadlines: true, wantsDigest: true });
  assert.ok(first);
  assert.equal(first.alreadyConfirmed, false);
  assert.equal(first.needsConfirm, true);
  assert.equal(first.subscriber.status, "pending");
  const stale = first.subscriber.confirmToken;

  const second = await subscribe({ email: address, bands: ["kessoku-band"], wantsDeadlines: false, wantsDigest: true });
  assert.ok(second);
  assert.equal(second.needsConfirm, true);
  assert.equal(second.subscriber.id, first.subscriber.id, "the same address stays one row");
  assert.notEqual(second.subscriber.confirmToken, stale);
  assert.deepEqual(second.subscriber.bands, ["kessoku-band"]);

  assert.deepEqual(await confirm(stale), { ok: false, reason: "invalid" });
  const done = await confirm(second.subscriber.confirmToken);
  assert.equal(done.ok, true);
  assert.equal(done.ok && done.subscriber.status, "confirmed");
  assert.equal(done.ok && done.subscriber.confirmedAt !== null, true);
});

test("a confirmed link cannot be used twice", async () => {
  const address = email();
  const out = await subscribe({ email: address, bands: [], wantsDeadlines: true, wantsDigest: true });
  const token = out!.subscriber.confirmToken;
  assert.equal((await confirm(token)).ok, true);
  assert.deepEqual(await confirm(token), { ok: false, reason: "invalid" });
});

test("an expired confirmation is refused, not silently accepted", async () => {
  const address = email();
  const out = await subscribe({ email: address, bands: [], wantsDeadlines: true, wantsDigest: true });
  await sql`UPDATE subscribers SET confirm_expires_at = ${new Date(Date.now() - 60_000)} WHERE id = ${out!.subscriber.id}`;
  assert.deepEqual(await confirm(out!.subscriber.confirmToken), { ok: false, reason: "expired" });
  const [row] = await sql<{ status: string }[]>`SELECT status FROM subscribers WHERE id = ${out!.subscriber.id}`;
  assert.equal(row!.status, "pending");
});

test("an unauthenticated resubmit cannot change a confirmed reader's settings", async () => {
  const address = email();
  const out = await subscribe({ email: address, bands: ["mygo"], wantsDeadlines: true, wantsDigest: true });
  await confirm(out!.subscriber.confirmToken);
  const again = await subscribe({ email: address.toUpperCase(), bands: ["roselia"], wantsDeadlines: false, wantsDigest: false });
  assert.ok(again);
  assert.equal(again.alreadyConfirmed, true);
  assert.equal(again.needsConfirm, false, "no new confirmation mail is sent");
  assert.deepEqual(again.subscriber.bands, ["mygo"]);
  assert.equal(again.subscriber.wantsDeadlines, true);
});

test("changing preferences needs the token, and re-subscribes a reader who had left", async () => {
  const address = email();
  const out = await subscribe({ email: address, bands: ["mygo"], wantsDeadlines: true, wantsDigest: true });
  const token = out!.subscriber.token;
  assert.equal(await updatePreferences("not-a-token", { bands: [], wantsDeadlines: true, wantsDigest: true }), null);

  assert.equal(await unsubscribe(token), true);
  assert.equal(await unsubscribe(token), false, "already gone");
  let counts = await subscriberCounts();
  assert.ok(counts.unsubscribed >= 1);

  const back = await updatePreferences(token, { bands: ["roselia"], wantsDeadlines: false, wantsDigest: true });
  assert.ok(back);
  assert.equal(back.status, "confirmed");
  assert.equal(back.unsubscribedAt, null);
  assert.deepEqual(back.bands, ["roselia"]);
  assert.equal(back.wantsDeadlines, false);
  counts = await subscriberCounts();
  assert.equal(counts.pending >= 0, true);
});

test("the send list honours the per-kind toggle, and a leave takes the reader off it", async () => {
  const address = email();
  const out = await subscribe({ email: address, bands: [], wantsDeadlines: true, wantsDigest: false });
  await confirm(out!.subscriber.confirmToken);
  assert.equal((await recipients("deadline")).some((r) => r.email === address), true);
  assert.equal((await recipients("digest")).some((r) => r.email === address), false);

  await unsubscribe(out!.subscriber.token);
  assert.equal((await recipients("deadline")).some((r) => r.email === address), false);
});

test("a missing SMTP setting is reported, never guessed at", async () => {
  config.emailEnabled = false;
  assert.deepEqual(mailer(), { ready: false, reason: "EMAIL_ENABLED is off" });
  config.emailEnabled = true;
  const from = process.env.EMAIL_FROM;
  delete process.env.EMAIL_FROM;
  assert.deepEqual(mailer(), { ready: false, reason: "EMAIL_FROM is not configured" });
  process.env.EMAIL_FROM = from;
  const ready = mailer();
  assert.equal(ready.ready, true);
});

test("one letter per recipient per dedupe key, and a dry run still writes the log", async () => {
  const out = await subscribe({ email: email(), bands: [], wantsDeadlines: true, wantsDigest: true });
  const id = out!.subscriber.id;
  const key = `test:${T}`;
  const mail = { to: out!.subscriber.email, subject: "测试", html: "<p>hi</p>", text: "hi" };

  const first = await deliverEmail(id, "digest", key, mail);
  assert.equal(first.status, "sent");
  const second = await deliverEmail(id, "digest", key, mail);
  assert.deepEqual(second, { status: "skipped", response: "already sent" });

  const [row] = await sql<{ status: string; attempts: number }[]>`
    SELECT status, attempts FROM email_sends WHERE subscriber_id = ${id} AND dedupe_key = ${key}`;
  assert.equal(row!.status, "sent");
  assert.equal(row!.attempts, 1);

  // A claimed-but-unfinished letter is reclaimed after 15 minutes instead of blocking forever.
  await sql`UPDATE email_sends SET status = 'sending', updated_at = ${new Date(Date.now() - 20 * 60_000)} WHERE subscriber_id = ${id} AND dedupe_key = ${key}`;
  assert.equal(await markStaleEmailSends(NOW), 1);
  const retried = await deliverEmail(id, "digest", key, mail);
  assert.equal(retried.status, "sent");
});

test("with the valve off nothing is rendered, sent, or claimed", async () => {
  const address = email();
  const out = await subscribe({ email: address, bands: [], wantsDeadlines: true, wantsDigest: true });
  await confirm(out!.subscriber.confirmToken);
  config.emailEnabled = false;
  try {
    const run = await sendDeadlineReminders(NOW);
    assert.deepEqual(run, { sent: 0, failed: 0, empty: 0, reason: "EMAIL_ENABLED is off" });
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM email_sends WHERE subscriber_id = ${out!.subscriber.id}`;
    assert.equal(row!.n, 0, "no burned dedupe key: the letter can still go out once the valve opens");
  } finally {
    config.emailEnabled = true;
  }
});

test("the reminder goes out for a deadline inside 48 hours, and names the reader's band", async () => {
  const address = email();
  const out = await subscribe({ email: address, bands: ["mygo"], wantsDeadlines: true, wantsDigest: false });
  await confirm(out!.subscriber.confirmToken);
  await report({ at: jstDayAhead(1), title: "MyGO!!!!! 抽选截止", tags: ["先行/抽选", "entity:mygo"] });

  const data = await deadlineData({ id: out!.subscriber.id, email: address, token: out!.subscriber.token, bands: ["mygo"] }, NOW);
  assert.ok(data);
  assert.equal(data.kind, "deadline");
  assert.equal(data.days.length > 0, true);
  assert.equal(data.days[0]!.items[0]!.band, "MyGO!!!!!");
  assert.equal(data.days[0]!.items[0]!.soon, true);
  assert.equal(data.days[0]!.items[0]!.url.includes("/items/"), true);

  // 每封信都带一张通栏头图，主角就是这个订阅者关心的那支乐队（图本身由 /og/email/:file 现画）。
  assert.ok(data.hero);
  assert.equal(data.hero.width, 600);
  assert.equal(data.hero.height, 225);
  assert.equal(data.hero.src.includes("/og/email/"), true);
  assert.equal(data.hero.alt.includes("MyGO!!!!!"), true);
  assert.equal(data.hero.caption, "MyGO!!!!!");
  assert.match(data.hero.bg, /^#[0-9a-f]{6}$/);
  // 头图上还画着这封信的日子（巨号鬼影日号 + 右下角），alt 里也读得出来。
  assert.equal(data.hero.alt.includes("JST"), true);
  assert.equal(heroSpec(data.hero.src)?.date, jstDayAhead(1), "头图上的日期就是这条急件那天");
  assert.equal(heroSpec(data.hero.src)?.logo, "mygo", "头图该用这条急件自己那支乐队的官方 logo");

  const mail = emailStyle("cover").render(data);
  assert.equal(mail.subject.includes("少女乐队's"), true);
  assert.equal(mail.html.includes("MyGO!!!!!"), true);
  assert.equal(mail.html.includes(data.hero.src), true);
  assert.equal(mail.html.includes(`alt="${data.hero.alt}"`), true);
  assert.equal(mail.text.length > 0, true);
  assert.equal(mail.html.includes("<script"), false);

  const run = await sendDeadlineReminders(NOW);
  assert.equal(run.failed, 0);
  assert.equal(run.sent >= 1, true);
  const [sent] = await sql<{ status: string; subject: string }[]>`
    SELECT status, subject FROM email_sends WHERE subscriber_id = ${out!.subscriber.id} AND kind = 'deadline'`;
  assert.equal(sent!.status, "sent");
  assert.equal(sent!.subject.includes("少女乐队's"), true);

  // The same day's run is a no-op: nobody is written to twice.
  const again = await sendDeadlineReminders(NOW);
  assert.equal(again.sent, 0);
});

test("a reader who follows another band is not written to about this one", async () => {
  const other = { id: 0, email: "nobody@example.org", token: "x", bands: ["roselia"] };
  const data = await deadlineData(other, NOW);
  assert.equal(data, null);
  assert.equal(matches([], ["mygo"]), true, "an empty list means everything");
  assert.equal(matches(["roselia"], ["mygo"]), false);
});

test("a deadline outside the 48-hour window is not urgent enough to send", async () => {
  const far = { id: 0, email: "nobody@example.org", token: "x", bands: ["kessoku-band"] };
  await report({ at: jstDayAhead(9), title: "結束バンド 一般発売", tags: ["发售", "entity:kessoku-band"] });
  assert.equal(await deadlineData(far, NOW), null);
});

test("the digest only carries what the reader asked for, and nothing at all when there is none", async () => {
  const address = email();
  const out = await subscribe({ email: address, bands: ["mygo"], wantsDeadlines: false, wantsDigest: true });
  await confirm(out!.subscriber.confirmToken);
  await report({ at: jstDayAhead(20), title: "MyGO!!!!! 新单曲发售", tags: ["新作发售", "entity:mygo"], selected: true });

  const mine = await digestData({ id: out!.subscriber.id, email: address, token: out!.subscriber.token, bands: ["mygo"] }, NOW);
  assert.ok(mine);
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0]!.title, "MyGO!!!!! 新单曲发售");
  assert.deepEqual(mine.items[0]!.bands, ["MyGO!!!!!"]);
  assert.equal(mine.items[0]!.selected, true);
  // 看板右栏直接印这一串，所以它必须是契约里写的 `10/04 12:00`，不是 ISO 原文。
  assert.match(mine.items[0]!.time, /^\d\d\/\d\d \d\d:\d\d$/);
  assert.equal(mine.unsubscribeUrl.includes("/subscribe/manage"), true);
  // 头图的主角 = 本期出现最多的那支乐队。
  assert.equal(mine.hero?.caption, "MyGO!!!!!");
  assert.equal(mine.hero?.alt.includes("MyGO!!!!!"), true);
  assert.equal(heroSpec(mine!.hero!.src)?.logo, "mygo");

  const elsewhere = await digestData({ id: 0, email: address, token: "x", bands: ["roselia"] }, NOW);
  assert.equal(elsewhere, null, "no content for this reader means no mail, not an empty mail");

  const run = await sendDigest(NOW);
  assert.equal(run.failed, 0);
  assert.equal(run.sent >= 1, true);
  const [sent] = await sql<{ status: string }[]>`
    SELECT status FROM email_sends WHERE subscriber_id = ${out!.subscriber.id} AND kind = 'digest'`;
  assert.equal(sent!.status, "sent");
});

test("an old digest item falls out of the window", async () => {
  const address = email();
  const out = await subscribe({ email: address, bands: ["togenashi-togeari"], wantsDeadlines: false, wantsDigest: true });
  await confirm(out!.subscriber.confirmToken);
  await report({
    at: jstDayAhead(20),
    title: "トゲナシトゲアリ 昨日の情报",
    tags: ["新作发售", "entity:togenashi-togeari"],
    selected: true,
    timelineAt: new Date(NOW.getTime() - 30 * 3600_000),
  });
  assert.equal(await digestData({ id: out!.subscriber.id, email: address, token: out!.subscriber.token, bands: ["togenashi-togeari"] }, NOW), null);
});

/** 头图句柄上的地址就是那份 spec 的 token；解回来才能断言「这封信的头图是哪支乐队」。 */
function heroSpec(src: string) {
  const token = src.split("/og/email/")[1]?.replace(/\.png$/, "") ?? "";
  return decodeHero(token);
}

test("头图主角：确认信取订阅的第一支乐队，脏 id 与空名单一律退回海报", async () => {
  const input = { email: "fan@example.org", token: "t", confirmToken: "c", wantsDeadlines: true, wantsDigest: true };
  const one = await confirmData({ ...input, bands: ["togenashi-togeari", "mygo"] });
  assert.equal(heroSpec(one.hero!.src)?.logo, "togenashi-togeari", "头图该用订阅的第一支乐队的官方 logo");
  assert.equal(one.hero!.caption, "トゲナシトゲアリ");
  // 没勾任何乐队 = 站级邮件：logo 必须是 null，渲染那端会退回满版应援色海报。
  assert.equal(heroSpec((await confirmData({ ...input, bands: [] })).hero!.src)?.logo, null);
  // 不在 ENTITIES 里的 id（哪怕形状上是条路径）绝不进 token：头图那端拿它去查表，查不到就是海报。
  assert.equal(heroSpec((await confirmData({ ...input, bands: ["../../etc/passwd"] })).hero!.src)?.logo, null);
});

test("主体分类：乐队与企划的边界写在配置里，不是渲染时猜的", () => {
  assert.deepEqual([...PROJECT_IDS].sort(), ["bang-dream", "bocchi-the-rock", "girls-band-cry", "our-notes"], "企划是整个系列／作品／游戏，只有这四个");
  assert.equal(BAND_IDS.length, 16, "ENTITIES 里另外 16 条是乐队");
  assert.equal(BAND_IDS.length + PROJECT_IDS.length, Object.keys(ENTITIES).length, "每条都必须有 kind，不能有漏网的");
  assert.ok(isBand("mygo") && isProject("our-notes"), "isBand／isProject 认乐队和企划");
  assert.ok(!isBand("bang-dream") && !isProject("mygo"), "企划不是乐队，乐队也不是企划");
  assert.ok(!isBand("不存在的 id") && !isProject("不存在的 id"), "不认识的 id 两边都不是");
});

test("订阅里混着乐队和企划时，头图取乐队；只订企划才用企划的 logo", async () => {
  const input = { email: "fan@example.org", token: "t", confirmToken: "c", wantsDeadlines: true, wantsDigest: true };
  // 先勾企划再勾乐队：顺序不该决定头图——乐队永远优先，免得拿 BanG Dream! 的字标去讲 MyGO!!!!!。
  const mixed = await confirmData({ ...input, bands: ["bang-dream", "mygo"] });
  assert.equal(heroSpec(mixed.hero!.src)?.logo, "mygo", "头图该挂那支乐队的官方 logo，不是企划字标");
  assert.equal(mixed.hero!.caption, "MyGO!!!!!");
  const project = await confirmData({ ...input, bands: ["our-notes"] });
  assert.equal(heroSpec(project.hero!.src)?.logo, "our-notes", "只订企划时，企划自己的 logo 才是诚实的");
  assert.equal(project.hero!.caption, "Our Notes");
});

test("订阅措辞：乐队按支、企划按个，一个都没勾写「全部乐队与企划」", () => {
  assert.equal(bandCountLine([]), "全部乐队与企划");
  assert.equal(bandCountLine(["mygo"]), "1 支乐队");
  assert.equal(bandCountLine(["our-notes"]), "1 个企划");
  assert.equal(bandCountLine(["mygo", "togenashi-togeari", "our-notes", "bang-dream"]), "2 支乐队 + 2 个企划");
  assert.equal(bandCountLine(["../../etc/passwd"]), "全部乐队与企划", "不认识的 id 不算数");
  assert.equal(bandsSentence([]), "全部乐队与企划");
  assert.equal(bandsSentence(["mygo", "our-notes"]), "MyGO!!!!!、Our Notes");
});
