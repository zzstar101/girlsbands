-- Historical content review export (read-only). Run this where the production database is reachable;
-- the preview CLI (scripts/preview-content-review.ts) never connects to a database.
--
--   psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
--     -f scripts/export-content-review.sql > /tmp/content-review.rows.jsonl
--
-- -q matters: without it psql also prints the SET/BEGIN/COMMIT command tags, and the preview CLI
-- would try to parse them as rows.
--
-- Each output line is one JSON object shaped like ReviewRow in
-- packages/backend/src/operations/content-review.ts, so the CLI reads the result as JSONL.
--
-- The transaction cannot write: it is READ ONLY from the first statement, a slow scan is stopped by
-- statement_timeout, and lock_timeout keeps this query from waiting behind production writes. The
-- row cap (2500) is for the human preview, not for a complete archive: order by newest first.
--
-- Rows: public selected content that has reached its release gate, plus member-account posts from
-- the last 7 days (the daily lane and the work messages that must leave it). The member predicate is
-- the same one as publication/scope.ts memberSourceCondition: tag 成员, an owner, editorial mode.

SET default_transaction_read_only = on;

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

WITH picked AS (
  SELECT
    p.article_id AS "id",
    p.title AS "title",
    p.summary AS "summary",
    p.category AS "category",
    p.selected AS "selected",
    p.eligible AS "eligible",
    p.fact_id AS "factId",
    f.public_id AS "factPublicId",
    f.version AS "factVersion",
    COALESCE((
      SELECT x.output->>'scope'
      FROM analyses x
      WHERE x.article_id = p.article_id
      ORDER BY x.input_revision DESC, x.id DESC
      LIMIT 1
    ), 'unknown') AS "scope",
    (('成员' = ANY (s.tags)) AND s.owner_entity_id IS NOT NULL AND s.participation_mode = 'editorial') AS "member",
    COALESCE(jsonb_typeof(a.x_post->'retweetedBy') = 'object', false) AS "retweet",
    NULLIF(a.x_post->'quoted'->>'url', '') AS "quotedUrl",
    p.url AS "originalUrl",
    s.name AS "sourceName",
    left(coalesce(a.body_text, ''), 6000) AS "body",
    a.revision AS "revision",
    p.timeline_at AS "timelineAt"
  FROM publications p
  JOIN articles a ON a.id = p.article_id
  JOIN sources s ON s.id = p.source_id
  LEFT JOIN facts f ON f.id = p.fact_id
  WHERE p.visibility = 'public'
    AND (NOT p.selected OR p.visible_after <= now())
    AND (
      (p.selected AND p.visible_after <= now())
      OR (
        ('成员' = ANY (s.tags)) AND s.owner_entity_id IS NOT NULL AND s.participation_mode = 'editorial'
        AND p.timeline_at >= now() - interval '7 days'
        AND (p.eligible OR (p.category = 'daily' AND p.title IS NOT NULL AND p.summary IS NOT NULL))
        AND p.channel = 'x' AND p.body_mode = 'full'
      )
    )
  ORDER BY p.timeline_at DESC, p.article_id
  LIMIT 2500
)
SELECT to_jsonb(picked)
FROM picked
ORDER BY "timelineAt" DESC, "id";

COMMIT;
