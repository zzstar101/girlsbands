-- The brand-specific namespace inside sources.config is renamed. The key holds settings that belong to
-- this collector rather than to the publisher, so it is now named after the site (_girlsbands) instead of
-- the upstream project (_aihot). packages/backend/src/sources/config-keys.ts allows the new name and
-- packages/backend/src/sources/collect.ts reads the backfill limits from it; industry/sources.json already
-- carries the new key. Rows written before this migration still hold the old one, and without the rewrite
-- their backfill configuration would silently fall back to the defaults (30 items, 12 months).
-- Older rows may also carry the key while already having the new one; the new value wins in that case,
-- because taking the old value back would undo a later edit.
UPDATE sources
SET config = (config - '_aihot') || jsonb_build_object('_girlsbands', config -> '_aihot')
WHERE config ? '_aihot' AND NOT config ? '_girlsbands';
UPDATE sources SET config = config - '_aihot' WHERE config ? '_aihot';
