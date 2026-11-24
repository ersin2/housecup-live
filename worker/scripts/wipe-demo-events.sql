-- HouseCup Live: pre-event wipe.
-- Deletes ALL events, their teams and every score entry.
-- KEEPS default_houses (your configured School Houses).
--
-- 1. Back up first:  npx wrangler d1 export housecup --remote --output=../backups/pre-wipe.sql
-- 2. Run:            npx wrangler d1 execute housecup --remote --file=scripts/wipe-demo-events.sql
-- 3. Then in /admin click "Refresh all live screens" (POST /api/admin/republish).
DELETE FROM score_events;
DELETE FROM event_teams;
DELETE FROM events;
