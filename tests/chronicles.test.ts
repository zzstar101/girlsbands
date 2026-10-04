// A band's chronicle band: curated history from industry/chronicles/{slug}.json (optional) up to the
// month it is curated through, then the milestones the site picked up itself. Written before the code,
// from the ways it can go wrong:
// - a file with an impossible date, an unknown kind, two links, a plain-http link, an event after the
//   month it claims to cover, another topic's name or a topic that is not a band gets served;
// - the band repeats a month the curated history covers, or loses one after it;
// - it is not in time order (a year-only date belongs before that year's months), or links go to
//   the wrong place (an event page, an article page, the original outside the site); a curated title
//   is rewritten, or a picked-up milestone shows the news headline instead of its label;
// - a milestone the site picked up is set in bold (only the curated history marks defining events), or
//   loses its kind;
// - a band without a curated history has no band;
// - a curated file in the repository does not follow the format (the curators' guard).
import "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { TopicEvent, TopicMonth } from "@girlsbands/contracts/site";
import { CHRONICLES_DIR, companyMilestones, parseChronicle } from "@girlsbands/backend/publication/chronicles";

const ok = {
  topic: "togenashi-togeari",
  through: "2026-08",
  events: [
    { date: "2015-12", kind: "member", title: "トゲナシトゲアリ 结成" },
    { date: "2022-11-30", kind: "release", title: "首张 Single 发售", summary: "首张 Single 发售，抽选瞬间售罄", major: true, url: "https://togenashitogeari.jp/news/first-single" },
  ],
};

test("a curated chronicle that does not follow the format is refused, with the reason", () => {
  assert.doesNotThrow(() => parseChronicle(ok, "togenashi-togeari"), "a valid file");
  const event = ok.events[1]!;
  const cases: Array<[unknown, string, string?]> = [
    [{ ...ok, events: [{ ...event, date: "2022-13" }] }, "a month that does not exist"],
    [{ ...ok, events: [{ ...event, date: "22-11-30" }] }, "a two-digit year"],
    [{ ...ok, events: [{ ...event, kind: "rumour" }] }, "an unknown kind"],
    [{ ...ok, events: [{ ...event, date: "2026-09-02" }] }, "an event after the month it is curated through"],
    [{ ...ok, events: [{ ...event, story: randomUUID() }] }, "two links"],
    [{ ...ok, events: [{ ...event, url: "http://example.com/" }] }, "a plain-http link"],
    [{ ...ok, events: [{ ...event, title: "" }] }, "an empty title"],
    [{ ...ok, events: [] }, "no events"],
    [ok, "a file named after another topic", "mygo"],
    [{ ...ok, topic: "release" }, "a topic that is not a band", "release"],
  ];
  for (const [file, why, slug = "togenashi-togeari"] of cases) assert.throws(() => parseChronicle(file, slug), Error, why);
});

let n = 0;
function event(at: string, extra: Partial<TopicEvent> = {}): TopicEvent {
  n += 1;
  return { id: `a${n}`, title: `自动报道 ${n}，附带细节`, label: `自动 ${n}`, at, kind: "live", href: `/items/a${n}`, ...extra };
}

test("a band's band is its curated history, then the milestones picked up after it", () => {
  const story = randomUUID();
  const curated = parseChronicle({
    topic: "togenashi-togeari",
    through: "2026-08",
    events: [
      { date: "2024-05-13", kind: "release", title: "发布首张 Album", story },
      { date: "2024", kind: "member", title: "全年动态", item: "cmabc123" },
      ...ok.events,
    ],
  }, "togenashi-togeari");
  const august = event("2026-08-20T04:00:00Z");
  const september = event("2026-09-10T04:00:00Z", { kind: "ticket" });
  const october = event("2026-10-01T16:30:00Z", { kind: "member", href: "/story/x" });
  const auto: TopicMonth[] = [
    { month: "2026-10", events: [october] },
    { month: "2026-09", events: [september] },
    { month: "2026-08", events: [august] },
  ];
  const band = companyMilestones(curated, auto);
  assert.deepEqual(band.map((m) => m.date), ["2015-12", "2022-11-30", "2024", "2024-05-13", "2026-09-10", "2026-10-02"], "time order; August is curated, so the picked-up August is left out; 00:30 Beijing is the next day");
  assert.deepEqual(band.map((m) => m.href), [null, "https://togenashitogeari.jp/news/first-single", "/items/cmabc123", `/story/${story}`, september.href, "/story/x"]);
  assert.deepEqual(band.map((m) => m.external), [false, true, false, false, false, false]);
  assert.deepEqual(band.map((m) => m.kind), ["member", "release", "member", "release", "ticket", "member"]);
  assert.deepEqual(band.map((m) => m.title), ["トゲナシトゲアリ 结成", "首张 Single 发售", "全年动态", "发布首张 Album", september.label, october.label], "curated titles as written, picked-up milestones by their labels");
  assert.deepEqual(band.map((m) => m.headline), [null, null, null, null, september.title, october.title], "the report's own headline stays with a picked-up milestone");
  assert.deepEqual(band.map((m) => m.major), [false, true, false, false, false, false], "only the curated history marks defining events");
  assert.equal(band[1]!.summary, "首张 Single 发售，抽选瞬间售罄");
});

test("a band without a curated history still has its band: the year the site picked up", () => {
  const auto: TopicMonth[] = [{ month: "2026-10", events: [event("2026-10-02T04:00:00Z")] }, { month: "2026-09", events: [event("2026-09-03T04:00:00Z"), event("2026-09-01T04:00:00Z")] }];
  assert.deepEqual(companyMilestones(undefined, auto).map((m) => m.date), ["2026-09-01", "2026-09-03", "2026-10-02"]);
});

test("every curated chronicle in the repository follows the format", () => {
  // The folder is optional: an industry pack may ship no curated history at all.
  for (const f of (existsSync(CHRONICLES_DIR) ? readdirSync(CHRONICLES_DIR) : []).filter((name) => name.endsWith(".json"))) {
    parseChronicle(JSON.parse(readFileSync(path.join(CHRONICLES_DIR, f), "utf8")), f.slice(0, -5));
  }
});
