CREATE TABLE IF NOT EXISTS event_polls (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  results_visibility TEXT NOT NULL DEFAULT 'after_vote' CHECK (results_visibility IN ('always', 'after_vote', 'after_close')),
  show_voter_names INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS event_poll_options (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS event_poll_votes (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES event_poll_options(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(event_id, option_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_poll_options_event_sort
  ON event_poll_options(event_id, sort_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_event_poll_votes_event_option_user
  ON event_poll_votes(event_id, option_id, user_id);
CREATE INDEX IF NOT EXISTS idx_event_poll_votes_event_user
  ON event_poll_votes(event_id, user_id);
CREATE INDEX IF NOT EXISTS idx_event_poll_votes_option
  ON event_poll_votes(option_id);
