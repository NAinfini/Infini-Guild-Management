-- Core schema baseline for the guild portal worker.
--
-- This is the fresh pre-release schema. It intentionally contains no legacy
-- compatibility tables or upgrade path; a new database reaches the complete
-- runtime schema in one step.
--
-- Never edit this file after it has been applied. Add the next monotonically
-- numbered migration instead.

PRAGMA defer_foreign_keys = ON;


-- ── Schema ─────────────────────────────────────────────────────────

CREATE TABLE "announcements" (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body_json TEXT NOT NULL
    CONSTRAINT announcements_body_json_object CHECK (json_valid(body_json) AND json_type(body_json) = 'object'),
  pinned INTEGER NOT NULL DEFAULT 0
    CONSTRAINT announcements_pinned_boolean CHECK (pinned IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'draft' CONSTRAINT announcements_status_valid CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  publish_at TEXT,
  expires_at TEXT,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT announcements_times_valid CHECK (
    (publish_at IS NULL OR (length(publish_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', publish_at) IS NOT NULL AND publish_at = strftime('%Y-%m-%dT%H:%M:%fZ', publish_at))) AND
    (expires_at IS NULL OR (length(expires_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NOT NULL AND expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at))) AND
    (archived_at IS NULL OR (length(archived_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', archived_at) IS NOT NULL AND archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at)))
  )
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL CONSTRAINT audit_log_entity_type_valid CHECK (entity_type IN (
    'analytics_settings', 'announcement', 'audit_archive_export', 'audit_log_export', 'badge',
    'class_catalog', 'class_tag', 'event', 'event_participant', 'event_poll_vote', 'gallery',
    'gallery_item', 'guild_war', 'guild_war_history', 'guild_war_member_stats', 'invite_link',
    'media_cleanup', 'member_absence', 'member_badge', 'member_profile', 'recurring_template',
    'role', 'seed', 'site_config', 'system_test', 'storage', 'storage_category', 'storage_item',
    'storage_transaction', 'user', 'user_auth', 'wiki', 'wiki_article', 'wiki_category'
  )),
  action TEXT NOT NULL CONSTRAINT audit_log_action_valid CHECK (action IN (
    'admin_create_member', 'archive', 'adjust', 'acknowledge', 'assign',
    'batch_add_by_moderator', 'batch_deactivate', 'batch_delete', 'batch_reactivate',
    'batch_remove_by_moderator', 'batch_role_update', 'batch_update', 'change_password',
    'change_username', 'complete', 'conclude', 'create', 'create_video', 'deactivate', 'delete',
    'delete_audio', 'delete_avatar', 'delete_images', 'distribute', 'download_raw_ndjson_gz',
    'export_filtered_csv', 'export_filtered_json', 'init', 'intake', 'join', 'leave',
    'login_failed', 'move_member', 'pause', 'publish', 'raffle_draw', 'reactivate', 'register',
    'reset_login_lock', 'reset_password', 'rollback', 'run', 'resume', 'revoke', 'save_teams',
    'set_role_tag', 'share_video', 'unassign', 'update', 'update_role', 'upload', 'upload_audio',
    'upload_avatar', 'upload_icon', 'upload_images', 'vote'
  )),
  actor_id TEXT NOT NULL REFERENCES users(id),
  entity_id TEXT NOT NULL,
  diff_title TEXT,
  detail_text TEXT CONSTRAINT audit_log_detail_object CHECK (
    detail_text IS NULL OR (json_valid(detail_text) AND json_type(detail_text) = 'object')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
  vector_icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
    CONSTRAINT class_catalog_sort_order_nonnegative CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT class_catalog_icon_source_consistent CHECK (
    (icon_type = 'vector' AND vector_icon IS NOT NULL) OR
    (icon_type = 'image' AND vector_icon IS NULL)
  )
);

CREATE TABLE class_tag_members (
  tag_id TEXT NOT NULL REFERENCES class_tags(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES class_catalog(id) ON DELETE CASCADE,
  PRIMARY KEY (tag_id, class_id)
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

CREATE TABLE error_log (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CONSTRAINT error_log_source_valid CHECK (source IN ('request', 'cron', 'push', 'audit')),
  level TEXT NOT NULL DEFAULT 'error' CONSTRAINT error_log_level_valid CHECK (level IN ('error', 'warn')),
  message TEXT NOT NULL,
  request_path TEXT,
  request_method TEXT,
  request_id TEXT,
  stack TEXT,
  context TEXT CONSTRAINT error_log_context_object CHECK (
    context IS NULL OR (json_valid(context) AND json_type(context) = 'object')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE event_class_quotas (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES class_tags(id) ON DELETE CASCADE,
  required INTEGER NOT NULL CONSTRAINT event_class_quotas_required_positive CHECK (required > 0),
  PRIMARY KEY (event_id, tag_id)
);

CREATE TABLE "event_participants" (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES "events"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "event_poll_options" (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES "events"(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
    CONSTRAINT event_poll_options_sort_nonnegative CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "event_poll_votes" (
  event_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, option_id, user_id),
  CONSTRAINT fk_event_poll_votes_event_option
    FOREIGN KEY (event_id, option_id) REFERENCES "event_poll_options"(event_id, id) ON DELETE CASCADE
);

CREATE TABLE "event_polls" (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES "events"(id) ON DELETE CASCADE,
  results_visibility TEXT NOT NULL DEFAULT 'after_vote'
    CONSTRAINT event_polls_results_visibility_valid CHECK (results_visibility IN ('always', 'after_vote', 'after_close')),
  show_voter_names INTEGER NOT NULL DEFAULT 0
    CONSTRAINT event_polls_show_voter_names_boolean CHECK (show_voter_names IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "event_raffle_winners" (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES "events"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drawn_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
  series_id TEXT REFERENCES recurring_templates(id),
  instance_date TEXT,
  winner_count INTEGER CONSTRAINT events_winner_count_positive CHECK (winner_count IS NULL OR winner_count > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT events_boolean_flags_valid CHECK (
    pinned IN (0, 1) AND signup_locked IN (0, 1) AND auto_archive IN (0, 1) AND auto_archived IN (0, 1)
  ),
  CONSTRAINT events_series_instance_pair CHECK (
    (series_id IS NULL AND instance_date IS NULL) OR
    (series_id IS NOT NULL AND instance_date IS NOT NULL)
  ),
  CONSTRAINT events_times_valid CHECK (
    length(start_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', start_at) IS NOT NULL AND start_at = strftime('%Y-%m-%dT%H:%M:%fZ', start_at) AND
    (end_at IS NULL OR (length(end_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', end_at) IS NOT NULL AND end_at = strftime('%Y-%m-%dT%H:%M:%fZ', end_at) AND end_at > start_at)) AND
    (visible_at IS NULL OR (length(visible_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', visible_at) IS NOT NULL AND visible_at = strftime('%Y-%m-%dT%H:%M:%fZ', visible_at))) AND
    (archived_at IS NULL OR (length(archived_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', archived_at) IS NOT NULL AND archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at)))
  ),
  CONSTRAINT events_instance_date_valid CHECK (
    instance_date IS NULL OR (length(instance_date) = 10 AND strftime('%Y-%m-%d', instance_date) IS NOT NULL AND instance_date = strftime('%Y-%m-%d', instance_date))
  )
);

CREATE TABLE gallery_items (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CONSTRAINT gallery_items_type_valid CHECK(type IN ('image', 'video')),
  url TEXT,
  caption TEXT,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT gallery_items_source_consistent CHECK (
    (type = 'image' AND url IS NULL) OR
    (type = 'video' AND url IS NOT NULL)
  )
);

CREATE TABLE "invite_links" (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES "roles"(id) ON DELETE RESTRICT,
  max_uses INTEGER NOT NULL CONSTRAINT invite_links_max_uses_positive CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CONSTRAINT invite_links_used_count_valid CHECK (used_count >= 0 AND used_count <= max_uses),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  CONSTRAINT invite_links_times_valid CHECK (
    (expires_at IS NULL OR (length(expires_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NOT NULL AND expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at))) AND
    (revoked_at IS NULL OR (length(revoked_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', revoked_at) IS NOT NULL AND revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', revoked_at)))
  )
);

CREATE TABLE login_failures (
  username TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
  fail_count INTEGER NOT NULL DEFAULT 0
    CONSTRAINT login_failures_fail_count_nonnegative CHECK (fail_count >= 0),
  locked_until TEXT CONSTRAINT login_failures_locked_until_valid CHECK (
    locked_until IS NULL OR (length(locked_until) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', locked_until) IS NOT NULL AND locked_until = strftime('%Y-%m-%dT%H:%M:%fZ', locked_until))
  ),
  last_failed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY NOT NULL
    CONSTRAINT media_assets_id_nanoid CHECK (length(id) = 21 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CONSTRAINT media_assets_purpose_valid CHECK (
    purpose IN ('member_avatar', 'member_image', 'member_audio', 'gallery_image', 'event_image', 'announcement_image', 'wiki_image', 'storage_image', 'class_icon', 'site_logo')
  ),
  original_name TEXT,
  media_type TEXT NOT NULL
    CONSTRAINT media_assets_media_type_valid CHECK (media_type IN ('image', 'audio')),
  state TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT media_assets_state_valid CHECK (state IN ('pending', 'ready')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT media_assets_purpose_type_consistent CHECK (
    (purpose = 'member_audio' AND media_type = 'audio') OR
    (purpose <> 'member_audio' AND media_type = 'image')
  ),
  CONSTRAINT media_assets_pending_expiry_required CHECK (state <> 'pending' OR expires_at IS NOT NULL),
  CONSTRAINT media_assets_expires_at_valid CHECK (
    expires_at IS NULL OR (length(expires_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NOT NULL AND expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at))
  ),
  CONSTRAINT media_assets_original_name_contract CHECK (
    (media_type = 'image' AND original_name IS NULL) OR
    (media_type = 'audio' AND original_name IS NOT NULL AND length(trim(original_name)) BETWEEN 1 AND 255)
  )
);

CREATE TABLE media_variants (
  media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  variant TEXT NOT NULL
    CONSTRAINT media_variants_variant_valid CHECK (variant IN ('full', 'view')),
  byte_size INTEGER NOT NULL
    CONSTRAINT media_variants_byte_size_positive CHECK (byte_size > 0),
  width INTEGER,
  height INTEGER,
  PRIMARY KEY (media_id, variant),
  CONSTRAINT media_variants_dimensions_consistent CHECK (
    (width IS NULL AND height IS NULL) OR
    (width IS NOT NULL AND height IS NOT NULL AND width > 0 AND height > 0)
  )
);

CREATE TABLE media_links (
  media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CONSTRAINT media_links_entity_type_valid CHECK (
    entity_type IN ('member_profile', 'gallery_item', 'event', 'recurring_template', 'announcement', 'wiki_article', 'storage_item', 'class_catalog', 'site_config')
  ),
  entity_id TEXT NOT NULL,
  slot TEXT NOT NULL CONSTRAINT media_links_slot_valid CHECK (
    slot IN ('avatar', 'image', 'audio', 'attachment', 'body', 'icon', 'logo')
  ),
  sort_order INTEGER NOT NULL DEFAULT 0
    CONSTRAINT media_links_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (media_id, entity_type, entity_id, slot),
  CONSTRAINT media_links_entity_slot_consistent CHECK (
    (entity_type = 'member_profile' AND slot IN ('avatar', 'image', 'audio')) OR
    (entity_type = 'gallery_item' AND slot = 'image') OR
    (entity_type IN ('event', 'recurring_template') AND slot = 'attachment') OR
    (entity_type IN ('announcement', 'wiki_article') AND slot = 'body') OR
    (entity_type = 'storage_item' AND slot = 'image') OR
    (entity_type = 'class_catalog' AND slot = 'icon') OR
    (entity_type = 'site_config' AND slot = 'logo')
  ),
  CONSTRAINT media_links_singular_sort_zero CHECK (
    slot NOT IN ('avatar', 'audio', 'icon', 'logo') OR sort_order = 0
  ),
  CONSTRAINT media_links_gallery_sort_zero CHECK (entity_type <> 'gallery_item' OR sort_order = 0)
);

CREATE TABLE "member_absences" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT member_absences_dates_valid CHECK (
    length(start_date) = 10 AND strftime('%Y-%m-%d', start_date) IS NOT NULL AND start_date = strftime('%Y-%m-%d', start_date) AND
    length(end_date) = 10 AND strftime('%Y-%m-%d', end_date) IS NOT NULL AND end_date = strftime('%Y-%m-%d', end_date)
  ),
  CONSTRAINT member_absences_date_range_valid CHECK (start_date <= end_date)
);

CREATE TABLE member_badge_assignments (
  badge_id TEXT NOT NULL REFERENCES member_badges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE member_badges (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  label_html TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
    CONSTRAINT member_badges_sort_nonnegative CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "member_profiles" (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  power REAL NOT NULL DEFAULT 0 CONSTRAINT member_profiles_power_nonnegative CHECK (power >= 0),
  title_html TEXT,
  bio TEXT,
  availability_timezone TEXT
    CONSTRAINT member_profiles_availability_timezone_valid CHECK (
      availability_timezone IS NULL OR (
        length(availability_timezone) BETWEEN 1 AND 64 AND
        availability_timezone = trim(availability_timezone)
      )
    ),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE member_availability_windows (
  user_id TEXT NOT NULL REFERENCES member_profiles(user_id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CONSTRAINT member_availability_windows_weekday_valid CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CONSTRAINT member_availability_windows_start_valid CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CONSTRAINT member_availability_windows_end_valid CHECK (end_minute BETWEEN 1 AND 1440),
  CONSTRAINT member_availability_windows_range_valid CHECK (start_minute < end_minute),
  PRIMARY KEY (user_id, weekday, start_minute, end_minute)
);

CREATE TRIGGER member_availability_windows_no_overlap_insert
BEFORE INSERT ON member_availability_windows
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM member_availability_windows AS existing
  WHERE existing.user_id = NEW.user_id
    AND existing.weekday = NEW.weekday
    AND NEW.start_minute < existing.end_minute
    AND NEW.end_minute > existing.start_minute
)
BEGIN
  SELECT RAISE(ABORT, 'member_availability_windows_overlap');
END;

CREATE TRIGGER member_availability_windows_no_overlap_update
BEFORE UPDATE ON member_availability_windows
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM member_availability_windows AS existing
  WHERE existing.user_id = NEW.user_id
    AND existing.weekday = NEW.weekday
    AND NEW.start_minute < existing.end_minute
    AND NEW.end_minute > existing.start_minute
    AND NOT (
      existing.user_id = OLD.user_id
      AND existing.weekday = OLD.weekday
      AND existing.start_minute = OLD.start_minute
      AND existing.end_minute = OLD.end_minute
    )
)
BEGIN
  SELECT RAISE(ABORT, 'member_availability_windows_overlap');
END;

CREATE TABLE "member_profile_classes" (
  user_id TEXT NOT NULL REFERENCES "member_profiles"(user_id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES class_catalog(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CONSTRAINT member_profile_classes_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (user_id, class_id)
);

CREATE TABLE "member_profile_videos" (
  user_id TEXT NOT NULL REFERENCES "member_profiles"(user_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL CONSTRAINT member_profile_videos_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (user_id, url)
);

CREATE TABLE "recurring_templates" (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CONSTRAINT recurring_templates_type_valid CHECK (type IN ('weekly_mission', 'guild_war', 'social', 'poll', 'raffle', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL CONSTRAINT recurring_templates_start_time_valid CHECK (
    length(start_time) = 5 AND
    start_time GLOB '[0-9][0-9]:[0-9][0-9]' AND
    CAST(substr(start_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23 AND
    CAST(substr(start_time, 4, 2) AS INTEGER) BETWEEN 0 AND 59
  ),
  duration_minutes INTEGER CONSTRAINT recurring_templates_duration_nonnegative CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  capacity INTEGER CONSTRAINT recurring_templates_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  recurrence_frequency TEXT NOT NULL,
  recurrence_interval INTEGER NOT NULL,
  recurrence_day_of_month INTEGER,
  recurrence_end_after INTEGER,
  recurrence_end_at TEXT,
  visibility_offset_minutes INTEGER NOT NULL DEFAULT 0
    CONSTRAINT recurring_templates_visibility_offset_nonnegative CHECK (visibility_offset_minutes >= 0),
  auto_archive INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  last_generated_date TEXT,
  generation_count INTEGER NOT NULL DEFAULT 0
    CONSTRAINT recurring_templates_generation_count_nonnegative CHECK (generation_count >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT recurring_templates_boolean_flags_valid CHECK (auto_archive IN (0, 1) AND paused IN (0, 1)),
  CONSTRAINT recurring_templates_recurrence_valid CHECK (
    recurrence_frequency IN ('daily', 'weekly', 'monthly') AND
    recurrence_interval > 0 AND
    (
      (recurrence_frequency IN ('daily', 'weekly') AND recurrence_day_of_month IS NULL) OR
      (recurrence_frequency = 'monthly' AND recurrence_day_of_month IS NOT NULL AND recurrence_day_of_month BETWEEN 1 AND 31)
    )
  ),
  CONSTRAINT recurring_templates_recurrence_end_valid CHECK (
    (recurrence_end_after IS NULL OR recurrence_end_after > 0) AND
    (recurrence_end_at IS NULL OR (length(recurrence_end_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', recurrence_end_at) IS NOT NULL AND recurrence_end_at = strftime('%Y-%m-%dT%H:%M:%fZ', recurrence_end_at))) AND
    NOT (recurrence_end_after IS NOT NULL AND recurrence_end_at IS NOT NULL)
  ),
  CONSTRAINT recurring_templates_last_generated_date_valid CHECK (
    last_generated_date IS NULL OR (length(last_generated_date) = 10 AND strftime('%Y-%m-%d', last_generated_date) IS NOT NULL AND last_generated_date = strftime('%Y-%m-%d', last_generated_date))
  )
);

CREATE TABLE recurring_template_weekdays (
  template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CONSTRAINT recurring_template_weekdays_weekday_valid CHECK (weekday BETWEEN 0 AND 6),
  PRIMARY KEY (template_id, weekday)
);

CREATE TABLE recurring_template_class_quotas (
  template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES class_tags(id) ON DELETE CASCADE,
  required INTEGER NOT NULL CONSTRAINT recurring_template_class_quotas_required_positive CHECK (required > 0),
  PRIMARY KEY (template_id, tag_id)
);

CREATE TABLE "role_permissions" (
  role_id TEXT NOT NULL REFERENCES "roles"(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CONSTRAINT role_permissions_permission_valid CHECK (permission IN (
    'admin.users.view', 'admin.users.edit', 'admin.users.role', 'admin.users.activate',
    'admin.users.delete', 'admin.users.password', 'admin.invite.view', 'admin.invite.manage',
    'admin.audit.view', 'admin.audit.export', 'admin.status.view', 'admin.analytics.view',
    'admin.analytics.manage', 'admin.roles.view', 'admin.roles.manage',
    'admin.siteConfig.manage', 'admin.classes.manage', 'guildwar.teams.edit',
    'guildwar.history.edit', 'events.create', 'events.edit', 'events.archive',
    'events.delete', 'events.templates', 'announcements.create', 'announcements.edit',
    'announcements.archive', 'announcements.delete', 'gallery.upload', 'gallery.manage',
    'gallery.delete', 'wiki.articles.create', 'wiki.articles.edit', 'wiki.articles.archive',
    'wiki.articles.delete', 'wiki.categories.manage', 'admin.badges.manage',
    'admin.storage.structure', 'admin.storage.items', 'admin.storage.stock'
  )),
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE "roles" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL CONSTRAINT roles_level_positive CHECK (level >= 1),
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL CONSTRAINT sessions_expires_at_valid CHECK (
    length(expires_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NOT NULL AND expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "site_config" (
  id TEXT PRIMARY KEY NOT NULL,
  site_name TEXT NOT NULL,
  feature_announcements_enabled INTEGER NOT NULL,
  feature_events_enabled INTEGER NOT NULL,
  feature_guild_war_enabled INTEGER NOT NULL,
  feature_gallery_enabled INTEGER NOT NULL,
  feature_wiki_enabled INTEGER NOT NULL,
  feature_tools_enabled INTEGER NOT NULL,
  feature_storage_enabled INTEGER NOT NULL,
  media_site_logo_max_bytes INTEGER NOT NULL,
  media_class_icon_max_bytes INTEGER NOT NULL,
  media_profile_image_max_bytes INTEGER NOT NULL,
  media_profile_audio_max_bytes INTEGER NOT NULL,
  media_announcement_image_max_bytes INTEGER NOT NULL,
  media_wiki_image_max_bytes INTEGER NOT NULL,
  media_event_image_max_bytes INTEGER NOT NULL,
  media_gallery_image_max_bytes INTEGER NOT NULL,
  media_storage_image_max_bytes INTEGER NOT NULL,
  media_profile_quota INTEGER NOT NULL,
  media_announcement_quota INTEGER NOT NULL,
  media_gallery_quota INTEGER NOT NULL,
  media_wiki_quota INTEGER NOT NULL,
  storage_images_per_item INTEGER NOT NULL,
  absence_max_span_days INTEGER NOT NULL,
  absence_max_entries_per_user INTEGER NOT NULL,
  analytics_reference_duration_minutes REAL NOT NULL,
  analytics_kills_weight REAL NOT NULL,
  analytics_towers_weight REAL NOT NULL,
  analytics_base_hp_weight REAL NOT NULL,
  analytics_credits_weight REAL NOT NULL,
  analytics_distance_weight REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT site_config_singleton_id CHECK (id = 'default'),
  CONSTRAINT site_config_site_name_valid CHECK (length(site_name) BETWEEN 1 AND 100 AND site_name = trim(site_name)),
  CONSTRAINT site_config_feature_flags_boolean CHECK (
    feature_announcements_enabled IN (0, 1)
    AND feature_events_enabled IN (0, 1)
    AND feature_guild_war_enabled IN (0, 1)
    AND feature_gallery_enabled IN (0, 1)
    AND feature_wiki_enabled IN (0, 1)
    AND feature_tools_enabled IN (0, 1)
    AND feature_storage_enabled IN (0, 1)
  ),
  CONSTRAINT site_config_media_max_bytes_bounds CHECK (
    media_site_logo_max_bytes BETWEEN 1 AND 16252928
    AND media_class_icon_max_bytes BETWEEN 1 AND 16252928
    AND media_profile_image_max_bytes BETWEEN 1 AND 16252928
    AND media_profile_audio_max_bytes BETWEEN 1 AND 32505856
    AND media_announcement_image_max_bytes BETWEEN 1 AND 16252928
    AND media_wiki_image_max_bytes BETWEEN 1 AND 16252928
    AND media_event_image_max_bytes BETWEEN 1 AND 16252928
    AND media_gallery_image_max_bytes BETWEEN 1 AND 16252928
    AND media_storage_image_max_bytes BETWEEN 1 AND 16252928
  ),
  CONSTRAINT site_config_media_quotas_bounds CHECK (
    media_profile_quota BETWEEN 1 AND 100
    AND media_announcement_quota BETWEEN 1 AND 100
    AND media_gallery_quota BETWEEN 1 AND 100
    AND media_wiki_quota BETWEEN 1 AND 100
  ),
  CONSTRAINT site_config_storage_images_per_item_bounds CHECK (storage_images_per_item BETWEEN 1 AND 5),
  CONSTRAINT site_config_absence_policy_bounds CHECK (
    absence_max_span_days BETWEEN 1 AND 366
    AND absence_max_entries_per_user BETWEEN 1 AND 20
  ),
  CONSTRAINT site_config_analytics_reference_duration_positive CHECK (analytics_reference_duration_minutes > 0),
  CONSTRAINT site_config_analytics_weights_valid CHECK (
    analytics_kills_weight >= 0
    AND analytics_towers_weight >= 0
    AND analytics_base_hp_weight >= 0
    AND analytics_credits_weight >= 0
    AND analytics_distance_weight >= 0
    AND (analytics_kills_weight + analytics_towers_weight + analytics_base_hp_weight + analytics_credits_weight + analytics_distance_weight) > 0
  )
);

CREATE TABLE storage_categories (
  id TEXT PRIMARY KEY,
  storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "storage_items" (
  id TEXT PRIMARY KEY,
  storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
  category_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  allow_member_deposit INTEGER NOT NULL DEFAULT 0,
  allow_member_withdraw INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT storage_items_category_same_storage_fk
    FOREIGN KEY (storage_id, category_id)
    REFERENCES storage_categories(storage_id, id) ON DELETE RESTRICT,
  CONSTRAINT storage_items_quantity_nonnegative CHECK (quantity >= 0),
  CONSTRAINT storage_items_boolean_flags_valid CHECK (
    allow_member_deposit IN (0, 1) AND allow_member_withdraw IN (0, 1)
  )
);

CREATE TABLE storage_batches (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT storage_batches_id_valid CHECK (
    length(id) = 78
    AND substr(id, 1, 14) = 'storage-batch-'
    AND substr(id, 15) NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE TABLE "storage_transactions" (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES "storage_items"(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CONSTRAINT storage_transactions_type_valid CHECK (type IN ('intake', 'distribute', 'adjust')),
  quantity_delta INTEGER NOT NULL,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  batch_id TEXT,
  batch_position INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT storage_transactions_batch_actor_fk
    FOREIGN KEY (batch_id, actor_id)
    REFERENCES storage_batches(id, actor_id) ON DELETE RESTRICT,
  CONSTRAINT storage_transactions_quantity_nonzero CHECK (quantity_delta <> 0),
  CONSTRAINT storage_transactions_quantity_sign_valid CHECK (
    (type = 'intake' AND quantity_delta > 0)
    OR (type = 'distribute' AND quantity_delta < 0)
    OR (type = 'adjust' AND quantity_delta <> 0)
  ),
  CONSTRAINT storage_transactions_batch_pair_valid CHECK (
    (batch_id IS NULL AND batch_position IS NULL)
    OR (batch_id IS NOT NULL AND batch_position IS NOT NULL AND batch_position >= 0)
  )
);

CREATE TABLE storages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE system_test_artifacts (
  run_id TEXT NOT NULL REFERENCES system_test_runs(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL CONSTRAINT system_test_artifacts_artifact_type_valid CHECK (artifact_type IN (
    'user', 'invite_link', 'role', 'event', 'event_template', 'announcement', 'gallery_item',
    'war_history', 'wiki_category', 'wiki_article', 'badge', 'storage', 'storage_category',
    'storage_item', 'storage_batch', 'audit_log', 'error_log', 'media_asset', 'class_catalog',
    'class_tag', 'member_absence'
  )),
  artifact_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (run_id, artifact_type, artifact_key)
);

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
  CONSTRAINT system_test_runs_active_requests_nonnegative CHECK (active_requests >= 0),
  CONSTRAINT system_test_runs_cleanup_attempts_nonnegative CHECK (cleanup_attempts >= 0)
);

CREATE TABLE user_auth_password (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' REFERENCES "roles"(id),
  is_active INTEGER NOT NULL DEFAULT 1
    CONSTRAINT users_is_active_boolean CHECK (is_active IN (0, 1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT users_id_nanoid CHECK (length(id) = 21 AND id NOT GLOB '*[^A-Za-z0-9_-]*')
);

CREATE TABLE "war_history" (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT REFERENCES "events"(id),
  war_name TEXT NOT NULL,
  enemy_name TEXT,
  result TEXT CONSTRAINT war_history_result_valid CHECK (result IS NULL OR result IN ('win', 'loss', 'draw')),
  own_kills REAL,
  own_towers REAL,
  own_base_hp REAL,
  own_credits REAL,
  own_distance REAL,
  enemy_kills REAL,
  enemy_towers REAL,
  enemy_base_hp REAL,
  enemy_credits REAL,
  enemy_distance REAL,
  duration_minutes REAL CONSTRAINT war_history_duration_positive CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT war_history_stats_nonnegative CHECK (
    (own_kills IS NULL OR own_kills >= 0) AND
    (own_towers IS NULL OR own_towers >= 0) AND
    (own_base_hp IS NULL OR own_base_hp >= 0) AND
    (own_credits IS NULL OR own_credits >= 0) AND
    (own_distance IS NULL OR own_distance >= 0) AND
    (enemy_kills IS NULL OR enemy_kills >= 0) AND
    (enemy_towers IS NULL OR enemy_towers >= 0) AND
    (enemy_base_hp IS NULL OR enemy_base_hp >= 0) AND
    (enemy_credits IS NULL OR enemy_credits >= 0) AND
    (enemy_distance IS NULL OR enemy_distance >= 0)
  )
);

CREATE TABLE "war_pool_members" (
  id TEXT PRIMARY KEY NOT NULL,
  war_history_id TEXT REFERENCES "war_history"(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES "events"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT war_pool_members_exactly_one_parent CHECK ((event_id IS NULL) <> (war_history_id IS NULL))
);

CREATE TABLE "war_team_members" (
  id TEXT PRIMARY KEY NOT NULL,
  war_team_id TEXT NOT NULL REFERENCES "war_teams"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_tag TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  kills REAL,
  deaths REAL,
  assists REAL,
  damage REAL,
  healing REAL,
  building_damage REAL,
  credits REAL,
  damage_taken REAL,
  note TEXT,
  CONSTRAINT war_team_members_sort_nonnegative CHECK (sort_order >= 0),
  CONSTRAINT war_team_members_stats_nonnegative CHECK (
    (kills IS NULL OR kills >= 0) AND
    (deaths IS NULL OR deaths >= 0) AND
    (assists IS NULL OR assists >= 0) AND
    (damage IS NULL OR damage >= 0) AND
    (healing IS NULL OR healing >= 0) AND
    (building_damage IS NULL OR building_damage >= 0) AND
    (credits IS NULL OR credits >= 0) AND
    (damage_taken IS NULL OR damage_taken >= 0)
  )
);

CREATE TABLE "war_teams" (
  id TEXT PRIMARY KEY NOT NULL,
  war_history_id TEXT REFERENCES "war_history"(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES "events"(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT war_teams_exactly_one_parent CHECK ((event_id IS NULL) <> (war_history_id IS NULL)),
  CONSTRAINT war_teams_sort_nonnegative CHECK (sort_order >= 0),
  CONSTRAINT war_teams_is_locked_boolean CHECK (is_locked IN (0, 1))
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
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT wiki_articles_sort_nonnegative CHECK (sort_order >= 0),
  CONSTRAINT wiki_articles_pinned_boolean CHECK (pinned IN (0, 1)),
  CONSTRAINT wiki_articles_archived_at_valid CHECK (
    archived_at IS NULL OR (length(archived_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', archived_at) IS NOT NULL AND archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', archived_at))
  )
);

CREATE TABLE "wiki_categories" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT REFERENCES "wiki_categories"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT wiki_categories_sort_nonnegative CHECK (sort_order >= 0)
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT wiki_revisions_revision_positive CHECK (revision > 0),
  CONSTRAINT wiki_revisions_restored_from_positive CHECK (restored_from IS NULL OR restored_from > 0)
);

-- Cross-table invariants that Drizzle cannot express.

CREATE TRIGGER media_assets_ready_insert_guard
BEFORE INSERT ON media_assets
FOR EACH ROW
WHEN NEW.state = 'ready'
BEGIN
  SELECT RAISE(ABORT, 'media_assets_must_start_pending');
END;

CREATE TRIGGER media_variants_validate_insert
BEFORE INSERT ON media_variants
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM media_assets AS asset
  WHERE asset.id = NEW.media_id
    AND asset.state = 'pending'
    AND (
      (
        asset.media_type = 'image'
        AND NEW.variant IN ('full', 'view')
        AND NEW.width IS NOT NULL AND NEW.height IS NOT NULL
        AND NEW.width > 0 AND NEW.height > 0
      ) OR (
        asset.media_type = 'audio'
        AND NEW.variant = 'full'
        AND NEW.width IS NULL AND NEW.height IS NULL
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'media_variants_type_mismatch');
END;

CREATE TRIGGER media_variants_validate_update
BEFORE UPDATE ON media_variants
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM media_assets AS asset
  WHERE asset.id = OLD.media_id
    AND asset.state = 'ready'
) OR NOT EXISTS (
  SELECT 1
  FROM media_assets AS asset
  WHERE asset.id = NEW.media_id
    AND asset.state = 'pending'
    AND (
      (
        asset.media_type = 'image'
        AND NEW.variant IN ('full', 'view')
        AND NEW.width IS NOT NULL AND NEW.height IS NOT NULL
        AND NEW.width > 0 AND NEW.height > 0
      ) OR (
        asset.media_type = 'audio'
        AND NEW.variant = 'full'
        AND NEW.width IS NULL AND NEW.height IS NULL
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'media_variants_update_invalid');
END;

CREATE TRIGGER media_variants_ready_delete_guard
BEFORE DELETE ON media_variants
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM media_assets
  WHERE id = OLD.media_id AND state = 'ready'
)
BEGIN
  SELECT RAISE(ABORT, 'media_variants_ready_immutable');
END;

CREATE TRIGGER media_assets_ready_variants_valid
BEFORE UPDATE OF state ON media_assets
FOR EACH ROW
WHEN NEW.state = 'ready' AND OLD.state <> 'ready' AND NOT (
  (
    NEW.media_type = 'image'
    AND (SELECT count(*) FROM media_variants WHERE media_id = NEW.id) = 2
    AND EXISTS (SELECT 1 FROM media_variants WHERE media_id = NEW.id AND variant = 'full')
    AND EXISTS (SELECT 1 FROM media_variants WHERE media_id = NEW.id AND variant = 'view')
  ) OR (
    NEW.media_type = 'audio'
    AND (SELECT count(*) FROM media_variants WHERE media_id = NEW.id) = 1
    AND EXISTS (SELECT 1 FROM media_variants WHERE media_id = NEW.id AND variant = 'full')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'media_assets_ready_variants_invalid');
END;

CREATE TRIGGER media_links_validate_insert
BEFORE INSERT ON media_links
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'media_links_asset_invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM media_assets AS asset
    WHERE asset.id = NEW.media_id
      AND asset.state = 'ready'
      AND (
        (asset.purpose = 'member_avatar' AND NEW.entity_type = 'member_profile' AND NEW.slot = 'avatar') OR
        (asset.purpose = 'member_image' AND NEW.entity_type = 'member_profile' AND NEW.slot = 'image') OR
        (asset.purpose = 'member_audio' AND NEW.entity_type = 'member_profile' AND NEW.slot = 'audio') OR
        (asset.purpose = 'gallery_image' AND NEW.entity_type = 'gallery_item' AND NEW.slot = 'image') OR
        (asset.purpose = 'event_image' AND NEW.entity_type = 'event' AND NEW.slot = 'attachment') OR
        (asset.purpose = 'event_image' AND NEW.entity_type = 'recurring_template' AND NEW.slot = 'attachment') OR
        (asset.purpose = 'announcement_image' AND NEW.entity_type = 'announcement' AND NEW.slot = 'body') OR
        (asset.purpose = 'wiki_image' AND NEW.entity_type = 'wiki_article' AND NEW.slot = 'body') OR
        (asset.purpose = 'storage_image' AND NEW.entity_type = 'storage_item' AND NEW.slot = 'image') OR
        (asset.purpose = 'class_icon' AND NEW.entity_type = 'class_catalog' AND NEW.slot = 'icon') OR
        (asset.purpose = 'site_logo' AND NEW.entity_type = 'site_config' AND NEW.slot = 'logo')
      )
  );

  SELECT RAISE(ABORT, 'media_links_parent_missing')
  WHERE NOT (
    (NEW.entity_type = 'member_profile' AND EXISTS (SELECT 1 FROM member_profiles WHERE user_id = NEW.entity_id)) OR
    (NEW.entity_type = 'gallery_item' AND EXISTS (SELECT 1 FROM gallery_items WHERE id = NEW.entity_id AND type = 'image')) OR
    (NEW.entity_type = 'event' AND EXISTS (SELECT 1 FROM events WHERE id = NEW.entity_id)) OR
    (NEW.entity_type = 'recurring_template' AND EXISTS (SELECT 1 FROM recurring_templates WHERE id = NEW.entity_id)) OR
    (NEW.entity_type = 'announcement' AND EXISTS (SELECT 1 FROM announcements WHERE id = NEW.entity_id)) OR
    (NEW.entity_type = 'wiki_article' AND EXISTS (SELECT 1 FROM wiki_articles WHERE id = NEW.entity_id)) OR
    (NEW.entity_type = 'storage_item' AND EXISTS (SELECT 1 FROM storage_items WHERE id = NEW.entity_id)) OR
    (NEW.entity_type = 'class_catalog' AND EXISTS (SELECT 1 FROM class_catalog WHERE id = NEW.entity_id)) OR
    (NEW.entity_type = 'site_config' AND EXISTS (SELECT 1 FROM site_config WHERE id = NEW.entity_id))
  );
END;

CREATE TRIGGER media_links_identity_immutable
BEFORE UPDATE OF media_id, entity_type, entity_id, slot ON media_links
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'media_links_identity_immutable');
END;

CREATE TRIGGER media_links_claim_asset
AFTER INSERT ON media_links
FOR EACH ROW
BEGIN
  UPDATE media_assets SET expires_at = NULL WHERE id = NEW.media_id;
END;

CREATE TRIGGER media_links_release_asset
AFTER DELETE ON media_links
FOR EACH ROW
BEGIN
  UPDATE media_assets
  SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')
  WHERE id = OLD.media_id
    AND state = 'ready'
    AND NOT EXISTS (SELECT 1 FROM media_links WHERE media_id = OLD.media_id);
END;

CREATE TRIGGER member_profiles_delete_media_links
AFTER DELETE ON member_profiles
FOR EACH ROW
BEGIN
  DELETE FROM media_links WHERE entity_type = 'member_profile' AND entity_id = OLD.user_id;
END;

CREATE TRIGGER gallery_items_delete_media_links
AFTER DELETE ON gallery_items
FOR EACH ROW
BEGIN
  DELETE FROM media_links WHERE entity_type = 'gallery_item' AND entity_id = OLD.id;
END;

CREATE TRIGGER events_delete_media_links
AFTER DELETE ON events
FOR EACH ROW
BEGIN
  DELETE FROM media_links WHERE entity_type = 'event' AND entity_id = OLD.id;
END;

CREATE TRIGGER recurring_templates_delete_media_links
AFTER DELETE ON recurring_templates
FOR EACH ROW
BEGIN
  DELETE FROM media_links WHERE entity_type = 'recurring_template' AND entity_id = OLD.id;
END;

CREATE TRIGGER announcements_delete_media_links
AFTER DELETE ON announcements
FOR EACH ROW
BEGIN
  DELETE FROM media_links WHERE entity_type = 'announcement' AND entity_id = OLD.id;
END;

CREATE TRIGGER wiki_articles_delete_media_links
AFTER DELETE ON wiki_articles
FOR EACH ROW
BEGIN
  DELETE FROM media_links WHERE entity_type = 'wiki_article' AND entity_id = OLD.id;
END;

CREATE TRIGGER storage_items_delete_media_links
AFTER DELETE ON storage_items
FOR EACH ROW
BEGIN
  DELETE FROM media_links WHERE entity_type = 'storage_item' AND entity_id = OLD.id;
END;

CREATE TRIGGER class_catalog_delete_media_links
AFTER DELETE ON class_catalog
FOR EACH ROW
BEGIN
  DELETE FROM media_links WHERE entity_type = 'class_catalog' AND entity_id = OLD.id;
END;

CREATE TRIGGER site_config_delete_media_links
AFTER DELETE ON site_config
FOR EACH ROW
BEGIN
  DELETE FROM media_links WHERE entity_type = 'site_config' AND entity_id = OLD.id;
END;

CREATE TRIGGER class_tags_validate_owner_insert
BEFORE INSERT ON class_tags
FOR EACH ROW
WHEN (
  NEW.owner_kind = 'event'
  AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.owner_id)
) OR (
  NEW.owner_kind = 'recurring_template'
  AND NOT EXISTS (SELECT 1 FROM recurring_templates WHERE id = NEW.owner_id)
)
BEGIN
  SELECT RAISE(ABORT, 'class_tags_owner_missing');
END;

CREATE TRIGGER class_tags_validate_owner_update
BEFORE UPDATE OF owner_kind, owner_id ON class_tags
FOR EACH ROW
WHEN (
  NEW.owner_kind = 'event'
  AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.owner_id)
) OR (
  NEW.owner_kind = 'recurring_template'
  AND NOT EXISTS (SELECT 1 FROM recurring_templates WHERE id = NEW.owner_id)
)
BEGIN
  SELECT RAISE(ABORT, 'class_tags_owner_missing');
END;

CREATE TRIGGER events_delete_owned_class_tags
AFTER DELETE ON events
FOR EACH ROW
BEGIN
  DELETE FROM class_tags WHERE owner_kind = 'event' AND owner_id = OLD.id;
END;

CREATE TRIGGER recurring_templates_delete_owned_class_tags
AFTER DELETE ON recurring_templates
FOR EACH ROW
BEGIN
  DELETE FROM class_tags WHERE owner_kind = 'recurring_template' AND owner_id = OLD.id;
END;

CREATE INDEX idx_announcements_expiry ON announcements(status, expires_at);

CREATE INDEX idx_announcements_schedule ON announcements(status, publish_at);

CREATE INDEX idx_announcements_status_pinned_created ON announcements(status, pinned, created_at, id);

CREATE INDEX idx_announcements_created_by ON announcements(created_by);

CREATE INDEX idx_announcements_updated_by ON announcements(updated_by);

CREATE INDEX idx_audit_log_actor_created ON audit_log(actor_id, created_at, id);

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at, id);

CREATE INDEX idx_audit_log_entity_actor_created ON audit_log(entity_type, actor_id, created_at, id);

CREATE INDEX idx_audit_log_entity_created ON audit_log(entity_type, created_at, id);

CREATE INDEX idx_class_catalog_sort
  ON class_catalog(sort_order, id);

CREATE INDEX idx_class_tag_members_class ON class_tag_members (class_id);

CREATE INDEX idx_class_tags_owner ON class_tags (owner_kind, owner_id);

CREATE INDEX idx_class_tags_sort ON class_tags (sort_order, id);

CREATE INDEX idx_error_log_created_at ON error_log(created_at, id);

CREATE INDEX idx_error_log_source_created ON error_log(source, created_at, id);

CREATE INDEX idx_event_class_quotas_tag ON event_class_quotas(tag_id);

CREATE INDEX idx_event_participants_event_joined ON event_participants(event_id, joined_at, id);

CREATE INDEX idx_event_participants_user_event ON event_participants(user_id, event_id);

CREATE INDEX idx_event_poll_options_event_sort ON event_poll_options(event_id, sort_order, id);

CREATE INDEX idx_event_poll_votes_event_user ON event_poll_votes(event_id, user_id);

CREATE INDEX idx_event_poll_votes_user ON event_poll_votes(user_id);

CREATE INDEX idx_event_raffle_winners_event ON event_raffle_winners(event_id);

CREATE INDEX idx_event_raffle_winners_user ON event_raffle_winners(user_id);

CREATE INDEX idx_events_archived_start ON events(archived_at, start_at, id);

CREATE INDEX idx_events_auto_archive_due ON events(auto_archive, auto_archived, archived_at, end_at, start_at);

CREATE INDEX idx_events_created_by ON events(created_by);

CREATE INDEX idx_events_updated_by ON events(updated_by);

CREATE INDEX idx_gallery_items_created
  ON gallery_items(created_at, id);

CREATE INDEX idx_gallery_items_type_created
  ON gallery_items(type, created_at, id);

CREATE INDEX idx_gallery_items_uploaded_by
  ON gallery_items(uploaded_by, created_at, id);

CREATE INDEX idx_invite_links_created ON invite_links(created_at, id);

CREATE INDEX idx_invite_links_created_by ON invite_links(created_by);

CREATE INDEX idx_invite_links_role_id ON invite_links(role_id);

CREATE INDEX idx_invite_links_status ON invite_links(revoked_at, expires_at, created_at);

CREATE INDEX idx_login_failures_last_failed_at ON login_failures(last_failed_at);

CREATE INDEX idx_media_assets_expiry
  ON media_assets(expires_at, id) WHERE expires_at IS NOT NULL;

CREATE INDEX idx_media_assets_owner_purpose_state_expiry
  ON media_assets(owner_user_id, purpose, state, expires_at, id);

CREATE INDEX idx_member_absences_end_start ON member_absences(end_date, start_date);

CREATE INDEX idx_member_absences_user_end ON member_absences(user_id, end_date);

CREATE INDEX idx_member_availability_windows_lookup
  ON member_availability_windows(weekday, start_minute, end_minute, user_id);

CREATE INDEX idx_member_badge_assignments_user
  ON member_badge_assignments(user_id);

CREATE INDEX idx_member_badge_assignments_assigned_by
  ON member_badge_assignments(assigned_by);

CREATE INDEX idx_member_badges_sort ON member_badges(sort_order, id);

CREATE INDEX idx_member_profile_classes_class_user
  ON member_profile_classes(class_id, user_id);

CREATE INDEX idx_recurring_template_class_quotas_tag ON recurring_template_class_quotas(tag_id);

CREATE INDEX idx_recurring_template_weekdays_weekday_template
  ON recurring_template_weekdays(weekday, template_id);

CREATE INDEX idx_recurring_templates_active ON recurring_templates(paused, created_at, id);

CREATE INDEX idx_recurring_templates_created_by ON recurring_templates(created_by);

CREATE INDEX idx_role_permissions_permission ON role_permissions(permission);

CREATE INDEX idx_roles_level ON roles(level, id);

CREATE INDEX idx_sessions_created_at
  ON sessions(created_at);

CREATE INDEX idx_sessions_expires_at
  ON sessions(expires_at);

CREATE INDEX idx_sessions_user_expires
  ON sessions(user_id, expires_at);

CREATE INDEX idx_storage_categories_storage ON storage_categories(storage_id);

CREATE UNIQUE INDEX ux_storage_categories_storage_id
  ON storage_categories(storage_id, id);

CREATE UNIQUE INDEX ux_storage_batches_id_actor
  ON storage_batches(id, actor_id);

CREATE INDEX idx_storage_batches_actor_created
  ON storage_batches(actor_id, created_at, id);

CREATE INDEX idx_storage_items_storage_category_name_id
  ON storage_items(storage_id, category_id, name, id);

CREATE INDEX idx_storage_items_storage_name_id
  ON storage_items(storage_id, name, id);

CREATE INDEX idx_storage_transactions_created
  ON storage_transactions(created_at, id);

CREATE INDEX idx_storage_transactions_actor
  ON storage_transactions(actor_id, created_at, id);

CREATE INDEX idx_storage_transactions_item
  ON storage_transactions(item_id, created_at, id);

CREATE INDEX idx_storage_transactions_recipient
  ON storage_transactions(recipient_user_id, created_at, id)
  WHERE recipient_user_id IS NOT NULL;

CREATE UNIQUE INDEX ux_storage_transactions_batch_position
  ON storage_transactions(batch_id, batch_position);

CREATE UNIQUE INDEX ux_storage_transactions_batch_item
  ON storage_transactions(batch_id, item_id);

CREATE INDEX idx_system_test_artifacts_run_type
  ON system_test_artifacts(run_id, artifact_type);

CREATE INDEX idx_system_test_runs_cleanup_lookup
  ON system_test_runs(status, updated_at, id);

CREATE INDEX idx_system_test_runs_actor ON system_test_runs(actor_id);

CREATE INDEX idx_users_deleted_active_created ON users(deleted_at, is_active, created_at, id);

CREATE INDEX idx_users_role_active ON users(role, is_active, deleted_at);

CREATE INDEX idx_war_history_created ON war_history(created_at, id);

CREATE INDEX idx_war_history_created_by ON war_history(created_by);

CREATE INDEX idx_war_history_updated_by ON war_history(updated_by);

CREATE INDEX idx_war_pool_members_event ON war_pool_members(event_id);

CREATE INDEX idx_war_pool_members_user ON war_pool_members(user_id);

CREATE INDEX idx_war_team_members_team_sort ON war_team_members(war_team_id, sort_order, id);

CREATE INDEX idx_war_team_members_user ON war_team_members(user_id);

CREATE INDEX idx_war_teams_event_sort ON war_teams(event_id, sort_order, id);

CREATE INDEX idx_war_teams_history_sort ON war_teams(war_history_id, sort_order, id);

CREATE INDEX idx_wiki_articles_archived_updated ON wiki_articles(archived_at, pinned, updated_at, id);

CREATE INDEX idx_wiki_articles_category_archived_sort ON wiki_articles(category_id, archived_at, pinned, sort_order, updated_at, id);

CREATE INDEX idx_wiki_articles_created_by ON wiki_articles(created_by);

CREATE INDEX idx_wiki_articles_updated_by ON wiki_articles(updated_by);

CREATE INDEX idx_wiki_categories_parent_sort ON wiki_categories(parent_id, sort_order, name, id);

CREATE INDEX idx_wiki_categories_sort ON wiki_categories(sort_order, name, id);

CREATE UNIQUE INDEX uq_wiki_revisions_article_revision ON wiki_revisions(article_id, revision);

CREATE INDEX idx_wiki_revisions_edited_by ON wiki_revisions(edited_by);

CREATE UNIQUE INDEX ux_class_catalog_label_nocase
  ON class_catalog(label COLLATE NOCASE);

CREATE UNIQUE INDEX ux_class_tags_label_nocase
  ON class_tags (label COLLATE NOCASE) WHERE owner_kind IS NULL;

CREATE UNIQUE INDEX ux_event_participants_event_user ON event_participants(event_id, user_id);

CREATE UNIQUE INDEX ux_event_poll_options_event_id ON event_poll_options(event_id, id);

CREATE UNIQUE INDEX ux_event_raffle_winners_event_user ON event_raffle_winners(event_id, user_id);

CREATE UNIQUE INDEX ux_events_series_instance ON events(series_id, instance_date);

CREATE UNIQUE INDEX ux_member_badge_assignments_badge_user
  ON member_badge_assignments(badge_id, user_id);

CREATE UNIQUE INDEX ux_member_profile_classes_user_sort
  ON member_profile_classes(user_id, sort_order);

CREATE UNIQUE INDEX ux_media_links_entity_slot_sort
  ON media_links(entity_type, entity_id, slot, sort_order);

CREATE UNIQUE INDEX ux_member_profile_videos_user_sort
  ON member_profile_videos(user_id, sort_order);

CREATE UNIQUE INDEX ux_users_username_nocase ON users(username COLLATE NOCASE);

CREATE UNIQUE INDEX ux_war_history_event_id ON war_history(event_id);

CREATE UNIQUE INDEX ux_war_pool_members_event_user ON war_pool_members(event_id, user_id);

CREATE UNIQUE INDEX ux_war_pool_members_history_user ON war_pool_members(war_history_id, user_id);

CREATE UNIQUE INDEX ux_war_team_members_team_user ON war_team_members(war_team_id, user_id);

-- ── Seed data ──────────────────────────────────────────────────────

INSERT OR IGNORE INTO "class_catalog" ("id", "label", "color", "icon_type", "vector_icon", "sort_order") VALUES
  ('鸣金虹', '鸣金虹', '#6EA8FE', 'vector', 'sword', 0),
  ('鸣金影', '鸣金影', '#79A7F2', 'vector', 'target-arrow', 10),
  ('牵丝玉', '牵丝玉', '#58C7A6', 'vector', 'sparkles', 20),
  ('牵丝霖', '牵丝霖', '#54C39B', 'vector', 'heartbeat', 30),
  ('牵丝翊', '牵丝翊', '#62BEA7', 'vector', 'pendant', 40),
  ('破竹风', '破竹风', '#A78BFA', 'vector', 'bolt', 50),
  ('破竹尘', '破竹尘', '#9B8AE8', 'vector', 'shield', 60),
  ('破竹鸢', '破竹鸢', '#B18CF1', 'vector', 'target', 70),
  ('裂石威', '裂石威', '#E27676', 'vector', 'shield', 80),
  ('裂石钧', '裂石钧', '#DB7770', 'vector', 'hammer', 90);

INSERT OR IGNORE INTO "roles" ("id", "name", "level", "color") VALUES
  ('admin', 'Admin', 999, 'red'),
  ('moderator', 'Moderator', 500, '#756047'),
  ('member', 'Member', 100, 'gray');

INSERT INTO "site_config" (
  "id", "site_name",
  "feature_announcements_enabled", "feature_events_enabled", "feature_guild_war_enabled",
  "feature_gallery_enabled", "feature_wiki_enabled", "feature_tools_enabled", "feature_storage_enabled",
  "media_site_logo_max_bytes", "media_class_icon_max_bytes", "media_profile_image_max_bytes",
  "media_profile_audio_max_bytes", "media_announcement_image_max_bytes", "media_wiki_image_max_bytes",
  "media_event_image_max_bytes", "media_gallery_image_max_bytes", "media_storage_image_max_bytes",
  "media_profile_quota", "media_announcement_quota", "media_gallery_quota", "media_wiki_quota",
  "storage_images_per_item", "absence_max_span_days", "absence_max_entries_per_user",
  "analytics_reference_duration_minutes", "analytics_kills_weight", "analytics_towers_weight",
  "analytics_base_hp_weight", "analytics_credits_weight", "analytics_distance_weight"
) VALUES (
  'default', 'Infini Guild',
  1, 1, 1, 1, 1, 1, 1,
  2097152, 524288, 5242880, 20971520, 5242880, 5242880, 5242880, 10485760, 5242880,
  10, 10, 20, 10,
  5, 366, 20,
  30, 0.30, 0.10, 0.15, 0.30, 0.15
);

INSERT OR IGNORE INTO "role_permissions" ("role_id", "permission") VALUES
  ('admin', 'admin.users.view'),
  ('admin', 'admin.users.edit'),
  ('admin', 'admin.users.role'),
  ('admin', 'admin.users.activate'),
  ('admin', 'admin.users.delete'),
  ('admin', 'admin.users.password'),
  ('admin', 'admin.invite.view'),
  ('admin', 'admin.invite.manage'),
  ('admin', 'admin.audit.view'),
  ('admin', 'admin.audit.export'),
  ('admin', 'admin.status.view'),
  ('admin', 'admin.roles.view'),
  ('admin', 'admin.roles.manage'),
  ('admin', 'admin.analytics.view'),
  ('admin', 'admin.analytics.manage'),
  ('admin', 'admin.siteConfig.manage'),
  ('admin', 'admin.classes.manage'),
  ('admin', 'guildwar.teams.edit'),
  ('admin', 'guildwar.history.edit'),
  ('admin', 'events.create'),
  ('admin', 'events.edit'),
  ('admin', 'events.archive'),
  ('admin', 'events.delete'),
  ('admin', 'events.templates'),
  ('admin', 'announcements.create'),
  ('admin', 'announcements.edit'),
  ('admin', 'announcements.archive'),
  ('admin', 'announcements.delete'),
  ('admin', 'gallery.upload'),
  ('admin', 'gallery.manage'),
  ('admin', 'gallery.delete'),
  ('admin', 'wiki.articles.create'),
  ('admin', 'wiki.articles.edit'),
  ('admin', 'wiki.articles.archive'),
  ('admin', 'wiki.articles.delete'),
  ('admin', 'wiki.categories.manage'),
  ('admin', 'admin.badges.manage'),
  ('admin', 'admin.storage.structure'),
  ('admin', 'admin.storage.items'),
  ('admin', 'admin.storage.stock'),
  ('moderator', 'admin.users.view'),
  ('moderator', 'admin.users.edit'),
  ('moderator', 'admin.invite.view'),
  ('moderator', 'admin.audit.view'),
  ('moderator', 'admin.status.view'),
  ('moderator', 'admin.roles.view'),
  ('moderator', 'admin.analytics.view'),
  ('moderator', 'guildwar.teams.edit'),
  ('moderator', 'guildwar.history.edit'),
  ('moderator', 'events.create'),
  ('moderator', 'events.edit'),
  ('moderator', 'events.archive'),
  ('moderator', 'events.delete'),
  ('moderator', 'events.templates'),
  ('moderator', 'announcements.create'),
  ('moderator', 'announcements.edit'),
  ('moderator', 'announcements.archive'),
  ('moderator', 'announcements.delete'),
  ('moderator', 'gallery.upload'),
  ('moderator', 'gallery.manage'),
  ('moderator', 'gallery.delete'),
  ('moderator', 'wiki.articles.create'),
  ('moderator', 'wiki.articles.edit'),
  ('moderator', 'wiki.articles.archive'),
  ('moderator', 'wiki.articles.delete'),
  ('moderator', 'wiki.categories.manage'),
  ('member', 'gallery.upload');

PRAGMA foreign_key_check;
