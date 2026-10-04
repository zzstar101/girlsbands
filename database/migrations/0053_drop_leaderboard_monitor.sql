-- This fork keeps neither of the AI-only optional modules (industry/features.ts): the model leaderboard
-- and the Codex reset monitor. Their stored state goes with them; nothing reads or writes it any more.
--   monitor_event_posts, monitor_events, monitor_posts, monitor_state  the reset monitor's posts, events and scan state
--   lb_models, lb_aliases, lb_snapshots, lb_scores, lb_runs, lb_rankings, lb_prices, lb_calibrations  the leaderboard's directory, snapshots, scores and published rounds
--   fx_rates                                                            read only by the leaderboard's price import
--   settings 'leaderboard.fetch', 'models.monitor'                       the leaderboard's per-source fetch state and the reset monitor's model override
-- Children first, so no foreign key is left pointing at a table that is gone.
DROP TABLE IF EXISTS monitor_event_posts;
DROP TABLE IF EXISTS monitor_posts;
DROP TABLE IF EXISTS monitor_events;
DROP TABLE IF EXISTS monitor_state;
DROP TABLE IF EXISTS lb_scores;
DROP TABLE IF EXISTS lb_rankings;
DROP TABLE IF EXISTS lb_aliases;
DROP TABLE IF EXISTS lb_snapshots;
DROP TABLE IF EXISTS lb_prices;
DROP TABLE IF EXISTS lb_runs;
DROP TABLE IF EXISTS lb_calibrations;
DROP TABLE IF EXISTS lb_models;
DROP TABLE IF EXISTS fx_rates;
-- Key-value settings the deleted modules wrote: the leaderboard's per-source fetch state, and the
-- admin's per-step model override for the reset monitor's recogniser.
DELETE FROM settings WHERE key = 'leaderboard.fetch';
DELETE FROM settings WHERE key = 'models.monitor';
