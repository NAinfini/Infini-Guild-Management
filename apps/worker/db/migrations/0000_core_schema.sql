-- Infini Guild Management pre-release core schema.
-- Fresh databases apply this file once; Drizzle modules mirror its runtime contract.

CREATE TABLE roles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level >= 1),
  color TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (role_id, permission)
);

-- Usernames are case-insensitive identifiers. Drizzle cannot declare SQLite
-- column collations, so the physical invariant is completed here.
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  -- COLLATE NOCASE: usernames are case-insensitive identifiers. Without it
  -- SQLite lets "Admin" and "admin" coexist as two accounts. Drizzle's sqlite
  -- column builder cannot express a collation, so this file is the only place
  -- it is declared — see services/helpers.ts#usernameEquals for the query side.
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' REFERENCES roles(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE user_auth_password (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE class_catalog (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL CONSTRAINT class_catalog_color_hex CHECK (
    length(color) = 7
    AND substr(color, 1, 1) = '#'
    AND substr(color, 2) NOT GLOB '*[^0-9A-Fa-f]*'
  ),
  icon_type TEXT NOT NULL DEFAULT 'vector'
    CONSTRAINT class_catalog_icon_type_valid CHECK (icon_type IN ('vector', 'image')),
  vector_icon TEXT NOT NULL,
  icon_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
    CONSTRAINT class_catalog_sort_order_nonnegative CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT class_catalog_icon_key_consistent CHECK (
    (icon_type = 'vector' AND icon_key IS NULL) OR
    (icon_type = 'image' AND icon_key IS NOT NULL)
  )
);

CREATE TABLE gallery_items (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('image', 'video')),
  url TEXT NOT NULL,
  caption TEXT,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE invite_links (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  max_uses INTEGER NOT NULL CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  entity_id TEXT NOT NULL,
  diff_title TEXT,
  detail_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Lockouts use the attempted username rather than a user foreign key so unknown and
-- registered names follow the same path. NOCASE matches the users identifier.
CREATE TABLE login_failures (
  username TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_failed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE error_log (
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

CREATE TABLE member_badges (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  label_html TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE member_badge_assignments (
  badge_id TEXT NOT NULL REFERENCES member_badges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Content cleanup consults exact entity-owned references; audit archives are
-- outside this ownership graph and must never be swept through it.
CREATE TABLE media_references (
  media_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (media_key, entity_type, entity_id)
);

-- Admin system-test cleanup is scoped by server-issued run IDs and exact
-- artifact locators; production content is never discovered by marker text.
CREATE TABLE system_test_runs (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'running',
  active_requests INTEGER NOT NULL DEFAULT 0,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  CONSTRAINT system_test_runs_status_valid CHECK (status IN ('running', 'cleaning', 'cleanup_failed', 'completed', 'manual_review')),
  CONSTRAINT system_test_runs_active_requests_nonnegative CHECK (active_requests >= 0)
);

CREATE TABLE system_test_artifacts (
  run_id TEXT NOT NULL REFERENCES system_test_runs(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  artifact_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (run_id, artifact_type, artifact_key)
);

CREATE TABLE storages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE storage_categories (
  id TEXT PRIMARY KEY,
  storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE storage_items (
  id TEXT PRIMARY KEY,
  storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES storage_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  allow_member_deposit INTEGER NOT NULL DEFAULT 0,
  allow_member_withdraw INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT storage_items_quantity_nonnegative CHECK (quantity >= 0)
);

CREATE TABLE storage_item_images (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES storage_items(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE class_tags (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
    CONSTRAINT class_tags_sort_order_nonnegative CHECK (sort_order >= 0),
  owner_kind TEXT,
  owner_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT class_tags_owner_consistent CHECK (
    (owner_kind IS NULL AND owner_id IS NULL) OR
    (owner_kind IN ('event', 'recurring_template') AND owner_id IS NOT NULL)
  )
);

CREATE TABLE class_tag_members (
  tag_id TEXT NOT NULL REFERENCES class_tags(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES class_catalog(id) ON DELETE CASCADE,
  PRIMARY KEY (tag_id, class_id)
);

CREATE TABLE "member_profiles" (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  power REAL NOT NULL DEFAULT 0 CONSTRAINT member_profiles_power_nonnegative CHECK (power >= 0),
  title_html TEXT,
  bio TEXT,
  avatar_key TEXT,
  audio_key TEXT,
  video_urls TEXT NOT NULL DEFAULT '[]'
    CONSTRAINT member_profiles_video_urls_json_array CHECK (json_valid(video_urls) AND json_type(video_urls) = 'array'),
  availability TEXT
    CONSTRAINT member_profiles_availability_json_object CHECK (availability IS NULL OR (json_valid(availability) AND json_type(availability) = 'object')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "member_profile_classes" (
  user_id TEXT NOT NULL REFERENCES "member_profiles"(user_id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES class_catalog(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CONSTRAINT member_profile_classes_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (user_id, class_id),
  UNIQUE (user_id, sort_order)
);

CREATE TABLE "member_profile_images" (
  user_id TEXT NOT NULL REFERENCES "member_profiles"(user_id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL CONSTRAINT member_profile_images_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (user_id, media_key),
  UNIQUE (user_id, sort_order)
);

CREATE TABLE "member_absences" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT member_absences_date_range_valid CHECK (start_date <= end_date)
);

CREATE TABLE "events" (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CONSTRAINT events_type_valid CHECK (type IN ('weekly_mission', 'guild_war', 'social', 'poll', 'raffle', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  capacity INTEGER CONSTRAINT events_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  pinned INTEGER NOT NULL DEFAULT 0,
  signup_locked INTEGER NOT NULL DEFAULT 0,
  visible_at TEXT,
  archived_at TEXT,
  auto_archive INTEGER NOT NULL DEFAULT 0,
  auto_archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  series_id TEXT,
  instance_date TEXT,
  winner_count INTEGER CONSTRAINT events_winner_count_positive CHECK (winner_count IS NULL OR winner_count > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "recurring_templates" (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CONSTRAINT recurring_templates_type_valid CHECK (type IN ('weekly_mission', 'guild_war', 'social', 'poll', 'raffle', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL,
  duration_minutes INTEGER,
  capacity INTEGER CONSTRAINT recurring_templates_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  recurrence_rule TEXT NOT NULL
    CONSTRAINT recurring_templates_recurrence_rule_json_object CHECK (json_valid(recurrence_rule) AND json_type(recurrence_rule) = 'object'),
  visibility_offset_minutes INTEGER NOT NULL DEFAULT 0,
  auto_archive INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  last_generated_date TEXT,
  generation_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "event_participants" (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES "events"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "event_polls" (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES "events"(id) ON DELETE CASCADE,
  results_visibility TEXT NOT NULL DEFAULT 'after_vote' CHECK (results_visibility IN ('always', 'after_vote', 'after_close')),
  show_voter_names INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "event_poll_options" (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES "events"(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "event_poll_votes" (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES "events"(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES "event_poll_options"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT fk_event_poll_votes_event_option
    FOREIGN KEY (event_id, option_id) REFERENCES "event_poll_options"(event_id, id) ON DELETE CASCADE
);

CREATE TABLE "event_raffle_winners" (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES "events"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drawn_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "war_history" (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT REFERENCES "events"(id),
  war_name TEXT NOT NULL,
  enemy_name TEXT,
  result TEXT CONSTRAINT war_history_result_valid CHECK (result IS NULL OR result IN ('win', 'loss', 'draw')),
  duration_minutes REAL CONSTRAINT war_history_duration_positive CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  own_stats TEXT CONSTRAINT war_history_own_stats_json_object CHECK (own_stats IS NULL OR (json_valid(own_stats) AND json_type(own_stats) = 'object')),
  enemy_stats TEXT CONSTRAINT war_history_enemy_stats_json_object CHECK (enemy_stats IS NULL OR (json_valid(enemy_stats) AND json_type(enemy_stats) = 'object')),
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "war_teams" (
  id TEXT PRIMARY KEY NOT NULL,
  war_history_id TEXT REFERENCES "war_history"(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES "events"(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT war_teams_exactly_one_parent CHECK ((event_id IS NULL) <> (war_history_id IS NULL))
);

CREATE TABLE "war_team_members" (
  id TEXT PRIMARY KEY NOT NULL,
  war_team_id TEXT NOT NULL REFERENCES "war_teams"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_tag TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  stats TEXT CONSTRAINT war_team_members_stats_json_object CHECK (stats IS NULL OR (json_valid(stats) AND json_type(stats) = 'object')),
  note TEXT
);

CREATE TABLE "war_pool_members" (
  id TEXT PRIMARY KEY NOT NULL,
  war_history_id TEXT REFERENCES "war_history"(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES "events"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT war_pool_members_exactly_one_parent CHECK ((event_id IS NULL) <> (war_history_id IS NULL))
);

CREATE TABLE event_attachments (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL CONSTRAINT event_attachments_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (event_id, media_key)
);

CREATE TABLE recurring_template_attachments (
  template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL CONSTRAINT recurring_template_attachments_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (template_id, media_key)
);

CREATE TABLE event_class_quotas (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES class_tags(id) ON DELETE CASCADE,
  required INTEGER NOT NULL CONSTRAINT event_class_quotas_required_positive CHECK (required > 0),
  PRIMARY KEY (event_id, tag_id)
);

CREATE TABLE recurring_template_class_quotas (
  template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES class_tags(id) ON DELETE CASCADE,
  required INTEGER NOT NULL CONSTRAINT recurring_template_class_quotas_required_positive CHECK (required > 0),
  PRIMARY KEY (template_id, tag_id)
);

CREATE TABLE "announcements" (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body_json TEXT NOT NULL
    CONSTRAINT announcements_body_json_object CHECK (json_valid(body_json) AND json_type(body_json) = 'object'),
  pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CONSTRAINT announcements_status_valid CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  publish_at TEXT,
  expires_at TEXT,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "wiki_categories" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT REFERENCES "wiki_categories"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "wiki_articles" (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES "wiki_categories"(id),
  body_json TEXT NOT NULL
    CONSTRAINT wiki_articles_body_json_object CHECK (json_valid(body_json) AND json_type(body_json) = 'object'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "wiki_revisions" (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES "wiki_articles"(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  body_json TEXT NOT NULL
    CONSTRAINT wiki_revisions_body_json_object CHECK (json_valid(body_json) AND json_type(body_json) = 'object'),
  edited_by TEXT NOT NULL REFERENCES users(id),
  restored_from INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "site_config" (
  id TEXT PRIMARY KEY NOT NULL,
  site_name TEXT NOT NULL,
  site_logo_url TEXT NOT NULL,
  feature_flags_json TEXT NOT NULL CONSTRAINT site_config_feature_flags_json_object CHECK (json_valid(feature_flags_json) AND json_type(feature_flags_json) = 'object'),
  media_policy_json TEXT NOT NULL CONSTRAINT site_config_media_policy_json_object CHECK (json_valid(media_policy_json) AND json_type(media_policy_json) = 'object'),
  storage_policy_json TEXT NOT NULL CONSTRAINT site_config_storage_policy_json_object CHECK (json_valid(storage_policy_json) AND json_type(storage_policy_json) = 'object'),
  absence_policy_json TEXT NOT NULL CONSTRAINT site_config_absence_policy_json_object CHECK (json_valid(absence_policy_json) AND json_type(absence_policy_json) = 'object'),
  analytics_settings_json TEXT NOT NULL CONSTRAINT site_config_analytics_settings_json_object CHECK (json_valid(analytics_settings_json) AND json_type(analytics_settings_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Quantity updates and ledger inserts share one D1 batch. RESTRICT preserves
-- the ledger when an item still has transaction history.
CREATE TABLE "storage_transactions" (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES storage_items(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CONSTRAINT storage_transactions_type_valid CHECK (type IN ('intake', 'distribute', 'adjust')),
  quantity_delta INTEGER NOT NULL,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE media_reference_backfills (
  domain TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE media_upload_leases (
  media_key TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_users_deleted_active_created
  ON users(deleted_at, is_active, created_at, id);

CREATE INDEX idx_users_role_active
  ON users(role, is_active, deleted_at);

CREATE INDEX idx_class_catalog_sort
  ON class_catalog(sort_order, id);

CREATE UNIQUE INDEX ux_class_catalog_label_nocase
  ON class_catalog(label COLLATE NOCASE);

CREATE INDEX idx_roles_level
  ON roles(level, id);

CREATE INDEX idx_role_permissions_permission
  ON role_permissions(permission);

CREATE INDEX idx_sessions_user_expires
  ON sessions(user_id, expires_at);

CREATE INDEX idx_sessions_expires_at
  ON sessions(expires_at);

CREATE INDEX idx_sessions_created_at
  ON sessions(created_at);

CREATE INDEX idx_login_failures_last_failed_at
  ON login_failures(last_failed_at);

CREATE INDEX idx_gallery_items_created
  ON gallery_items(created_at, id);

CREATE INDEX idx_gallery_items_uploaded_by
  ON gallery_items(uploaded_by, created_at, id);

CREATE INDEX idx_gallery_items_type_created
  ON gallery_items(type, created_at, id);

CREATE INDEX idx_invite_links_created
  ON invite_links(created_at, id);

CREATE INDEX idx_invite_links_status
  ON invite_links(revoked_at, expires_at, created_at);

CREATE INDEX idx_member_badges_sort
  ON member_badges(sort_order, id);

CREATE UNIQUE INDEX ux_member_badge_assignments_badge_user
  ON member_badge_assignments(badge_id, user_id);

CREATE INDEX idx_member_badge_assignments_user
  ON member_badge_assignments(user_id);

CREATE INDEX idx_media_references_key ON media_references(media_key);

CREATE INDEX idx_media_references_entity ON media_references(entity_type, entity_id);

CREATE INDEX idx_system_test_runs_cleanup_lookup
  ON system_test_runs(status, updated_at, id);

CREATE INDEX idx_system_test_artifacts_run_type
  ON system_test_artifacts(run_id, artifact_type);

CREATE INDEX idx_storage_categories_storage ON storage_categories(storage_id);

CREATE INDEX idx_storage_items_storage_name_id ON storage_items(storage_id, name, id);

CREATE INDEX idx_storage_items_storage_category_name_id ON storage_items(storage_id, category_id, name, id);

CREATE UNIQUE INDEX ux_class_tags_label_nocase
  ON class_tags (label COLLATE NOCASE) WHERE owner_kind IS NULL;

CREATE INDEX idx_class_tags_sort ON class_tags (sort_order, id);

CREATE INDEX idx_class_tags_owner ON class_tags (owner_kind, owner_id);

CREATE INDEX idx_class_tag_members_class ON class_tag_members (class_id);

CREATE INDEX idx_member_profile_classes_class_user
  ON member_profile_classes(class_id, user_id);

CREATE UNIQUE INDEX ux_member_profile_classes_user_sort
  ON member_profile_classes(user_id, sort_order);

CREATE INDEX idx_member_profile_images_media_user
  ON member_profile_images(media_key, user_id);

CREATE UNIQUE INDEX ux_member_profile_images_user_sort
  ON member_profile_images(user_id, sort_order);

CREATE INDEX idx_member_absences_user_end ON member_absences(user_id, end_date);

CREATE INDEX idx_member_absences_end_start ON member_absences(end_date, start_date);

CREATE INDEX idx_event_attachments_media_event ON event_attachments(media_key, event_id);

CREATE UNIQUE INDEX ux_event_attachments_event_sort ON event_attachments(event_id, sort_order);

CREATE INDEX idx_recurring_template_attachments_media_template ON recurring_template_attachments(media_key, template_id);

CREATE UNIQUE INDEX ux_recurring_template_attachments_template_sort ON recurring_template_attachments(template_id, sort_order);

CREATE INDEX idx_events_archived_start ON events(archived_at, start_at, id);

CREATE INDEX idx_events_auto_archive_due ON events(auto_archive, auto_archived, archived_at, end_at, start_at);

CREATE UNIQUE INDEX ux_events_series_instance ON events(series_id, instance_date);

CREATE INDEX idx_events_created_by ON events(created_by);

CREATE INDEX idx_recurring_templates_active ON recurring_templates(paused, created_at, id);

CREATE INDEX idx_event_class_quotas_tag ON event_class_quotas(tag_id);

CREATE INDEX idx_recurring_template_class_quotas_tag ON recurring_template_class_quotas(tag_id);

CREATE UNIQUE INDEX ux_event_participants_event_user ON event_participants(event_id, user_id);

CREATE INDEX idx_event_participants_event_joined ON event_participants(event_id, joined_at, id);

CREATE INDEX idx_event_participants_user_event ON event_participants(user_id, event_id);

CREATE INDEX idx_event_poll_options_event_sort ON event_poll_options(event_id, sort_order, id);

CREATE UNIQUE INDEX ux_event_poll_options_event_id ON event_poll_options(event_id, id);

CREATE UNIQUE INDEX ux_event_poll_votes_event_option_user ON event_poll_votes(event_id, option_id, user_id);

CREATE INDEX idx_event_poll_votes_event_user ON event_poll_votes(event_id, user_id);

CREATE INDEX idx_event_poll_votes_option ON event_poll_votes(option_id);

CREATE UNIQUE INDEX ux_event_raffle_winners_event_user ON event_raffle_winners(event_id, user_id);

CREATE INDEX idx_event_raffle_winners_event ON event_raffle_winners(event_id);

CREATE UNIQUE INDEX ux_war_history_event_id ON war_history(event_id);

CREATE INDEX idx_war_history_created ON war_history(created_at, id);

CREATE INDEX idx_war_teams_history_sort ON war_teams(war_history_id, sort_order, id);

CREATE INDEX idx_war_teams_event_sort ON war_teams(event_id, sort_order, id);

CREATE UNIQUE INDEX ux_war_team_members_team_user ON war_team_members(war_team_id, user_id);

CREATE INDEX idx_war_team_members_team_sort ON war_team_members(war_team_id, sort_order, id);

CREATE INDEX idx_war_team_members_user ON war_team_members(user_id);

CREATE UNIQUE INDEX ux_war_pool_members_history_user ON war_pool_members(war_history_id, user_id);

CREATE UNIQUE INDEX ux_war_pool_members_event_user ON war_pool_members(event_id, user_id);

CREATE INDEX idx_war_pool_members_event ON war_pool_members(event_id);

CREATE INDEX idx_announcements_status_pinned_created ON announcements(status, pinned, created_at, id);

CREATE INDEX idx_announcements_schedule ON announcements(status, publish_at);

CREATE INDEX idx_announcements_expiry ON announcements(status, expires_at);

CREATE INDEX idx_wiki_categories_parent_sort ON wiki_categories(parent_id, sort_order, name, id);

CREATE INDEX idx_wiki_categories_sort ON wiki_categories(sort_order, name, id);

CREATE INDEX idx_wiki_articles_category_archived_sort ON wiki_articles(category_id, archived_at, pinned, sort_order, updated_at, id);

CREATE INDEX idx_wiki_articles_archived_updated ON wiki_articles(archived_at, pinned, updated_at, id);

CREATE UNIQUE INDEX uq_wiki_revisions_article_revision ON wiki_revisions(article_id, revision);

CREATE INDEX idx_storage_item_images_item ON storage_item_images(item_id, created_at, id);

CREATE INDEX idx_storage_transactions_item ON storage_transactions(item_id, created_at, id);

CREATE INDEX idx_storage_transactions_recipient ON storage_transactions(recipient_user_id, created_at, id) WHERE recipient_user_id IS NOT NULL;

CREATE INDEX idx_storage_transactions_created ON storage_transactions(created_at, id);

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at, id);

CREATE INDEX idx_audit_log_entity_actor_created ON audit_log(entity_type, actor_id, created_at, id);

CREATE INDEX idx_audit_log_entity_created ON audit_log(entity_type, created_at, id);

CREATE INDEX idx_audit_log_actor_created ON audit_log(actor_id, created_at, id);

CREATE INDEX idx_error_log_created_at ON error_log(created_at, id);

CREATE INDEX idx_error_log_source_created ON error_log(source, created_at, id);

CREATE INDEX idx_media_upload_leases_expiry ON media_upload_leases(expires_at, media_key);

-- Built-in records required before the application seed runs.

INSERT OR IGNORE INTO roles (id, name, level, color, is_builtin) VALUES
  ('admin', 'Admin', 999, 'red', 1),
  ('moderator', 'Moderator', 500, '#756047', 1),
  ('member', 'Member', 100, 'gray', 1);

INSERT OR IGNORE INTO site_config (
  id,
  site_name,
  site_logo_url,
  feature_flags_json,
  media_policy_json,
  storage_policy_json,
  absence_policy_json,
  analytics_settings_json
) VALUES
  (
    'default',
    'Infini 公会',
    '/guild-logo.webp',
    '{"announcements":true,"events":true,"guildWar":true,"gallery":true,"wiki":true,"tools":true,"storage":true}',
    '{"max_file_size_bytes":{"site_logo":2097152,"profile_image":5242880,"profile_audio":20971520,"announcement_image":5242880,"wiki_image":5242880,"event_image":5242880,"gallery_image":10485760,"storage_image":5242880},"quotas":{"profile":10,"announcement":10,"gallery":20,"wiki":10}}',
    '{"images_per_item":5}',
    '{"max_span_days":366,"max_entries_per_user":20}',
    '{"reference_duration_minutes":30,"modifier_weights":{"kills":0.3,"towers":0.1,"credits":0.3,"distance":0.15,"base_hp":0.15}}'
  );

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
  ('admin', 'admin.siteConfig.manage', 1),
  ('admin', 'admin.classes.manage', 1),
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
  ('admin', 'admin.storage.structure', 1),
  ('admin', 'admin.storage.items', 1),
  ('admin', 'admin.storage.stock', 1),
  ('admin', 'admin.storage.manage', 1),
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
  ('moderator', 'admin.siteConfig.manage', 0),
  ('moderator', 'admin.classes.manage', 0),
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
  ('moderator', 'admin.storage.structure', 0),
  ('moderator', 'admin.storage.items', 0),
  ('moderator', 'admin.storage.stock', 0),
  ('moderator', 'admin.storage.manage', 0),
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
  ('member', 'admin.siteConfig.manage', 0),
  ('member', 'admin.classes.manage', 0),
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
  ('member', 'admin.badges.manage', 0),
  ('member', 'admin.storage.structure', 0),
  ('member', 'admin.storage.items', 0),
  ('member', 'admin.storage.stock', 0),
  ('member', 'admin.storage.manage', 0);

INSERT OR IGNORE INTO class_catalog
  (id, label, color, icon_type, vector_icon, icon_key, sort_order)
VALUES
  ('鸣金虹', '鸣金虹', '#6EA8FE', 'vector', 'sword', NULL, 0),
  ('鸣金影', '鸣金影', '#79A7F2', 'vector', 'target-arrow', NULL, 10),
  ('牵丝玉', '牵丝玉', '#58C7A6', 'vector', 'sparkles', NULL, 20),
  ('牵丝霖', '牵丝霖', '#54C39B', 'vector', 'heartbeat', NULL, 30),
  ('牵丝翊', '牵丝翊', '#62BEA7', 'vector', 'pendant', NULL, 40),
  ('破竹风', '破竹风', '#A78BFA', 'vector', 'bolt', NULL, 50),
  ('破竹尘', '破竹尘', '#9B8AE8', 'vector', 'shield', NULL, 60),
  ('破竹鸢', '破竹鸢', '#B18CF1', 'vector', 'target', NULL, 70),
  ('裂石威', '裂石威', '#E27676', 'vector', 'shield', NULL, 80),
  ('裂石钧', '裂石钧', '#DB7770', 'vector', 'hammer', NULL, 90);
