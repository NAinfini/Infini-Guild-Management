-- Release schema upgrade from the immutable v1 baseline.
-- This migration is deliberately data-preserving: tables whose shape or
-- foreign keys changed are rebuilt through complete shadow graphs before any
-- legacy parent is dropped.

PRAGMA defer_foreign_keys = ON;

-- Reject malformed legacy values before mutating any table. Silent coercion
-- would make the migration appear successful while discarding user data.
CREATE TABLE __release_upgrade_guard (
  valid INTEGER NOT NULL CONSTRAINT release_upgrade_guard_valid CHECK (valid = 1)
);

INSERT INTO __release_upgrade_guard (valid)
SELECT 0 FROM member_profiles
WHERE NOT (json_valid(classes) AND json_type(classes) = 'array')
   OR NOT (json_valid(images) AND json_type(images) = 'array')
   OR NOT (json_valid(video_urls) AND json_type(video_urls) = 'array')
   OR (availability IS NOT NULL AND NOT (json_valid(availability) AND json_type(availability) = 'object'))
   OR ((vacation_start IS NULL) <> (vacation_end IS NULL));

INSERT INTO __release_upgrade_guard (valid)
SELECT 0
FROM member_profiles mp
JOIN json_each(mp.classes) item
LEFT JOIN class_catalog catalog ON catalog.id = CAST(item.value AS TEXT)
WHERE item.type <> 'text' OR CAST(item.value AS TEXT) = '' OR catalog.id IS NULL;

INSERT INTO __release_upgrade_guard (valid)
SELECT 0
FROM member_profiles mp
JOIN json_each(mp.images) item
WHERE item.type <> 'text' OR CAST(item.value AS TEXT) = '';

INSERT INTO __release_upgrade_guard (valid)
SELECT 0 FROM member_profile_classes legacy
LEFT JOIN member_profiles profile ON profile.user_id = legacy.user_id
LEFT JOIN class_catalog catalog ON catalog.id = legacy.class
WHERE profile.user_id IS NULL OR catalog.id IS NULL;

INSERT INTO __release_upgrade_guard (valid)
SELECT 0 FROM events
WHERE NOT (json_valid(attachments) AND json_type(attachments) = 'array');

INSERT INTO __release_upgrade_guard (valid)
SELECT 0
FROM events event
JOIN json_each(event.attachments) item
WHERE item.type <> 'text' OR CAST(item.value AS TEXT) = '';

INSERT INTO __release_upgrade_guard (valid)
SELECT 0 FROM recurring_templates
WHERE NOT (json_valid(attachments) AND json_type(attachments) = 'array')
   OR NOT (json_valid(recurrence_rule) AND json_type(recurrence_rule) = 'object');

INSERT INTO __release_upgrade_guard (valid)
SELECT 0
FROM recurring_templates template
JOIN json_each(template.attachments) item
WHERE item.type <> 'text' OR CAST(item.value AS TEXT) = '';

INSERT INTO __release_upgrade_guard (valid)
SELECT 0 FROM announcements
WHERE NOT (json_valid(body_json) AND json_type(body_json) = 'object');

INSERT INTO __release_upgrade_guard (valid)
SELECT 0 FROM war_history
WHERE (own_stats IS NOT NULL AND NOT (json_valid(own_stats) AND json_type(own_stats) = 'object'))
   OR (enemy_stats IS NOT NULL AND NOT (json_valid(enemy_stats) AND json_type(enemy_stats) = 'object'));

INSERT INTO __release_upgrade_guard (valid)
SELECT 0 FROM war_team_members
WHERE stats IS NOT NULL AND NOT (json_valid(stats) AND json_type(stats) = 'object');

INSERT INTO __release_upgrade_guard (valid)
SELECT 0 FROM wiki_articles
WHERE NOT (json_valid(body_json) AND json_type(body_json) = 'object');

INSERT INTO __release_upgrade_guard (valid)
SELECT 0 FROM wiki_revisions
WHERE NOT (json_valid(body_json) AND json_type(body_json) = 'object');

INSERT INTO __release_upgrade_guard (valid)
SELECT 0 FROM site_config
WHERE NOT (json_valid(feature_flags_json) AND json_type(feature_flags_json) = 'object')
   OR NOT (json_valid(media_policy_json) AND json_type(media_policy_json) = 'object')
   OR NOT (json_valid(storage_policy_json) AND json_type(storage_policy_json) = 'object')
   OR NOT (json_valid(absence_policy_json) AND json_type(absence_policy_json) = 'object')
   OR NOT (json_valid(analytics_settings_json) AND json_type(analytics_settings_json) = 'object')
   OR json_type(analytics_settings_json, '$.modifier_weights') IS NOT 'object'
   OR json_type(analytics_settings_json, '$.reference_duration_minutes') NOT IN ('integer', 'real')
   OR json_extract(analytics_settings_json, '$.reference_duration_minutes') <= 0
   OR (
     json_type(analytics_settings_json, '$.modifier_weights.kills') IS NOT NULL
     AND json_type(analytics_settings_json, '$.modifier_weights.kills') NOT IN ('integer', 'real')
   )
   OR (
     json_type(analytics_settings_json, '$.modifier_weights.kda') IS NOT NULL
     AND json_type(analytics_settings_json, '$.modifier_weights.kda') NOT IN ('integer', 'real')
   )
   OR (
     json_type(analytics_settings_json, '$.modifier_weights.towers') IS NOT NULL
     AND json_type(analytics_settings_json, '$.modifier_weights.towers') NOT IN ('integer', 'real')
   )
   OR (
     json_type(analytics_settings_json, '$.modifier_weights.base_hp') IS NOT NULL
     AND json_type(analytics_settings_json, '$.modifier_weights.base_hp') NOT IN ('integer', 'real')
   )
   OR (
     json_type(analytics_settings_json, '$.modifier_weights.basehp') IS NOT NULL
     AND json_type(analytics_settings_json, '$.modifier_weights.basehp') NOT IN ('integer', 'real')
   )
   OR (
     json_type(analytics_settings_json, '$.modifier_weights.credits') IS NOT NULL
     AND json_type(analytics_settings_json, '$.modifier_weights.credits') NOT IN ('integer', 'real')
   )
   OR (
     json_type(analytics_settings_json, '$.modifier_weights.distance') IS NOT NULL
     AND json_type(analytics_settings_json, '$.modifier_weights.distance') NOT IN ('integer', 'real')
   );

DROP TABLE __release_upgrade_guard;

-- The onboarding feature was removed from the runtime, but its historical
-- records remain available for export instead of being discarded.
ALTER TABLE onboarding_config RENAME TO legacy_onboarding_config;
ALTER TABLE member_onboarding_state RENAME TO legacy_member_onboarding_state;

-- ===== CLASS TAGS =====

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

CREATE UNIQUE INDEX ux_class_tags_label_nocase
  ON class_tags (label COLLATE NOCASE) WHERE owner_kind IS NULL;
CREATE INDEX idx_class_tags_sort ON class_tags (sort_order, id);
CREATE INDEX idx_class_tags_owner ON class_tags (owner_kind, owner_id);

CREATE TABLE class_tag_members (
  tag_id TEXT NOT NULL REFERENCES class_tags(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES class_catalog(id) ON DELETE CASCADE,
  PRIMARY KEY (tag_id, class_id)
);

CREATE INDEX idx_class_tag_members_class ON class_tag_members (class_id);

-- ===== MEMBER PROFILE GRAPH =====

-- Legacy vacation columns pre-date member_absences. Avoid duplicating an
-- absence that was already materialized by newer application code.
INSERT OR IGNORE INTO member_absences (id, user_id, start_date, end_date, note, created_at)
SELECT
  'legacy-profile-vacation:' || mp.user_id,
  mp.user_id,
  mp.vacation_start,
  mp.vacation_end,
  'Migrated from member profile vacation fields',
  mp.updated_at
FROM member_profiles mp
WHERE mp.vacation_start IS NOT NULL AND mp.vacation_end IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM member_absences ma
    WHERE ma.user_id = mp.user_id
      AND ma.start_date = mp.vacation_start
      AND ma.end_date = mp.vacation_end
  );

CREATE TABLE __new_member_profiles (
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

CREATE TABLE __new_member_profile_classes (
  user_id TEXT NOT NULL REFERENCES __new_member_profiles(user_id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES class_catalog(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CONSTRAINT member_profile_classes_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (user_id, class_id),
  UNIQUE (user_id, sort_order)
);

CREATE TABLE __new_member_profile_images (
  user_id TEXT NOT NULL REFERENCES __new_member_profiles(user_id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL CONSTRAINT member_profile_images_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (user_id, media_key),
  UNIQUE (user_id, sort_order)
);

INSERT INTO __new_member_profiles (
  id, user_id, power, title_html, bio, avatar_key, audio_key, video_urls,
  availability, notes, created_at, updated_at
)
SELECT
  id,
  user_id,
  power,
  title_html,
  bio,
  avatar_key,
  audio_key,
  video_urls,
  availability,
  notes,
  created_at,
  updated_at
FROM member_profiles;

-- member_profiles.classes is the authoritative legacy source. The old relation
-- is used only as a fallback when the JSON list contains no valid catalog row.
INSERT INTO __new_member_profile_classes (user_id, class_id, sort_order)
SELECT mp.user_id, CAST(item.value AS TEXT), min(CAST(item.key AS INTEGER))
FROM member_profiles mp
JOIN json_each(mp.classes) item
WHERE item.type = 'text' AND CAST(item.value AS TEXT) <> ''
GROUP BY mp.user_id, CAST(item.value AS TEXT);

INSERT OR IGNORE INTO __new_member_profile_classes (user_id, class_id, sort_order)
SELECT
  legacy.user_id,
  legacy.class,
  row_number() OVER (PARTITION BY legacy.user_id ORDER BY legacy.class) - 1
FROM member_profile_classes legacy
WHERE NOT EXISTS (
  SELECT 1 FROM __new_member_profile_classes migrated WHERE migrated.user_id = legacy.user_id
);

INSERT INTO __new_member_profile_images (user_id, media_key, sort_order)
SELECT mp.user_id, CAST(item.value AS TEXT), min(CAST(item.key AS INTEGER))
FROM member_profiles mp
JOIN json_each(mp.images) item
WHERE item.type = 'text' AND CAST(item.value AS TEXT) <> ''
GROUP BY mp.user_id, CAST(item.value AS TEXT);

DROP TABLE member_profile_classes;
DROP TABLE member_profiles;
ALTER TABLE __new_member_profiles RENAME TO member_profiles;
ALTER TABLE __new_member_profile_classes RENAME TO member_profile_classes;
ALTER TABLE __new_member_profile_images RENAME TO member_profile_images;

CREATE INDEX idx_member_profile_classes_class_user
  ON member_profile_classes(class_id, user_id);
CREATE UNIQUE INDEX ux_member_profile_classes_user_sort
  ON member_profile_classes(user_id, sort_order);
CREATE INDEX idx_member_profile_images_media_user
  ON member_profile_images(media_key, user_id);
CREATE UNIQUE INDEX ux_member_profile_images_user_sort
  ON member_profile_images(user_id, sort_order);

CREATE TABLE __new_member_absences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT member_absences_date_range_valid CHECK (start_date <= end_date)
);

INSERT INTO __new_member_absences (id, user_id, start_date, end_date, note, created_at)
SELECT id, user_id, start_date, end_date, note, created_at
FROM member_absences;

DROP TABLE member_absences;
ALTER TABLE __new_member_absences RENAME TO member_absences;
CREATE INDEX idx_member_absences_user_end ON member_absences(user_id, end_date);
CREATE INDEX idx_member_absences_end_start ON member_absences(end_date, start_date);

-- ===== EVENTS, POLLS, AND GUILD-WAR SHADOW GRAPH =====

CREATE TABLE __new_events (
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

CREATE TABLE __new_recurring_templates (
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

CREATE TABLE __new_event_participants (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES __new_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE __new_event_polls (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES __new_events(id) ON DELETE CASCADE,
  results_visibility TEXT NOT NULL DEFAULT 'after_vote' CHECK (results_visibility IN ('always', 'after_vote', 'after_close')),
  show_voter_names INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE __new_event_poll_options (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES __new_events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX __upgrade_event_poll_options_event_id
  ON __new_event_poll_options(event_id, id);

CREATE TABLE __new_event_poll_votes (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES __new_events(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES __new_event_poll_options(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT fk_event_poll_votes_event_option
    FOREIGN KEY (event_id, option_id) REFERENCES __new_event_poll_options(event_id, id) ON DELETE CASCADE
);

CREATE TABLE __new_event_raffle_winners (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES __new_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drawn_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE __new_war_history (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT REFERENCES __new_events(id),
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

CREATE TABLE __new_war_teams (
  id TEXT PRIMARY KEY NOT NULL,
  war_history_id TEXT REFERENCES __new_war_history(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES __new_events(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT war_teams_exactly_one_parent CHECK ((event_id IS NULL) <> (war_history_id IS NULL))
);

CREATE TABLE __new_war_team_members (
  id TEXT PRIMARY KEY NOT NULL,
  war_team_id TEXT NOT NULL REFERENCES __new_war_teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_tag TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  stats TEXT CONSTRAINT war_team_members_stats_json_object CHECK (stats IS NULL OR (json_valid(stats) AND json_type(stats) = 'object')),
  note TEXT
);

CREATE TABLE __new_war_pool_members (
  id TEXT PRIMARY KEY NOT NULL,
  war_history_id TEXT REFERENCES __new_war_history(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES __new_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT war_pool_members_exactly_one_parent CHECK ((event_id IS NULL) <> (war_history_id IS NULL))
);

INSERT INTO __new_events (
  id, type, title, description, start_at, end_at, capacity, pinned,
  signup_locked, visible_at, archived_at, auto_archive, auto_archived,
  created_by, updated_by, series_id, instance_date, winner_count,
  created_at, updated_at
)
SELECT
  id, type, title, description, start_at, end_at, capacity, pinned,
  signup_locked, visible_at, archived_at, auto_archive, auto_archived,
  created_by, updated_by, series_id, instance_date, winner_count,
  created_at, updated_at
FROM events;

INSERT INTO __new_recurring_templates (
  id, type, title, description, start_time, duration_minutes, capacity,
  recurrence_rule, visibility_offset_minutes, auto_archive, paused,
  created_by, last_generated_date, generation_count, created_at, updated_at
)
SELECT
  id, type, title, description, start_time, duration_minutes, capacity,
  recurrence_rule, visibility_offset_minutes, auto_archive, paused,
  created_by, last_generated_date, generation_count, created_at, updated_at
FROM recurring_templates;

INSERT INTO __new_event_participants (id, event_id, user_id, joined_at)
SELECT id, event_id, user_id, joined_at FROM event_participants;

INSERT INTO __new_event_polls (event_id, results_visibility, show_voter_names, created_at, updated_at)
SELECT event_id, results_visibility, show_voter_names, created_at, updated_at FROM event_polls;

INSERT INTO __new_event_poll_options (id, event_id, label, sort_order, created_at)
SELECT id, event_id, label, sort_order, created_at FROM event_poll_options;

INSERT INTO __new_event_poll_votes (id, event_id, option_id, user_id, created_at)
SELECT id, event_id, option_id, user_id, created_at FROM event_poll_votes;

INSERT INTO __new_event_raffle_winners (id, event_id, user_id, drawn_at)
SELECT id, event_id, user_id, drawn_at FROM event_raffle_winners;

INSERT INTO __new_war_history (
  id, event_id, war_name, enemy_name, result, duration_minutes, own_stats,
  enemy_stats, notes, created_by, updated_by, created_at, updated_at
)
SELECT
  id, event_id, war_name, enemy_name, result, duration_minutes, own_stats,
  enemy_stats, notes, created_by, updated_by, created_at, updated_at
FROM war_history;

INSERT INTO __new_war_teams (id, war_history_id, event_id, team_name, sort_order, notes, is_locked)
SELECT id, war_history_id, event_id, team_name, sort_order, notes, is_locked FROM war_teams;

INSERT INTO __new_war_team_members (id, war_team_id, user_id, role_tag, sort_order, stats, note)
SELECT id, war_team_id, user_id, role_tag, sort_order, stats, note FROM war_team_members;

INSERT INTO __new_war_pool_members (id, war_history_id, event_id, user_id)
SELECT id, war_history_id, event_id, user_id FROM war_pool_members;

-- Normalize the two legacy attachment JSON arrays before their parent columns
-- disappear. Duplicate keys retain their first position.
CREATE TABLE __upgrade_event_attachments (
  event_id TEXT NOT NULL,
  media_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (event_id, media_key),
  UNIQUE (event_id, sort_order)
);

INSERT INTO __upgrade_event_attachments (event_id, media_key, sort_order)
SELECT event.id, CAST(item.value AS TEXT), min(CAST(item.key AS INTEGER))
FROM events event
JOIN json_each(event.attachments) item
WHERE item.type = 'text' AND CAST(item.value AS TEXT) <> ''
GROUP BY event.id, CAST(item.value AS TEXT);

CREATE TABLE __upgrade_recurring_attachments (
  template_id TEXT NOT NULL,
  media_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (template_id, media_key),
  UNIQUE (template_id, sort_order)
);

INSERT INTO __upgrade_recurring_attachments (template_id, media_key, sort_order)
SELECT template.id, CAST(item.value AS TEXT), min(CAST(item.key AS INTEGER))
FROM recurring_templates template
JOIN json_each(template.attachments) item
WHERE item.type = 'text' AND CAST(item.value AS TEXT) <> ''
GROUP BY template.id, CAST(item.value AS TEXT);

DROP TABLE event_poll_votes;
DROP TABLE event_raffle_winners;
DROP TABLE event_poll_options;
DROP TABLE event_polls;
DROP TABLE event_participants;
DROP TABLE war_team_members;
DROP TABLE war_pool_members;
DROP TABLE war_teams;
DROP TABLE war_history;
DROP TABLE recurring_templates;
DROP TABLE events;

ALTER TABLE __new_events RENAME TO events;
ALTER TABLE __new_recurring_templates RENAME TO recurring_templates;
ALTER TABLE __new_event_participants RENAME TO event_participants;
ALTER TABLE __new_event_polls RENAME TO event_polls;
ALTER TABLE __new_event_poll_options RENAME TO event_poll_options;
ALTER TABLE __new_event_poll_votes RENAME TO event_poll_votes;
ALTER TABLE __new_event_raffle_winners RENAME TO event_raffle_winners;
ALTER TABLE __new_war_history RENAME TO war_history;
ALTER TABLE __new_war_teams RENAME TO war_teams;
ALTER TABLE __new_war_team_members RENAME TO war_team_members;
ALTER TABLE __new_war_pool_members RENAME TO war_pool_members;

CREATE TABLE event_attachments (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL CONSTRAINT event_attachments_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (event_id, media_key)
);

INSERT INTO event_attachments (event_id, media_key, sort_order)
SELECT event_id, media_key, sort_order FROM __upgrade_event_attachments;
DROP TABLE __upgrade_event_attachments;

CREATE TABLE recurring_template_attachments (
  template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL CONSTRAINT recurring_template_attachments_sort_nonnegative CHECK (sort_order >= 0),
  PRIMARY KEY (template_id, media_key)
);

INSERT INTO recurring_template_attachments (template_id, media_key, sort_order)
SELECT template_id, media_key, sort_order FROM __upgrade_recurring_attachments;
DROP TABLE __upgrade_recurring_attachments;

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
DROP INDEX __upgrade_event_poll_options_event_id;
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

-- ===== JSON-CONSTRAINED CONTENT =====

CREATE TABLE __new_announcements (
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

INSERT INTO __new_announcements (
  id, title, body_json, pinned, status, publish_at, expires_at, archived_at,
  created_by, updated_by, created_at, updated_at
)
SELECT
  id, title, body_json, pinned, status, publish_at, expires_at, archived_at,
  created_by, updated_by, created_at, updated_at
FROM announcements;

DROP TABLE announcements;
ALTER TABLE __new_announcements RENAME TO announcements;
CREATE INDEX idx_announcements_status_pinned_created ON announcements(status, pinned, created_at, id);
CREATE INDEX idx_announcements_schedule ON announcements(status, publish_at);
CREATE INDEX idx_announcements_expiry ON announcements(status, expires_at);

-- Rebuild the entire wiki graph so dropping the old category parent cannot
-- cascade or invalidate articles and revisions.
CREATE TABLE __new_wiki_categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT REFERENCES __new_wiki_categories(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE __new_wiki_articles (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES __new_wiki_categories(id),
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

CREATE TABLE __new_wiki_revisions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES __new_wiki_articles(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  body_json TEXT NOT NULL
    CONSTRAINT wiki_revisions_body_json_object CHECK (json_valid(body_json) AND json_type(body_json) = 'object'),
  edited_by TEXT NOT NULL REFERENCES users(id),
  restored_from INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO __new_wiki_categories (id, name, slug, sort_order, parent_id, created_at, updated_at)
SELECT id, name, slug, sort_order, parent_id, created_at, updated_at FROM wiki_categories;

INSERT INTO __new_wiki_articles (
  id, title, slug, category_id, body_json, sort_order, pinned, archived_at,
  created_by, updated_by, created_at, updated_at
)
SELECT
  id, title, slug, category_id, body_json, sort_order, pinned, archived_at,
  created_by, updated_by, created_at, updated_at
FROM wiki_articles;

INSERT INTO __new_wiki_revisions (
  id, article_id, revision, title, body_json, edited_by, restored_from, created_at
)
SELECT id, article_id, revision, title, body_json, edited_by, restored_from, created_at
FROM wiki_revisions;

DROP TABLE wiki_revisions;
DROP TABLE wiki_articles;
DROP TABLE wiki_categories;
ALTER TABLE __new_wiki_categories RENAME TO wiki_categories;
ALTER TABLE __new_wiki_articles RENAME TO wiki_articles;
ALTER TABLE __new_wiki_revisions RENAME TO wiki_revisions;

CREATE INDEX idx_wiki_categories_parent_sort ON wiki_categories(parent_id, sort_order, name, id);
CREATE INDEX idx_wiki_categories_sort ON wiki_categories(sort_order, name, id);
CREATE INDEX idx_wiki_articles_category_archived_sort ON wiki_articles(category_id, archived_at, pinned, sort_order, updated_at, id);
CREATE INDEX idx_wiki_articles_archived_updated ON wiki_articles(archived_at, pinned, updated_at, id);
CREATE UNIQUE INDEX uq_wiki_revisions_article_revision ON wiki_revisions(article_id, revision);

-- ===== SITE CONFIG =====

CREATE TABLE __new_site_config (
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

INSERT INTO __new_site_config (
  id, site_name, site_logo_url, feature_flags_json, media_policy_json,
  storage_policy_json, absence_policy_json, analytics_settings_json,
  created_at, updated_at
)
SELECT
  id,
  site_name,
  site_logo_url,
  feature_flags_json,
  media_policy_json,
  storage_policy_json,
  absence_policy_json,
  json_object(
    'reference_duration_minutes',
    json_extract(analytics_settings_json, '$.reference_duration_minutes'),
    'modifier_weights',
    json_object(
      'kills', coalesce(
        json_extract(analytics_settings_json, '$.modifier_weights.kills'),
        json_extract(analytics_settings_json, '$.modifier_weights.kda'),
        0.3
      ),
      'towers', coalesce(
        json_extract(analytics_settings_json, '$.modifier_weights.towers'),
        0.1
      ),
      'base_hp', coalesce(
        json_extract(analytics_settings_json, '$.modifier_weights.base_hp'),
        json_extract(analytics_settings_json, '$.modifier_weights.basehp'),
        0.15
      ),
      'credits', coalesce(
        json_extract(analytics_settings_json, '$.modifier_weights.credits'),
        0.3
      ),
      'distance', coalesce(
        json_extract(analytics_settings_json, '$.modifier_weights.distance'),
        0.15
      )
    )
  ),
  created_at,
  updated_at
FROM site_config;

DROP TABLE site_config;
ALTER TABLE __new_site_config RENAME TO site_config;

-- ===== STORAGE LEDGER =====

CREATE TABLE __new_storage_transactions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES storage_items(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CONSTRAINT storage_transactions_type_valid CHECK (type IN ('intake', 'distribute', 'adjust')),
  quantity_delta INTEGER NOT NULL,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO __new_storage_transactions (
  id, item_id, type, quantity_delta, recipient_user_id, note, actor_id, created_at
)
SELECT id, item_id, type, quantity_delta, recipient_user_id, note, actor_id, created_at
FROM storage_transactions;

DROP TABLE storage_transactions;
ALTER TABLE __new_storage_transactions RENAME TO storage_transactions;

DROP INDEX idx_storage_item_images_item;
CREATE INDEX idx_storage_item_images_item ON storage_item_images(item_id, created_at, id);
CREATE INDEX idx_storage_transactions_item ON storage_transactions(item_id, created_at, id);
CREATE INDEX idx_storage_transactions_recipient ON storage_transactions(recipient_user_id, created_at, id) WHERE recipient_user_id IS NOT NULL;
CREATE INDEX idx_storage_transactions_created ON storage_transactions(created_at, id);

-- ===== STABLE-TAIL OPERATIONAL INDEXES =====

DROP INDEX idx_audit_log_created_at;
DROP INDEX idx_audit_log_entity_actor_created;
DROP INDEX idx_audit_log_entity_created;
DROP INDEX idx_audit_log_actor_id;
DROP INDEX idx_audit_log_actor_created;
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at, id);
CREATE INDEX idx_audit_log_entity_actor_created ON audit_log(entity_type, actor_id, created_at, id);
CREATE INDEX idx_audit_log_entity_created ON audit_log(entity_type, created_at, id);
CREATE INDEX idx_audit_log_actor_created ON audit_log(actor_id, created_at, id);

DROP INDEX idx_error_log_created_at;
DROP INDEX idx_error_log_source;
CREATE INDEX idx_error_log_created_at ON error_log(created_at, id);
CREATE INDEX idx_error_log_source_created ON error_log(source, created_at, id);

-- ===== MEDIA REFERENCE LIFECYCLE =====

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

CREATE INDEX idx_media_upload_leases_expiry ON media_upload_leases(expires_at, media_key);

-- Preserve existing rows and add references that can be derived exactly from
-- scalar or normalized legacy fields. Do not mark any domain complete: the
-- resumable application backfill still scans rich-text URLs and site-logo URLs.
INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT avatar_key, 'member_profile', user_id
FROM member_profiles WHERE avatar_key IS NOT NULL AND avatar_key <> '';

INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT audio_key, 'member_profile', user_id
FROM member_profiles WHERE audio_key IS NOT NULL AND audio_key <> '';

INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT media_key, 'member_profile', user_id FROM member_profile_images;

INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT media_key, 'event', event_id FROM event_attachments;

INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT media_key, 'recurring_template', template_id FROM recurring_template_attachments;

INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT url, 'gallery_item', id
FROM gallery_items WHERE type = 'image' AND url <> '';

INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT icon_key, 'class_icon', id
FROM class_catalog WHERE icon_key IS NOT NULL AND icon_key <> '';

INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT r2_key, 'storage_item', item_id
FROM storage_item_images WHERE r2_key <> '';

INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT CAST(node.value AS TEXT), 'announcement', announcement.id
FROM announcements announcement
JOIN json_tree(announcement.body_json) node
WHERE node.type = 'text'
  AND CAST(node.value AS TEXT) LIKE 'announcement/' || announcement.id || '/images/%';

INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT CAST(node.value AS TEXT), 'wiki_article', article.id
FROM wiki_articles article
JOIN json_tree(article.body_json) node
WHERE node.type = 'text'
  AND CAST(node.value AS TEXT) LIKE 'wiki/' || article.id || '/images/%';

INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
SELECT CAST(node.value AS TEXT), 'wiki_article', revision.article_id
FROM wiki_revisions revision
JOIN json_tree(revision.body_json) node
WHERE node.type = 'text'
  AND CAST(node.value AS TEXT) LIKE 'wiki/' || revision.article_id || '/images/%';

PRAGMA defer_foreign_keys = OFF;
PRAGMA foreign_key_check;
