-- HouseCup Live — initial schema (Cloudflare D1 / SQLite)
-- All timestamps are INTEGER unix epoch milliseconds, supplied by the application.
-- Totals are NEVER stored: they are always SUM(points) WHERE is_reverted = 0.

CREATE TABLE default_houses (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  short_name  TEXT    NOT NULL CHECK (length(short_name) BETWEEN 1 AND 4),
  color_hex   TEXT    NOT NULL CHECK (length(color_hex) = 7 AND substr(color_hex, 1, 1) = '#' AND substr(color_hex, 2) NOT GLOB '*[^0-9A-Fa-f]*'),
  icon_key    TEXT    CHECK (icon_key IS NULL OR length(icon_key) <= 32),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE events (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  slug                 TEXT    NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 64 AND slug NOT GLOB '*[^a-z0-9-]*'),
  category             TEXT    NOT NULL DEFAULT 'general'
                               CHECK (category IN ('sports','esports','chess','academic','general')),
  status               TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  is_featured          INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0,1)),
  counts_toward_season INTEGER NOT NULL DEFAULT 1 CHECK (counts_toward_season IN (0,1)),
  theme_mode           TEXT    NOT NULL DEFAULT 'daylight' CHECK (theme_mode IN ('daylight','arena')),
  is_frozen            INTEGER NOT NULL DEFAULT 0 CHECK (is_frozen IN (0,1)),
  frozen_at            INTEGER,
  announcement_text    TEXT    CHECK (announcement_text IS NULL OR length(announcement_text) <= 280),
  judge_token          TEXT    NOT NULL UNIQUE CHECK (length(judge_token) >= 22),
  judge_pin            TEXT    NOT NULL CHECK (length(judge_pin) = 4 AND judge_pin NOT GLOB '*[^0-9]*'),
  created_at           INTEGER NOT NULL,
  CHECK ((is_frozen = 0 AND frozen_at IS NULL) OR (is_frozen = 1 AND frozen_at IS NOT NULL))
);
CREATE UNIQUE INDEX ux_events_featured   ON events(is_featured) WHERE is_featured = 1;
CREATE UNIQUE INDEX ux_events_active_pin ON events(judge_pin)   WHERE status = 'active';
CREATE INDEX        ix_events_status     ON events(status, created_at DESC);

CREATE TABLE event_teams (
  id          INTEGER PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  house_id    INTEGER          REFERENCES default_houses(id) ON DELETE RESTRICT,
  name        TEXT    NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 40),
  short_name  TEXT    NOT NULL CHECK (length(short_name) BETWEEN 1 AND 4),
  color_hex   TEXT    NOT NULL CHECK (length(color_hex) = 7 AND substr(color_hex, 1, 1) = '#' AND substr(color_hex, 2) NOT GLOB '*[^0-9A-Fa-f]*'),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE (event_id, name),
  UNIQUE (id, event_id)
);
CREATE INDEX ix_teams_event ON event_teams(event_id, sort_order);
CREATE INDEX ix_teams_house ON event_teams(house_id) WHERE house_id IS NOT NULL;

CREATE TABLE score_events (
  id             INTEGER PRIMARY KEY,
  event_id       INTEGER NOT NULL,
  event_team_id  INTEGER NOT NULL,
  points         INTEGER NOT NULL CHECK (points <> 0 AND points BETWEEN -10000 AND 10000),
  label          TEXT    CHECK (label IS NULL OR length(label) BETWEEN 1 AND 60),
  judge_name     TEXT    CHECK (judge_name IS NULL OR length(judge_name) BETWEEN 1 AND 40),
  batch_id       TEXT    NOT NULL CHECK (length(batch_id) = 36),
  request_id     TEXT    NOT NULL UNIQUE,
  is_reverted    INTEGER NOT NULL DEFAULT 0 CHECK (is_reverted IN (0,1)),
  reverted_at    INTEGER,
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (event_team_id, event_id) REFERENCES event_teams(id, event_id) ON DELETE CASCADE,
  CHECK (request_id = batch_id || ':' || event_team_id),
  CHECK (is_reverted = 0 OR reverted_at IS NOT NULL)
);
CREATE INDEX ix_scores_totals ON score_events(event_id, is_reverted, created_at, event_team_id, points);
CREATE INDEX ix_scores_feed   ON score_events(event_id, created_at DESC);
CREATE INDEX ix_scores_batch  ON score_events(batch_id);
CREATE INDEX ix_scores_labels ON score_events(event_id, label, created_at) WHERE label IS NOT NULL;
