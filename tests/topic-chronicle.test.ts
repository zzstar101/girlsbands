// Topic milestones: the rules in publication/topic-chronicle.ts with this industry's industry/chronicle.ts,
// on reports as the topic index reads them. Written from the ways it can go wrong:
// - kinds: a band's month fills with one kind and crowds out another, because every kind is capped
//   separately (Live, 票务, 发售, 周边, 直播, 联动, 成员, 通知, 媒体);
// - not a milestone: a roundup, a best-of list, a rumour, a goods catalogue or a "today's one song"
//   column is editor content or unconfirmed, however high its score;
// - media: a magazine column or a podcast chat is not an event, but a TV, radio or 生放送 appearance is;
// - one event: reports of one announcement within a week (the official site and the official X, a
//   Japanese and a Chinese post, 開催決定 and を開催) stay one milestone, at the earliest date;
// - stages: a Live's 公布, FC 先行, 抽选, 一般贩售, 追加席, 开演 are separate milestones of one story —
//   the later stages must not be folded into the announcement;
// - ownership: a band takes an announcement whose title names another band first, or one its own source
//   alone carries; a project's page takes its bands' news, a band's page does not take its project's;
// - directions and forms: a content-form topic's chronicle takes what names the form, not everything
//   carrying its tag;
// - curated history: an older, stronger report in a month a band's curated history covers suppresses
//   the automatic milestone after that month;
// - limits: a form topic keeps no more of a busy month than its own perMonth; a band's kinds keep theirs;
// - labels: a milestone reads as the event's name, with the subject opening and the announcement verb
//   removed on its own page ("8th ONE-MAN LIVE『凛音の理』"), and a 公演名 or 碟名 is copied as-is,
//   never translated;
// - deliberately gone: the old industry's model-name machinery (a version regex, tier words such as
//   "Flash", matching a follow-up report that names only a codename) has no counterpart here, so it was
//   deleted along with its three tests. A band's event name is the title with the subject opening and the
//   trailing announcement verb removed; two events of one kind in one week merge when those names match.
import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHRONICLE } from "@aihot/industry/chronicle";
import { findTopic, TOPICS } from "@aihot/backend/publication/topics";
import { selectTopicChronicle, selectTopicHighlights, type ChronicleReport } from "@aihot/backend/publication/topic-chronicle";

const NOW = new Date("2026-09-30T20:00:00+08:00");
const window = { now: NOW };
const ALL = TOPICS.map((t) => t.slug);
const topic = (slug: string) => {
  const t = findTopic(slug);
  assert.ok(t, slug);
  return t;
};

let n = 0;
/** A selected report, on 10 September unless `day` says otherwise. */
function report(title: string, o: Partial<ChronicleReport> & { day?: number } = {}): ChronicleReport {
  n += 1;
  const at = new Date(`2026-09-${String(o.day ?? 10).padStart(2, "0")}T12:00:00+08:00`);
  return {
    id: `r${n}`, title, originalTitle: null, category: "live", tags: ["新 Live"], score: 85, topicSlugs: ALL,
    timelineAt: at, publishedAt: at, factPublishedAt: null, firstParty: false, owner: null, factId: null, factSubject: null,
    factAction: null, factOccurredAt: null, storyPublicId: null, sourceCount: 1, scope: "single", ...o,
  };
}
const ticket = (title: string, o: Partial<ChronicleReport> & { day?: number } = {}) => report(title, { category: "ticket", tags: ["开售/抽选"], ...o });
const disc = (title: string, o: Partial<ChronicleReport> & { day?: number } = {}) => report(title, { category: "release", tags: ["新作发售"], ...o });
// A subject's own news carries its entity tag, the way publication/publish.ts files it: member, notice and
// media have no launch verb of their own, so the tag is what says the news is this band's.
const member = (title: string, o: Partial<ChronicleReport> & { day?: number } = {}) => report(title, { category: "member", tags: ["成员动态", "entity:togenashi-togeari"], ...o });
const notice = (title: string, o: Partial<ChronicleReport> & { day?: number } = {}) => report(title, { category: "notice", tags: ["中止/延期", "entity:togenashi-togeari"], ...o });
const media = (title: string, o: Partial<ChronicleReport> & { day?: number } = {}) => report(title, { category: "media", tags: ["媒体访谈", "entity:togenashi-togeari"], ...o });
const events = (slug: string, reports: ChronicleReport[]) => selectTopicChronicle(topic(slug), reports, window).flatMap((m) => m.events);
const titles = (slug: string, reports: ChronicleReport[]) => events(slug, reports).map((e) => e.title);
const kinds = (slug: string, reports: ChronicleReport[]) => events(slug, reports).map((e) => e.kind);
const of = (slug: string, reports: ChronicleReport[], kind: string) => events(slug, reports).filter((e) => e.kind === kind).map((e) => e.title).sort();

test("一场 Live 的每个阶段各自成为一个节点，不会被并进公布那一条", () => {
  const reports = [
    report("トゲナシトゲアリ、8th ONE-MAN LIVE 開催決定", { score: 90, day: 1 }),
    ticket("トゲナシトゲアリ 8th ONE-MAN LIVE FC先行受付開始", { score: 88, day: 5 }),
    ticket("トゲナシトゲアリ 8th ONE-MAN LIVE 一般発売開始", { score: 86, day: 20 }),
  ];
  const picked = events("togenashi-togeari", reports);
  assert.deepEqual(picked.map((e) => e.kind).sort(), ["live", "ticket", "ticket"], "公布与两轮票务各自成立");
  assert.equal(new Set(picked.map((e) => e.title)).size, 3, "三条都留着");
});

test("同一场公演一周内的多条报道并成一个节点，取最早日期", () => {
  const reports = [
    report("トゲナシトゲアリ、8th ONE-MAN LIVE 開催決定", { score: 90, day: 3 }),
    report("トゲナシトゲアリ 8th ONE-MAN LIVE を開催", { score: 84, day: 5 }),
    report("トゲナシトゲアリ 8th ONE-MAN LIVE 開催決定", { score: 96, day: 6, sourceCount: 3 }),
  ];
  const picked = events("togenashi-togeari", reports);
  assert.equal(picked.length, 1);
  assert.equal(picked[0]!.at.slice(0, 10), "2026-09-03", "最早的一条代表这次公布");
});

test("汇总、榜单、传闻与商品目录不是大事记，分数再高也不算", () => {
  const out = [
    report("トゲナシトゲアリ 歴代 Live まとめ", { score: 99, day: 1 }),
    report("今週のライブ情報まとめ", { score: 99, day: 2 }),
    media("トゲナシトゲアリ 名盤ランキング", { score: 99, day: 3 }),
    report("噂：トゲナシトゲアリ 海外公演があるらしい", { score: 99, day: 4 }),
    report("トゲナシトゲアリ 未確認の追加公演情報", { score: 99, day: 5 }),
    report("トゲナシトゲアリ グッズ紹介", { score: 99, day: 6 }),
  ];
  assert.deepEqual(titles("togenashi-togeari", out), []);
  assert.deepEqual(titles("one-man", out), [], "内容形态主题也一样");
});

test("媒体内容只有电视、广播、生放送这类出演才算事件", () => {
  const column = media("トゲナシトゲアリ 理名 インタビュー「凛音の理」を語る", { score: 90, day: 2 });
  const tv = media("トゲナシトゲアリ 理名 テレビ出演決定", { score: 90, day: 3 });
  assert.deepEqual(titles("togenashi-togeari", [column]), [], "杂志访谈不是事件");
  assert.deepEqual(titles("togenashi-togeari", [tv]), [tv.title], "电视出演是");
  assert.deepEqual(titles("media-interviews", [column]), [column.title], "在媒体形态主题里它仍是一条");
});

test("企划／乐队主题各类型分开取，按各自的分数门槛和每月名额", () => {
  const live = CHRONICLE.kinds.live!.company!;
  const reports = [
    ...Array.from({ length: live.perMonth + 2 }, (_, i) => report(`トゲナシトゲアリ、${i + 1}th ONE-MAN LIVE 開催決定`, { score: 90 - i, day: 1 + i })),
    disc("トゲナシトゲアリ 新シングル発売決定", { score: 88, day: 12 }),
    member("トゲナシトゲアリ 理名 卒業のお知らせ", { score: 95, day: 13 }),
  ];
  const picked = events("togenashi-togeari", reports);
  assert.equal(picked.filter((e) => e.kind === "live").length, live.perMonth, "Live 只取名额内的几条");
  assert.deepEqual(picked.filter((e) => e.kind === "release").map((e) => e.title), ["トゲナシトゲアリ 新シングル発売決定"], "发售不被 Live 挤掉");
  assert.equal(picked.filter((e) => e.kind === "member").length, 1);
});

test("内容形态主题每月按自己的名额取舍：旗舰形态八条，其余五条", () => {
  const many = (n: number, what: string) => Array.from({ length: n }, (_, i) => report(`バンド${i} ${what} 開催決定`, { score: 95 - i, day: 1 + i }));
  const flagship = many(9, "ONE-MAN LIVE");
  assert.equal(events("one-man", flagship).length, CHRONICLE.forms["one-man"]!.perMonth);
  assert.ok(!titles("one-man", flagship).includes(flagship[8]!.title), "最不重要的一条掉出去");
  assert.equal(events("tours", many(7, "全国ツアー")).length, 5, "其余形态按框架默认的五条");
});

test("人工整理的历史覆盖到哪个月，自动节点就从那之后开始", () => {
  const august = new Date("2026-08-20T12:00:00+08:00");
  const older = report("トゲナシトゲアリ、8th ONE-MAN LIVE 開催決定", { storyPublicId: "s-curated", score: 95, timelineAt: august, publishedAt: august });
  const newer = report("トゲナシトゲアリ、9th ONE-MAN LIVE 開催決定", { storyPublicId: "s-curated", score: 80 });
  const picked = selectTopicChronicle(topic("togenashi-togeari"), [older, newer], { now: NOW, through: "2026-08" }).flatMap((m) => m.events);
  assert.deepEqual(picked.map((e) => [e.title, e.at.slice(0, 10)]), [[newer.title, "2026-09-10"]], "八月被人工历史覆盖，九月照常");
});

test("企划／乐队的搜索摘要按类型先后排：Live 在发售之前，发售在成员之前", () => {
  const reports = [
    member("トゲナシトゲアリ 理名 卒業のお知らせ", { score: 99, day: 25 }),
    disc("トゲナシトゲアリ 新シングル発売決定", { score: 90, day: 26 }),
    report("トゲナシトゲアリ、8th ONE-MAN LIVE 開催決定", { score: 80, day: 27 }),
  ];
  const order = selectTopicHighlights(topic("togenashi-togeari"), reports, window).map((e) => e.kind);
  const rank = (k: string) => order.indexOf(k);
  assert.ok(rank("live") >= 0 && rank("release") >= 0 && rank("member") >= 0, `三种都要在：${order.join(",")}`);
  assert.ok(rank("live") < rank("release"), "Live 在前");
  assert.ok(rank("release") < rank("member"), "发售在成员之前");
});

test("一支乐队的节点是它自己的：标题先点名它，或者这条报道只关于它", () => {
  const other = member("MyGO!!!!! 羊宮妃那 活動休止のお知らせ", { tags: ["成员动态", "entity:mygo"], score: 95, day: 2 });
  assert.deepEqual(titles("togenashi-togeari", [other]), [], "别家乐队的成员消息不是这一家的");
  assert.deepEqual(titles("mygo", [other]), [other.title], "在它自己的页面上就是一条");

  const bySubject = member("理名 卒業のお知らせ", { tags: ["成员动态"], factSubject: "togenashi-togeari", score: 95, day: 3 });
  assert.deepEqual(titles("togenashi-togeari", [bySubject]), [bySubject.title], "事实主体是它");

  const shared = member("トゲナシトゲアリ×MyGO!!!!! 対談", { tags: ["成员动态", "entity:togenashi-togeari", "entity:mygo"], score: 95, day: 4 });
  assert.deepEqual(titles("togenashi-togeari", [shared]), [], "两家的报道不是任何一家独有的");
  assert.deepEqual(titles("mygo", [shared]), []);
});

test("公布的标题在动作之前先点名别的乐队时，不是这一家的公布", () => {
  const other = report("Ave Mujica 主催対バンに トゲナシトゲアリ 出演決定", { score: 92, day: 2 });
  assert.deepEqual(titles("togenashi-togeari", [other]), [], "动作之前先点名的是 Ave Mujica");
  assert.deepEqual(titles("ave-mujica", [other]), [other.title], "对 Ave Mujica 来说是它自己的");
  assert.deepEqual(titles("togenashi-togeari", [{ ...other, factSubject: "togenashi-togeari" }]), [other.title], "事实主体是它时算它的公布");
});

test("不同的 Live 各自成节点：序号不同，或隔了一周", () => {
  const eight = report("トゲナシトゲアリ、8th ONE-MAN LIVE 開催決定", { score: 90, day: 1 });
  const nine = report("トゲナシトゲアリ、9th ONE-MAN LIVE 開催決定", { score: 90, day: 2 });
  const later = report("トゲナシトゲアリ、8th ONE-MAN LIVE 開催決定", { score: 90, day: 22 });
  assert.equal(events("togenashi-togeari", [eight, nine]).length, 2, "8th 和 9th 不是一场");
  assert.equal(events("togenashi-togeari", [eight, later]).length, 2, "隔了三周不是一次公布");
});

test("情报领域主题只收点名了这个领域的内容，不只带标签", () => {
  const named = ticket("トゲナシトゲアリ、8th ONE-MAN LIVE FC先行受付開始", { score: 88, day: 2 });
  const onlyTagged = ticket("トゲナシトゲアリ、8th ONE-MAN LIVE 開催決定", { score: 88, day: 3 });
  assert.deepEqual(titles("ticket", [named]), [named.title], "标题点了票务的领域词");
  assert.deepEqual(titles("ticket", [onlyTagged]), [], "只说 Live、只是带了票务标签就不算");
});

test("事件名去掉开头的主体和末尾的公布动作，公演名照抄不翻译", () => {
  const label = (slug: string, title: string, o: Partial<ChronicleReport> = {}) => events(slug, [report(title, o)]).map((e) => e.label)[0];
  const cases: Array<[string, string, string, Partial<ChronicleReport>?]> = [
    ["togenashi-togeari", "トゲナシトゲアリ、8th ONE-MAN LIVE『凛音の理』開催決定", "8th ONE-MAN LIVE『凛音の理』"],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE『凛音の理』を開催", "8th ONE-MAN LIVE『凛音の理』"],
    ["togenashi-togeari", "トゲナシトゲアリ：8th ONE-MAN LIVE『凛音の理』開催決定", "8th ONE-MAN LIVE『凛音の理』"],
    ["togenashi-togeari", "トゲナシトゲアリが8th ONE-MAN LIVEを開催決定", "8th ONE-MAN LIVE"],
    ["mygo", "MyGO!!!!! 新シングル「名前のない歌」リリース決定", "新シングル「名前のない歌」", { category: "release", tags: ["新作发售"] }],
    ["ave-mujica", "Ave Mujica 新アルバム『Completeness』発売決定", "新アルバム『Completeness』", { category: "release", tags: ["新作发售"] }],
    ["kessoku-band", "結束バンド 新曲「青春コンプレックス」配信開始", "新曲「青春コンプレックス」", { category: "release", tags: ["数字发行"] }],
    ["togenashi-togeari", "トゲナシトゲアリ FC先行受付開始", "FC先行受付", { category: "ticket", tags: ["开售/抽选"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE チケット一般発売開始", "8th ONE-MAN LIVE チケット一般発売", { category: "ticket", tags: ["一般贩售"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 新单曲《名前のない歌》发售决定", "新单曲《名前のない歌》", { category: "release", tags: ["新作发售"] }],
    ["togenashi-togeari", "トゲナシトゲアリ×MyGO!!!!! 対バンライブ開催決定", "トゲナシトゲアリ×MyGO!!!!! 対バンライブ"],
    ["roselia", "Roselia、9th Live 開催決定", "9th Live"],
    ["one-man", "トゲナシトゲアリ、8th ONE-MAN LIVE 開催決定", "トゲナシトゲアリ、8th ONE-MAN LIVE"],
    // 日文标题的真实写法：顿号后面还接一句（只留前半句）、票务和周边各自的说法、通知末尾的「のお知らせ」、
    // 括号标签留在开头（框架的选择）、合作演出里的两个乐队名一起照抄、外文标题照抄不翻译。
    ["togenashi-togeari", "トゲナシトゲアリ、8th ONE-MAN LIVE『凛音の理』開催決定、チケットは9月5日よりFC先行", "8th ONE-MAN LIVE『凛音の理』"],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE チケット抽選受付開始", "8th ONE-MAN LIVE チケット抽選受付", { category: "ticket", tags: ["开售/抽选"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE 追加席販売決定", "8th ONE-MAN LIVE 追加席販売", { category: "ticket", tags: ["追加席"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE Blu-ray 発売決定", "8th ONE-MAN LIVE Blu-ray", { category: "release", tags: ["新作发售"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE ライブ配信決定", "8th ONE-MAN LIVE", { category: "stream", tags: ["直播/影像"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE 生配信決定", "8th ONE-MAN LIVE 生配信", { category: "stream", tags: ["直播/影像"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE アーカイブ配信開始", "8th ONE-MAN LIVE アーカイブ", { category: "stream", tags: ["直播/影像"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE グッズ発売決定", "8th ONE-MAN LIVE グッズ", { category: "merch", tags: ["周边/特典"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE 開催記念カフェ開催決定", "8th ONE-MAN LIVE 開催記念カフェ", { category: "collab", tags: ["联动/企划"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 理名 テレビ出演決定", "理名 テレビ出演", { category: "media", tags: ["媒体访谈", "entity:togenashi-togeari"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 理名 活動休止のお知らせ", "理名 活動休止", { category: "member", tags: ["成员动态", "entity:togenashi-togeari"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 理名 卒業のお知らせ", "理名 卒業", { category: "member", tags: ["成员动态", "entity:togenashi-togeari"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 新メンバー加入決定", "新メンバー加入", { category: "member", tags: ["成员动态", "entity:togenashi-togeari"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE 開催延期のお知らせ", "8th ONE-MAN LIVE 開催延期", { category: "notice", tags: ["中止/延期", "entity:togenashi-togeari"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE 会場変更のお知らせ", "8th ONE-MAN LIVE 会場変更", { category: "notice", tags: ["中止/延期", "entity:togenashi-togeari"] }],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE 開催決定！", "8th ONE-MAN LIVE"],
    ["togenashi-togeari", "【速報】トゲナシトゲアリ 8th ONE-MAN LIVE 開催決定", "【速報】トゲナシトゲアリ 8th ONE-MAN LIVE"],
    ["togenashi-togeari", "トゲナシトゲアリ×MyGO!!!!! 対バンライブ開催決定", "トゲナシトゲアリ×MyGO!!!!! 対バンライブ"],
    ["togenashi-togeari", "トゲナシトゲアリが8th ONE-MAN LIVEを開催決定", "8th ONE-MAN LIVE"],
    ["togenashi-togeari", "トゲナシトゲアリ 8th ONE-MAN LIVE『凛音の理』を開催", "8th ONE-MAN LIVE『凛音の理』"],
    ["togenashi-togeari", "トゲトゲの8th ONE-MAN LIVE開催決定", "トゲトゲの8th ONE-MAN LIVE"],
    ["togenashi-togeari", "トゲナシトゲアリ 新单曲《名前のない歌》发售决定", "新单曲《名前のない歌》", { category: "release", tags: ["新作发售"] }],
    ["mygo", "MyGO!!!!! 1st Album『迷跡波』初回限定盤発売決定", "1st Album『迷跡波』初回限定盤発売", { category: "release", tags: ["新作发售"] }],
    ["mygo", "MyGO!!!!! 新シングル「名前のない歌」リリース決定", "新シングル「名前のない歌」", { category: "release", tags: ["新作发售"] }],
    ["mygo", "MyGO!!!!! 全国ツアー開催決定", "全国ツアー", { category: "live", tags: ["巡演"] }],
    ["mygo", "MyGO!!!!! 5th LIVE 開催決定", "5th LIVE"],
    ["roselia", "Roselia 9th LIVE チケットFC先行受付開始", "9th LIVE チケットFC先行受付", { category: "ticket", tags: ["开售/抽选"] }],
    ["kessoku-band", "結束バンド 新曲「青春コンプレックス」配信開始", "新曲「青春コンプレックス」", { category: "release", tags: ["数字发行"] }],
    ["girls-band-cry", "ガールズバンドクライ 新作劇場版 公開決定", "新作劇場版 公開", { category: "release", tags: ["新作发售"] }],
    ["bang-dream", "バンドリ！ MyGO!!!!! 5th LIVE 開催決定", "MyGO!!!!! 5th LIVE"],
  ];
  for (const [slug, title, expected, o] of cases) assert.equal(label(slug, title, o), expected, `${slug}: ${title}`);
});
