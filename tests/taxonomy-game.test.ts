import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORIES, ENTITY_TAGS, ENTITIES } from "@girlsbands/industry/taxonomy";

test("Our Notes is represented as a game project with a public game category", () => {
  assert.equal(ENTITIES["our-notes"]?.kind, "project");
  assert.ok(ENTITIES["our-notes"]?.aliases.includes("アワーノーツ"));
  assert.ok(CATEGORIES.some((category) => category.key === "game" && category.label === "游戏"));
  assert.ok(ENTITY_TAGS.includes("Our Notes"));
});
