import assert from "node:assert/strict";
import { test } from "node:test";
import sources from "../industry/sources.json" with { type: "json" };
import { glossaryHits } from "@girlsbands/industry/glossary";

test("Hazuki Tanda is collected as a BanG Dream cast account, not a MyGO band member", () => {
  const source = sources.sources.find(s => s.id === 'x-tanda-hazuki');
  assert.ok(source, 'requested actor account must be in the seed pack');
  assert.equal(source.kind, 'x_search');
  assert.equal(source.name, '反田叶月（sumimi 純田まな）X');
  assert.equal(source.owner_entity_id, 'bang-dream');
  assert.equal(source.participation_mode, 'editorial');
  assert.ok(source.tags.includes('成员'));
  assert.equal(source.site_fulltext, true);
  assert.equal(source.syndicate_fulltext, false);
  assert.deepEqual(source.config, { query: 'from:tanda_hazuki -filter:replies', searchType: 'Latest', url: 'https://x.com/tanda_hazuki', publisherRole: 'person', _girlsbands: { initialBackfillLimit: 5 } });
});

test("the actor name has controlled Chinese and original spellings", () => {
  assert.ok(glossaryHits('反田葉月').some(hit => hit.forms.includes('反田叶月')));
});
