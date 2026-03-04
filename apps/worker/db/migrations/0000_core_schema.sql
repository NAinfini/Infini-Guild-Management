CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'moderator', 'member')),
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS user_auth_password (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS member_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  wechat_name TEXT,
  power INTEGER NOT NULL DEFAULT 0 CHECK (power >= 0),
  classes TEXT NOT NULL DEFAULT '[]',
  title_html TEXT,
  bio TEXT,
  images TEXT NOT NULL DEFAULT '[]',
  audio_key TEXT,
  video_urls TEXT NOT NULL DEFAULT '[]',
  availability TEXT,
  vacation_start TEXT,
  vacation_end TEXT,
  discord_id TEXT UNIQUE,
  discord_reminder_opt_out INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('weekly_mission', 'guild_war', 'social', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  capacity INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  signup_locked INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  recurrence_rule TEXT,
  attachments TEXT NOT NULL DEFAULT '[]',
  series_id TEXT,
  is_series_parent INTEGER NOT NULL DEFAULT 0,
  instance_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS event_participants (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(event_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body_json TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  publish_at TEXT,
  expires_at TEXT,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS war_history (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT REFERENCES events(id),
  war_name TEXT NOT NULL,
  result TEXT CHECK (result IS NULL OR result IN ('win', 'loss', 'draw')),
  own_kills INTEGER,
  own_towers INTEGER,
  own_base_hp INTEGER,
  own_credits INTEGER,
  own_distance INTEGER,
  enemy_kills INTEGER,
  enemy_towers INTEGER,
  enemy_base_hp INTEGER,
  enemy_credits INTEGER,
  enemy_distance INTEGER,
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS war_teams (
  id TEXT PRIMARY KEY NOT NULL,
  war_history_id TEXT NOT NULL REFERENCES war_history(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS war_team_members (
  id TEXT PRIMARY KEY NOT NULL,
  war_team_id TEXT NOT NULL REFERENCES war_teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  role_tag TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  damage INTEGER,
  healing INTEGER,
  building_damage INTEGER,
  credits INTEGER,
  damage_taken INTEGER,
  note TEXT,
  UNIQUE(war_team_id, user_id)
);

CREATE TABLE IF NOT EXISTS war_pool_members (
  id TEXT PRIMARY KEY NOT NULL,
  war_history_id TEXT NOT NULL REFERENCES war_history(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  UNIQUE(war_history_id, user_id)
);

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

CREATE TABLE IF NOT EXISTS wiki_categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS wiki_articles (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES wiki_categories(id),
  body_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS wiki_article_versions (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES wiki_articles(id),
  version_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES wiki_categories(id),
  body_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  source_action TEXT NOT NULL DEFAULT 'update',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(article_id, version_no)
);

CREATE TABLE IF NOT EXISTS gallery_items (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('image', 'video')),
  url TEXT NOT NULL,
  caption TEXT,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS invite_links (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  max_uses INTEGER NOT NULL CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  entity_id TEXT NOT NULL,
  diff_title TEXT,
  detail_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS discord_link_codes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  discord_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (length(code) = 6 AND code NOT GLOB '*[^0-9]*'),
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS bot_delivery_log (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'wechat')),
  task_type TEXT NOT NULL CHECK (task_type IN ('event_notify', 'team_comp', 'reminder', 'war_result')),
  event_id TEXT REFERENCES events(id),
  target_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  message_id TEXT
);

CREATE TABLE IF NOT EXISTS bot_discord_event_messages (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(event_id, channel_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_deleted_active_created
  ON users(deleted_at, is_active, created_at, id);
CREATE INDEX IF NOT EXISTS idx_users_role_active
  ON users(role, is_active, deleted_at);

CREATE INDEX IF NOT EXISTS idx_sessions_user_expires
  ON sessions(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_events_archived_start_id
  ON events(archived_at, start_at, id);
CREATE INDEX IF NOT EXISTS idx_events_series_start_id
  ON events(series_id, start_at, id);
CREATE INDEX IF NOT EXISTS idx_events_created_by
  ON events(created_by);

CREATE INDEX IF NOT EXISTS idx_event_participants_event_joined
  ON event_participants(event_id, joined_at, id);
CREATE INDEX IF NOT EXISTS idx_event_participants_user_event
  ON event_participants(user_id, event_id);

CREATE INDEX IF NOT EXISTS idx_announcements_feed
  ON announcements(archived_at, pinned, pinned_at, created_at, id);
CREATE INDEX IF NOT EXISTS idx_announcements_schedule
  ON announcements(status, publish_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_war_history_event_id
  ON war_history(event_id);
CREATE INDEX IF NOT EXISTS idx_war_history_created
  ON war_history(created_at, id);
CREATE INDEX IF NOT EXISTS idx_war_teams_history_id
  ON war_teams(war_history_id);
CREATE INDEX IF NOT EXISTS idx_war_teams_history_sort
  ON war_teams(war_history_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_war_team_members_team_id
  ON war_team_members(war_team_id);
CREATE INDEX IF NOT EXISTS idx_war_team_members_team_sort
  ON war_team_members(war_team_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_war_team_members_user
  ON war_team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_war_pool_members_history_id
  ON war_pool_members(war_history_id);

CREATE INDEX IF NOT EXISTS idx_war_templates_source_event
  ON war_templates(source_event_id);
CREATE INDEX IF NOT EXISTS idx_war_templates_updated_at
  ON war_templates(updated_at);

CREATE INDEX IF NOT EXISTS idx_wiki_categories_parent_sort
  ON wiki_categories(parent_id, sort_order, name, id);
CREATE INDEX IF NOT EXISTS idx_wiki_articles_category_archived_sort
  ON wiki_articles(category_id, archived_at, sort_order, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_wiki_articles_archived_updated
  ON wiki_articles(archived_at, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_wiki_article_versions_article_id
  ON wiki_article_versions(article_id);
CREATE INDEX IF NOT EXISTS idx_wiki_article_versions_created_at
  ON wiki_article_versions(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wiki_article_versions_article_version
  ON wiki_article_versions(article_id, version_no);

CREATE INDEX IF NOT EXISTS idx_gallery_items_created
  ON gallery_items(created_at, id);
CREATE INDEX IF NOT EXISTS idx_gallery_items_uploaded_by
  ON gallery_items(uploaded_by, created_at, id);

CREATE INDEX IF NOT EXISTS idx_invite_links_created
  ON invite_links(created_at);
CREATE INDEX IF NOT EXISTS idx_invite_links_status
  ON invite_links(revoked_at, expires_at, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type
  ON audit_log(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id
  ON audit_log(actor_id);

CREATE INDEX IF NOT EXISTS idx_discord_link_codes_user_lookup
  ON discord_link_codes(user_id, code, used, expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_discord_link_codes_discord_lookup
  ON discord_link_codes(discord_id, used, expires_at, created_at);

CREATE INDEX IF NOT EXISTS idx_bot_delivery_status_next_attempt
  ON bot_delivery_log(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_bot_delivery_event_platform_task
  ON bot_delivery_log(event_id, platform, task_type, status);
