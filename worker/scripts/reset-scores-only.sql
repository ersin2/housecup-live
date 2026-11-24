-- HouseCup Live: keep events, teams and houses exactly as configured; delete every score entry
-- and lift any Mystery-mode freeze. Use this after a rehearsal on the real events.
--
--   npx wrangler d1 execute housecup --remote --file=scripts/reset-scores-only.sql
-- Then in /admin click "Refresh all live screens".
DELETE FROM score_events;
UPDATE events SET is_frozen = 0, frozen_at = NULL;
