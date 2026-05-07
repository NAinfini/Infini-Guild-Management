PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS events_legacy_before_poll_type AS
SELECT * FROM events;

CREATE TABLE IF NOT EXISTS event_participants_before_poll_type AS
SELECT * FROM event_participants;

CREATE TABLE IF NOT EXISTS event_polls_before_poll_type AS
SELECT * FROM event_polls;

CREATE TABLE IF NOT EXISTS event_poll_options_before_poll_type AS
SELECT * FROM event_poll_options;

CREATE TABLE IF NOT EXISTS event_poll_votes_before_poll_type AS
SELECT * FROM event_poll_votes;

CREATE TABLE IF NOT EXISTS war_history_event_links_before_poll_type AS
SELECT id, event_id FROM war_history WHERE event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS war_templates_event_links_before_poll_type AS
SELECT id, source_event_id FROM war_templates WHERE source_event_id IS NOT NULL;

DELETE FROM event_poll_votes;
DELETE FROM event_poll_options;
DELETE FROM event_polls;
DELETE FROM event_participants;

UPDATE war_history SET event_id = NULL WHERE event_id IS NOT NULL;
UPDATE war_templates SET source_event_id = NULL WHERE source_event_id IS NOT NULL;

CREATE TABLE events_new (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('weekly_mission', 'guild_war', 'social', 'poll', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  capacity INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  signup_locked INTEGER NOT NULL DEFAULT 0,
  visible_at TEXT,
  archived_at TEXT,
  auto_archive INTEGER NOT NULL DEFAULT 0,
  auto_archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  recurrence_rule TEXT,
  attachments TEXT NOT NULL DEFAULT '[]',
  series_id TEXT,
  is_series_parent INTEGER NOT NULL DEFAULT 0,
  instance_date TEXT,
  last_generated_date TEXT,
  generation_count INTEGER NOT NULL DEFAULT 0,
  visibility_offset_minutes INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO events_new (
  id,
  type,
  title,
  description,
  start_at,
  end_at,
  capacity,
  pinned,
  signup_locked,
  visible_at,
  archived_at,
  auto_archive,
  auto_archived,
  created_by,
  updated_by,
  recurrence_rule,
  attachments,
  series_id,
  is_series_parent,
  instance_date,
  last_generated_date,
  generation_count,
  visibility_offset_minutes,
  created_at,
  updated_at
)
SELECT
  id,
  type,
  title,
  description,
  start_at,
  end_at,
  capacity,
  pinned,
  signup_locked,
  visible_at,
  archived_at,
  auto_archive,
  auto_archived,
  created_by,
  updated_by,
  recurrence_rule,
  attachments,
  series_id,
  is_series_parent,
  instance_date,
  last_generated_date,
  generation_count,
  visibility_offset_minutes,
  created_at,
  updated_at
FROM events;

DROP TABLE events;

ALTER TABLE events_new RENAME TO events;

CREATE INDEX IF NOT EXISTS idx_events_archived_series_start
  ON events(archived_at, is_series_parent, start_at, id);
CREATE INDEX IF NOT EXISTS idx_events_auto_archive_due
  ON events(auto_archive, auto_archived, archived_at, is_series_parent, end_at, start_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_series_instance
  ON events(series_id, instance_date);
CREATE INDEX IF NOT EXISTS idx_events_created_by
  ON events(created_by);

INSERT OR IGNORE INTO event_participants (id, event_id, user_id, joined_at)
SELECT id, event_id, user_id, joined_at
FROM event_participants_before_poll_type;

INSERT OR IGNORE INTO event_polls (event_id, results_visibility, show_voter_names, created_at, updated_at)
SELECT event_id, results_visibility, show_voter_names, created_at, updated_at
FROM event_polls_before_poll_type;

INSERT OR IGNORE INTO event_poll_options (id, event_id, label, sort_order, created_at)
SELECT id, event_id, label, sort_order, created_at
FROM event_poll_options_before_poll_type;

INSERT OR IGNORE INTO event_poll_votes (id, event_id, option_id, user_id, created_at)
SELECT id, event_id, option_id, user_id, created_at
FROM event_poll_votes_before_poll_type;

UPDATE war_history
SET event_id = (
  SELECT event_id
  FROM war_history_event_links_before_poll_type
  WHERE war_history_event_links_before_poll_type.id = war_history.id
)
WHERE id IN (SELECT id FROM war_history_event_links_before_poll_type);

UPDATE war_templates
SET source_event_id = (
  SELECT source_event_id
  FROM war_templates_event_links_before_poll_type
  WHERE war_templates_event_links_before_poll_type.id = war_templates.id
)
WHERE id IN (SELECT id FROM war_templates_event_links_before_poll_type);

PRAGMA foreign_keys=on;
