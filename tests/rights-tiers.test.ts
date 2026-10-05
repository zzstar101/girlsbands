// W17: every source carries a rights tier, so the admin can answer a rights holder and one day tighten by
// layer. This change records and displays the label only — the site still shows every licensed source in
// full, and the guard test below fails if that changes without the switch being made on purpose.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@girlsbands/backend/db";
import { stopBoss } from "@girlsbands/backend/jobs/queue";
import { updateSource } from "@girlsbands/backend/admin/sources";
import { bodyModeOf, RIGHTS_TIERS, rightsTierOf, type SourceFacts } from "@girlsbands/backend/publication/rules";

const T = tag();
const id = (name: string) => `test-rights-${name}-${T}`;
const feed = (name: string) => ({ feedUrl: `https://example.org/rights-${T}/${name}.xml` });

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, rights_tier, rights_note, next_fetch_at) VALUES
    (${id("plain")}, '未标注来源', 'rss', ${sql.json(feed("plain"))}, 'T2', 'editorial', DEFAULT, null, '2100-01-01'),
    (${id("own")}, '官方账号（本地）', 'rss', ${sql.json(feed("own"))}, 'T2', 'editorial', 'media', null, '2100-01-01'),
    (${id("explicit")}, '显式标注来源', 'rss', ${sql.json(feed("explicit"))}, 'T2', 'editorial', 'media', null, '2100-01-01'),
    (${id("licensed")}, '许可转载来源', 'rss', ${sql.json(feed("licensed"))}, 'T2', 'editorial', 'licensed', '来源方来信允许转载（本地测试）', '2100-01-01')`;
});

after(async () => {
  await stopBoss();
  await closeDb();
});

test("the tier follows the owner, not the tier label alone", () => {
  const cases: Array<[string, string | null, string]> = [
    ["T1", "girls-band-cry", "official"],
    ["T1_5", "togenashi-togeari", "official"],
    // An own feed with no owner is not first-hand yet: the judge is who owns the account.
    ["T1", null, "media"],
    ["T1_5", null, "media"],
    // A third party stays a third party whatever id it carries.
    ["T2", "rss-lisani", "media"],
    ["T2", null, "media"],
    ["T2_EVENT", null, "event_data"],
    ["T2_EVENT", "bilibili", "event_data"],
    ["EXCLUDE_MP", null, "media"],
  ];
  for (const [tier, owner, want] of cases) assert.equal(rightsTierOf({ tier, ownerEntityId: owner }), want, `${tier} / ${owner}`);
});

test("the switch is not made yet: a media source with a full-text licence still shows its body", () => {
  const lisani: SourceFacts = { id: "rss-lisani", name: "LisAni!", kind: "rss", tier: "T2", participation_mode: "editorial", first_party: false, site_fulltext: true, syndicate_fulltext: false };
  assert.equal(rightsTierOf({ tier: lisani.tier, ownerEntityId: null }), "media");
  assert.equal(bodyModeOf(lisani, "ok", true), "full", "W17 records the label; it does not act on it");
  assert.equal(bodyModeOf({ ...lisani, site_fulltext: false }, "ok", true), "summary", "the licence flag is still the only input");
});

test("an unlabelled source is media, and a value outside the four tiers is refused", async () => {
  const [plain] = await sql<{ rights_tier: string; rights_note: string | null }[]>`SELECT rights_tier, rights_note FROM sources WHERE id = ${id("plain")}`;
  assert.deepEqual([plain!.rights_tier, plain!.rights_note], ["media", null], "the column default is the conservative label");
  const used = await sql<{ rights_tier: string }[]>`SELECT DISTINCT rights_tier FROM sources`;
  for (const { rights_tier: tier } of used) assert.ok((RIGHTS_TIERS as readonly string[]).includes(tier), `${tier} is one of the four`);
  await assert.rejects(sql`UPDATE sources SET rights_tier = 'first_party' WHERE id = ${id("plain")}`, /sources_rights_tier_check/, "the vocabulary stays closed");
});

test("editing the tier or the owner relabels the source; an explicit label wins and a licence is never overwritten", async () => {
  const patch = async (sourceId: string, p: Record<string, unknown>) => {
    const [row] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM sources WHERE id = ${sourceId}`;
    return updateSource(sourceId, { patch: p, version: row!.updated_at.toISOString() }, "test") as Promise<{ rights_tier: string; rights_note: string | null }>;
  };
  const tierOf = async (sourceId: string) => (await sql<{ rights_tier: string }[]>`SELECT rights_tier FROM sources WHERE id = ${sourceId}`)[0]!.rights_tier;

  const owned = await patch(id("own"), { tier: "T1_5", owner_entity_id: "girls-band-cry" });
  assert.equal(owned.rights_tier, "official", "an official account with an owner is first-hand");
  const untouched = await patch(id("own"), { interval_minutes: 120 });
  assert.equal(untouched.rights_tier, "official", "editing something else leaves the label alone");
  const cleared = await patch(id("own"), { owner_entity_id: null });
  assert.equal(cleared.rights_tier, "media", "clearing the owner takes the official label away");

  const explicit = await patch(id("explicit"), { tier: "T1_5", owner_entity_id: "girls-band-cry", rights_tier: "media" });
  assert.equal(explicit.rights_tier, "media", "a label sent in the same edit is the admin's word, not a derivation");

  const licensed = await patch(id("licensed"), { tier: "T1_5", owner_entity_id: "girls-band-cry" });
  assert.equal(licensed.rights_tier, "licensed", "an agreement with the rights holder outlives a tier edit");
  assert.equal(licensed.rights_note, "来源方来信允许转载（本地测试）");
  assert.equal(await tierOf(id("licensed")), "licensed", "and it is the stored value, not a display default");
});
