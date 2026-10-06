CREATE TABLE page_views (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  path text NOT NULL,
  item_id text,
  referrer_host text,
  device text NOT NULL CHECK (device IN ('mobile', 'tablet', 'desktop')),
  visitor_day_hash text NOT NULL,
  country text
);
CREATE INDEX page_views_at_idx ON page_views (at);
CREATE INDEX page_views_day_hash_idx ON page_views (at, visitor_day_hash);
CREATE INDEX page_views_item_at_idx ON page_views (at, item_id) WHERE item_id IS NOT NULL;
CREATE INDEX page_views_path_at_idx ON page_views (at, path);

CREATE TABLE edge_traffic_daily (
  day date NOT NULL,
  domain text NOT NULL,
  requests bigint NOT NULL DEFAULT 0,
  flux_bytes bigint NOT NULL DEFAULT 0,
  top jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (day, domain)
);
CREATE INDEX edge_traffic_day_idx ON edge_traffic_daily (day DESC);
CREATE INDEX edge_traffic_domain_day_idx ON edge_traffic_daily (domain, day DESC);

CREATE INDEX receipts_created_purpose_idx ON receipts (created_at, purpose);
CREATE INDEX feedback_created_idx ON feedback (created_at);
CREATE INDEX email_sends_created_idx ON email_sends (created_at);
CREATE INDEX publications_discovered_idx ON publications (discovered_at);
CREATE INDEX publications_selected_discovered_idx ON publications (discovered_at) WHERE selected;
CREATE INDEX articles_discovered_state_idx ON articles (discovered_at);
CREATE INDEX fetch_runs_started_idx ON fetch_runs (started_at DESC);
CREATE INDEX subscribers_created_idx ON subscribers (created_at);
CREATE INDEX subscribers_unsubscribed_idx ON subscribers (unsubscribed_at) WHERE unsubscribed_at IS NOT NULL;
