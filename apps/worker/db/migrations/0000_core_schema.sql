-- Infini Guild Management – Consolidated Schema
-- All tables, indexes, and constraints in a single file.

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level >= 1),
  color TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' REFERENCES roles(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS user_auth_password (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS member_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  power REAL NOT NULL DEFAULT 0 CHECK (power >= 0),
  classes TEXT NOT NULL DEFAULT '[]',
  title_html TEXT,
  bio TEXT,
  avatar_key TEXT,
  images TEXT NOT NULL DEFAULT '[]',
  audio_key TEXT,
  video_urls TEXT NOT NULL DEFAULT '[]',
  availability TEXT,
  vacation_start TEXT,
  vacation_end TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS member_profile_classes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class TEXT NOT NULL,
  PRIMARY KEY (user_id, class)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('weekly_mission', 'guild_war', 'social', 'poll', 'raffle', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  capacity INTEGER CHECK (capacity > 0),
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
  winner_count INTEGER CHECK (winner_count > 0),
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

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body_json TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  publish_at TEXT,
  expires_at TEXT,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS war_history (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT REFERENCES events(id),
  war_name TEXT NOT NULL,
  enemy_name TEXT,
  result TEXT CHECK (result IS NULL OR result IN ('win', 'loss', 'draw')),
  duration_minutes REAL CHECK (duration_minutes > 0),
  own_stats TEXT,
  enemy_stats TEXT,
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS war_teams (
  id TEXT PRIMARY KEY NOT NULL,
  war_history_id TEXT REFERENCES war_history(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0,
  CHECK (event_id IS NOT NULL OR war_history_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS war_team_members (
  id TEXT PRIMARY KEY NOT NULL,
  war_team_id TEXT NOT NULL REFERENCES war_teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  role_tag TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  stats TEXT,
  note TEXT,
  UNIQUE(war_team_id, user_id)
);

CREATE TABLE IF NOT EXISTS war_pool_members (
  id TEXT PRIMARY KEY NOT NULL,
  war_history_id TEXT REFERENCES war_history(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  UNIQUE(war_history_id, user_id),
  CHECK (event_id IS NOT NULL OR war_history_id IS NOT NULL)
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
  pinned INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ===== INDEXES =====

-- users
CREATE INDEX IF NOT EXISTS idx_users_deleted_active_created
  ON users(deleted_at, is_active, created_at, id);
CREATE INDEX IF NOT EXISTS idx_users_role_active
  ON users(role, is_active, deleted_at);

-- member profile classes
CREATE INDEX IF NOT EXISTS idx_member_profile_classes_class_user
  ON member_profile_classes(class, user_id);

-- roles
CREATE INDEX IF NOT EXISTS idx_roles_level
  ON roles(level, id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission
  ON role_permissions(permission);

-- sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user_expires
  ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at
  ON sessions(created_at);

-- events
CREATE INDEX IF NOT EXISTS idx_events_archived_series_start
  ON events(archived_at, is_series_parent, start_at, id);
CREATE INDEX IF NOT EXISTS idx_events_series_archived_start
  ON events(is_series_parent, archived_at, start_at, id);
CREATE INDEX IF NOT EXISTS idx_events_auto_archive_due
  ON events(auto_archive, auto_archived, archived_at, is_series_parent, end_at, start_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_series_instance
  ON events(series_id, instance_date);
CREATE INDEX IF NOT EXISTS idx_events_created_by
  ON events(created_by);

-- event_participants
CREATE UNIQUE INDEX IF NOT EXISTS ux_event_participants_event_user
  ON event_participants(event_id, user_id);
CREATE INDEX IF NOT EXISTS idx_event_participants_event_joined
  ON event_participants(event_id, joined_at, id);
CREATE INDEX IF NOT EXISTS idx_event_participants_user_event
  ON event_participants(user_id, event_id);

-- event polls
CREATE INDEX IF NOT EXISTS idx_event_poll_options_event_sort
  ON event_poll_options(event_id, sort_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_event_poll_votes_event_option_user
  ON event_poll_votes(event_id, option_id, user_id);
CREATE INDEX IF NOT EXISTS idx_event_poll_votes_event_user
  ON event_poll_votes(event_id, user_id);
CREATE INDEX IF NOT EXISTS idx_event_poll_votes_option
  ON event_poll_votes(option_id);

CREATE TABLE IF NOT EXISTS event_raffle_winners (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  drawn_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_raffle_winners_event
  ON event_raffle_winners(event_id);

-- announcements
CREATE INDEX IF NOT EXISTS idx_announcements_status_pinned_created
  ON announcements(status, pinned, created_at, id);
CREATE INDEX IF NOT EXISTS idx_announcements_schedule
  ON announcements(status, publish_at);
CREATE INDEX IF NOT EXISTS idx_announcements_expiry
  ON announcements(status, expires_at);

-- war_history
CREATE INDEX IF NOT EXISTS idx_war_history_event_id
  ON war_history(event_id);
CREATE INDEX IF NOT EXISTS idx_war_history_event_created
  ON war_history(event_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_war_history_created
  ON war_history(created_at, id);

-- war_teams
CREATE INDEX IF NOT EXISTS idx_war_teams_history_sort
  ON war_teams(war_history_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_war_teams_event_sort
  ON war_teams(event_id, sort_order, id);

-- war_team_members
CREATE UNIQUE INDEX IF NOT EXISTS ux_war_team_members_team_user
  ON war_team_members(war_team_id, user_id);
CREATE INDEX IF NOT EXISTS idx_war_team_members_team_sort
  ON war_team_members(war_team_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_war_team_members_user
  ON war_team_members(user_id);

-- war_pool_members
CREATE UNIQUE INDEX IF NOT EXISTS ux_war_pool_members_history_user
  ON war_pool_members(war_history_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_war_pool_members_event_user
  ON war_pool_members(event_id, user_id);
CREATE INDEX IF NOT EXISTS idx_war_pool_members_event
  ON war_pool_members(event_id);

-- wiki
CREATE INDEX IF NOT EXISTS idx_wiki_categories_parent_sort
  ON wiki_categories(parent_id, sort_order, name, id);
CREATE INDEX IF NOT EXISTS idx_wiki_categories_sort
  ON wiki_categories(sort_order, name, id);
CREATE INDEX IF NOT EXISTS idx_wiki_articles_category_archived_sort
  ON wiki_articles(category_id, archived_at, pinned, sort_order, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_wiki_articles_archived_updated
  ON wiki_articles(archived_at, pinned, updated_at, id);

-- gallery
CREATE INDEX IF NOT EXISTS idx_gallery_items_created
  ON gallery_items(created_at, id);
CREATE INDEX IF NOT EXISTS idx_gallery_items_uploaded_by
  ON gallery_items(uploaded_by, created_at, id);
CREATE INDEX IF NOT EXISTS idx_gallery_items_type_created
  ON gallery_items(type, created_at, id);

-- invite_links
CREATE INDEX IF NOT EXISTS idx_invite_links_created
  ON invite_links(created_at);
CREATE INDEX IF NOT EXISTS idx_invite_links_status
  ON invite_links(revoked_at, expires_at, created_at);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_actor_created
  ON audit_log(entity_type, actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_created
  ON audit_log(entity_type, created_at, id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id
  ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created
  ON audit_log(actor_id, created_at, id);

-- error_log (observability)
CREATE TABLE IF NOT EXISTS error_log (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL,
  request_path TEXT,
  request_method TEXT,
  request_id TEXT,
  stack TEXT,
  context TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_error_log_created_at ON error_log(created_at);
CREATE INDEX IF NOT EXISTS idx_error_log_source ON error_log(source);

-- member_badges
CREATE TABLE IF NOT EXISTS member_badges (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  label_html TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_member_badges_sort
  ON member_badges(sort_order, id);

CREATE TABLE IF NOT EXISTS member_badge_assignments (
  badge_id TEXT NOT NULL REFERENCES member_badges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_member_badge_assignments_badge_user
  ON member_badge_assignments(badge_id, user_id);
CREATE INDEX IF NOT EXISTS idx_member_badge_assignments_user
  ON member_badge_assignments(user_id);

-- ===== ROLE BASELINE DATA =====

INSERT OR IGNORE INTO roles (id, name, level, color, is_builtin) VALUES
  ('admin', 'Admin', 999, 'red', 1),
  ('moderator', 'Moderator', 500, 'blue', 1),
  ('member', 'Member', 100, 'gray', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission, granted) VALUES
  -- admin (full access)
  ('admin', 'admin.users.view', 1),
  ('admin', 'admin.users.edit', 1),
  ('admin', 'admin.users.role', 1),
  ('admin', 'admin.users.activate', 1),
  ('admin', 'admin.users.delete', 1),
  ('admin', 'admin.users.password', 1),
  ('admin', 'admin.invite.view', 1),
  ('admin', 'admin.invite.manage', 1),
  ('admin', 'admin.audit.view', 1),
  ('admin', 'admin.audit.export', 1),
  ('admin', 'admin.status.view', 1),
  ('admin', 'admin.roles.view', 1),
  ('admin', 'admin.roles.manage', 1),
  ('admin', 'admin.analytics.view', 1),
  ('admin', 'admin.analytics.manage', 1),
  ('admin', 'guildwar.teams.edit', 1),

  ('admin', 'guildwar.history.edit', 1),
  ('admin', 'events.create', 1),
  ('admin', 'events.edit', 1),
  ('admin', 'events.archive', 1),
  ('admin', 'events.delete', 1),
  ('admin', 'events.templates', 1),
  ('admin', 'announcements.create', 1),
  ('admin', 'announcements.edit', 1),
  ('admin', 'announcements.archive', 1),
  ('admin', 'announcements.delete', 1),
  ('admin', 'gallery.upload', 1),
  ('admin', 'gallery.manage', 1),
  ('admin', 'gallery.delete', 1),
  ('admin', 'wiki.articles.create', 1),
  ('admin', 'wiki.articles.edit', 1),
  ('admin', 'wiki.articles.archive', 1),
  ('admin', 'wiki.articles.delete', 1),
  ('admin', 'wiki.categories.manage', 1),
  ('admin', 'admin.badges.manage', 1),
  -- moderator (limited access)
  ('moderator', 'admin.users.view', 1),
  ('moderator', 'admin.users.edit', 1),
  ('moderator', 'admin.users.role', 0),
  ('moderator', 'admin.users.activate', 0),
  ('moderator', 'admin.users.delete', 0),
  ('moderator', 'admin.users.password', 0),
  ('moderator', 'admin.invite.view', 1),
  ('moderator', 'admin.invite.manage', 0),
  ('moderator', 'admin.audit.view', 1),
  ('moderator', 'admin.audit.export', 0),
  ('moderator', 'admin.status.view', 1),
  ('moderator', 'admin.roles.view', 1),
  ('moderator', 'admin.roles.manage', 0),
  ('moderator', 'admin.analytics.view', 1),
  ('moderator', 'admin.analytics.manage', 0),
  ('moderator', 'guildwar.teams.edit', 1),

  ('moderator', 'guildwar.history.edit', 1),
  ('moderator', 'events.create', 1),
  ('moderator', 'events.edit', 1),
  ('moderator', 'events.archive', 1),
  ('moderator', 'events.delete', 1),
  ('moderator', 'events.templates', 1),
  ('moderator', 'announcements.create', 1),
  ('moderator', 'announcements.edit', 1),
  ('moderator', 'announcements.archive', 1),
  ('moderator', 'announcements.delete', 1),
  ('moderator', 'gallery.upload', 1),
  ('moderator', 'gallery.manage', 1),
  ('moderator', 'gallery.delete', 1),
  ('moderator', 'wiki.articles.create', 1),
  ('moderator', 'wiki.articles.edit', 1),
  ('moderator', 'wiki.articles.archive', 1),
  ('moderator', 'wiki.articles.delete', 1),
  ('moderator', 'wiki.categories.manage', 1),
  ('moderator', 'admin.badges.manage', 0),
  -- member (minimal access)
  ('member', 'admin.users.view', 0),
  ('member', 'admin.users.edit', 0),
  ('member', 'admin.users.role', 0),
  ('member', 'admin.users.activate', 0),
  ('member', 'admin.users.delete', 0),
  ('member', 'admin.users.password', 0),
  ('member', 'admin.invite.view', 0),
  ('member', 'admin.invite.manage', 0),
  ('member', 'admin.audit.view', 0),
  ('member', 'admin.audit.export', 0),
  ('member', 'admin.status.view', 0),
  ('member', 'admin.roles.view', 0),
  ('member', 'admin.roles.manage', 0),
  ('member', 'admin.analytics.view', 0),
  ('member', 'admin.analytics.manage', 0),
  ('member', 'guildwar.teams.edit', 0),

  ('member', 'guildwar.history.edit', 0),
  ('member', 'events.create', 0),
  ('member', 'events.edit', 0),
  ('member', 'events.archive', 0),
  ('member', 'events.delete', 0),
  ('member', 'events.templates', 0),
  ('member', 'announcements.create', 0),
  ('member', 'announcements.edit', 0),
  ('member', 'announcements.archive', 0),
  ('member', 'announcements.delete', 0),
  ('member', 'gallery.upload', 1),
  ('member', 'gallery.manage', 0),
  ('member', 'gallery.delete', 0),
  ('member', 'wiki.articles.create', 0),
  ('member', 'wiki.articles.edit', 0),
  ('member', 'wiki.articles.archive', 0),
  ('member', 'wiki.articles.delete', 0),
  ('member', 'wiki.categories.manage', 0),
  ('member', 'admin.badges.manage', 0);
