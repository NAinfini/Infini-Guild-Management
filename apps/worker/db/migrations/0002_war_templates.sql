CREATE TABLE IF NOT EXISTS war_templates (
  id TEXT PRIMARY KEY NOT NULL,
  template_name TEXT NOT NULL,
  description TEXT,
  source_event_id TEXT REFERENCES events(id),
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_war_templates_source_event ON war_templates(source_event_id);
CREATE INDEX IF NOT EXISTS idx_war_templates_updated_at ON war_templates(updated_at DESC);
