// Seeds a fresh site from the industry pack: the demo sources (industry/sources.json, only the ones not
// there yet, so admin edits are never undone). Topics need no seeding: they are read from industry/topics.json.
// Re-runnable:  bun scripts/seed.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@girlsbands/backend/config";
import { closeDb, sql } from "@girlsbands/backend/db";
import { assertSupportedConfig } from "@girlsbands/backend/sources/config-keys";
import { rightsTierOf } from "@girlsbands/backend/publication/rules";

interface SeedSource {
  id: string;
  name: string;
  kind: "rss" | "web_list" | "json_list" | "x_search" | "mp_account" | "external";
  config: Record<string, unknown>;
  tier?: string;
  owner_entity_id?: string | null;
  participation_mode?: string;
  interval_minutes?: number;
  tags?: string[];
  site_fulltext?: boolean;
  syndicate_fulltext?: boolean;
  rights_tier?: string;
  rights_note?: string | null;
  enabled?: boolean;
}

const { sources } = JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/sources.json"), "utf8")) as { sources: SeedSource[] };
let added = 0;
for (const s of sources) {
  assertSupportedConfig(s.kind, s.config);
  const tier = s.tier ?? "T2";
  // First-party means a T1 source, as the admin sets it.
  const owner = s.owner_entity_id ?? null;
  // The rights tier is stored state the admin edits; a seeded source gets the label the rule gives it.
  const rightsTier = s.rights_tier ?? rightsTierOf({ tier, ownerEntityId: owner });
  const inserted = await sql`
    INSERT INTO sources (id, name, kind, config, tier, first_party, owner_entity_id, participation_mode, interval_minutes, tags, site_fulltext, syndicate_fulltext, rights_tier, rights_note, enabled, next_fetch_at)
    VALUES (${s.id}, ${s.name}, ${s.kind}, ${sql.json(s.config as never)}, ${tier}, ${tier === "T1"}, ${owner},
            ${s.participation_mode ?? "editorial"}, ${s.interval_minutes ?? 60}, ${s.tags ?? []}, ${s.site_fulltext ?? false}, ${s.syndicate_fulltext ?? false},
            ${rightsTier}, ${s.rights_note ?? null}, ${s.enabled ?? true}, now())
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  added += inserted.length;
}
console.log(`sources: ${added} added, ${sources.length - added} already there`);
await closeDb();
