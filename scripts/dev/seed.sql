-- Local development data shared by Cloudflare D1 and VPS SQLite.
-- The first owner is created only for a pristine database. Every later insert
-- depends on that fixed owner, so this file is a no-op for an existing site.

INSERT OR IGNORE INTO users (
  id, username, role_id, is_active, deleted_at, revision_token, created_at, updated_at
)
SELECT
  'dev-owner', 'admin', 'site_owner', 1, NULL, 'dev-owner-user-revision',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM users);
--> statement-breakpoint

INSERT OR IGNORE INTO user_credentials (user_id, password_hash, updated_at)
SELECT
  'dev-owner',
  'pbkdf2-sha256$10000$aW5maW5pLWUyZS1vd25lcg$-VYi6RNWPNIdHw3hXNV9jsMaTTUvgCy-AqKVhQy7kVw',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

WITH seed(id, username, role_id, revision_token, created_offset) AS (
  VALUES
    ('dev-moderator-01', 'moderator_01', 'moderator', 'dev-moderator-01-revision', '-11 minutes'),
    ('dev-member-01', 'member_01', 'member', 'dev-member-01-revision', '-10 minutes'),
    ('dev-member-02', 'member_02', 'member', 'dev-member-02-revision', '-9 minutes'),
    ('dev-member-03', 'member_03', 'member', 'dev-member-03-revision', '-8 minutes'),
    ('dev-member-04', 'member_04', 'member', 'dev-member-04-revision', '-7 minutes'),
    ('dev-member-05', 'member_05', 'member', 'dev-member-05-revision', '-6 minutes'),
    ('dev-member-06', 'member_06', 'member', 'dev-member-06-revision', '-5 minutes'),
    ('dev-member-07', 'member_07', 'member', 'dev-member-07-revision', '-4 minutes'),
    ('dev-member-08', 'member_08', 'member', 'dev-member-08-revision', '-3 minutes')
)
INSERT OR IGNORE INTO users (
  id, username, role_id, is_active, deleted_at, revision_token, created_at, updated_at
)
SELECT
  seed.id, seed.username, seed.role_id, 1, NULL, seed.revision_token,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', seed.created_offset),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', seed.created_offset)
FROM seed
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO user_credentials (user_id, password_hash, updated_at)
SELECT
  id,
  'pbkdf2-sha256$10000$aW5maW5pLWUyZS1vd25lcg$-VYi6RNWPNIdHw3hXNV9jsMaTTUvgCy-AqKVhQy7kVw',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users
WHERE id IN (
  'dev-moderator-01',
  'dev-member-01',
  'dev-member-02',
  'dev-member-03',
  'dev-member-04',
  'dev-member-05',
  'dev-member-06',
  'dev-member-07',
  'dev-member-08'
)
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT INTO invite_links (
  id, token_digest, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at
)
SELECT
  id, token_digest, 'dev-owner', role_id, max_uses, used_count,
  CASE WHEN expires_modifier IS NULL THEN NULL
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', expires_modifier)
  END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', created_modifier),
  CASE WHEN revoked_modifier IS NULL THEN NULL
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', revoked_modifier)
  END
FROM (
  SELECT
    'dev-invite-active' AS id,
    '1111111111111111111111111111111111111111111111111111111111111111' AS token_digest,
    'member' AS role_id, 10 AS max_uses, 2 AS used_count,
    '+14 days' AS expires_modifier, '-2 days' AS created_modifier, NULL AS revoked_modifier
  UNION ALL SELECT
    'dev-invite-expired',
    '2222222222222222222222222222222222222222222222222222222222222222',
    'member', 5, 1, '-1 day', '-10 days', NULL
  UNION ALL SELECT
    'dev-invite-revoked',
    '3333333333333333333333333333333333333333333333333333333333333333',
    'moderator', 3, 0, '+14 days', '-4 days', '-1 hour'
  UNION ALL SELECT
    'dev-invite-used-out',
    '4444444444444444444444444444444444444444444444444444444444444444',
    'member', 2, 2, '+30 days', '-6 days', NULL
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
ON CONFLICT(id) DO UPDATE SET
  token_digest = excluded.token_digest,
  created_by = excluded.created_by,
  role_id = excluded.role_id,
  max_uses = excluded.max_uses,
  used_count = excluded.used_count,
  expires_at = excluded.expires_at,
  created_at = excluded.created_at,
  revoked_at = excluded.revoked_at;
--> statement-breakpoint

INSERT INTO login_failures (username, fail_count, locked_until, last_failed_at)
SELECT
  'member_08', 6,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+10 minutes'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute')
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-member-08')
ON CONFLICT(username) DO UPDATE SET
  fail_count = excluded.fail_count,
  locked_until = excluded.locked_until,
  last_failed_at = excluded.last_failed_at;
--> statement-breakpoint

INSERT OR IGNORE INTO class_catalog (
  id, label, color, icon_type, vector_icon, sort_order, created_at, updated_at
)
SELECT id, label, color, 'vector', vector_icon, sort_order,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT 'dev-class-vanguard' AS id, 'Vanguard' AS label, '#E06C75' AS color, 'shield' AS vector_icon, 0 AS sort_order
  UNION ALL SELECT 'dev-class-blade', 'Blade', '#D19A66', 'swords', 1
  UNION ALL SELECT 'dev-class-mystic', 'Mystic', '#61AFEF', 'sparkles', 2
  UNION ALL SELECT 'dev-class-healer', 'Healer', '#98C379', 'heart', 3
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO class_tags (id, label, sort_order, owner_kind, owner_id, created_at, updated_at)
SELECT id, label, sort_order, NULL, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT 'dev-tag-frontline' AS id, 'Frontline' AS label, 0 AS sort_order
  UNION ALL SELECT 'dev-tag-damage', 'Damage', 1
  UNION ALL SELECT 'dev-tag-support', 'Support', 2
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO class_tag_members (tag_id, class_id)
SELECT tag_id, class_id FROM (
  SELECT 'dev-tag-frontline' AS tag_id, 'dev-class-vanguard' AS class_id
  UNION ALL SELECT 'dev-tag-damage', 'dev-class-blade'
  UNION ALL SELECT 'dev-tag-damage', 'dev-class-mystic'
  UNION ALL SELECT 'dev-tag-support', 'dev-class-healer'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

WITH seed(user_id, power, title_html, bio, revision_token) AS (
  VALUES
    ('dev-owner', 9800, '<strong>Site Owner</strong>', 'Local development administrator.', 'dev-owner-profile-revision'),
    ('dev-moderator-01', 8200, '<strong>War Coordinator</strong>', 'Coordinates events and guild wars.', 'dev-moderator-profile-revision'),
    ('dev-member-01', 7600, NULL, 'Frontline specialist.', 'dev-member-01-profile-revision'),
    ('dev-member-02', 7350, NULL, 'Reliable damage dealer.', 'dev-member-02-profile-revision'),
    ('dev-member-03', 7100, NULL, 'Support and recovery.', 'dev-member-03-profile-revision'),
    ('dev-member-04', 6850, NULL, 'Tactical flex player.', 'dev-member-04-profile-revision'),
    ('dev-member-05', 6600, NULL, 'Guild event regular.', 'dev-member-05-profile-revision'),
    ('dev-member-06', 6300, NULL, 'Ranged specialist.', 'dev-member-06-profile-revision'),
    ('dev-member-07', 6000, NULL, 'Frontline reserve.', 'dev-member-07-profile-revision'),
    ('dev-member-08', 5700, NULL, 'Support reserve.', 'dev-member-08-profile-revision')
)
INSERT OR IGNORE INTO member_profiles (
  user_id, power, title_html, bio, availability_timezone, notes, revision_token, created_at, updated_at
)
SELECT seed.user_id, seed.power, seed.title_html, seed.bio, 'UTC', NULL, seed.revision_token,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM seed
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

WITH seed(user_id, class_id) AS (
  VALUES
    ('dev-owner', 'dev-class-mystic'),
    ('dev-moderator-01', 'dev-class-vanguard'),
    ('dev-member-01', 'dev-class-vanguard'),
    ('dev-member-02', 'dev-class-blade'),
    ('dev-member-03', 'dev-class-healer'),
    ('dev-member-04', 'dev-class-mystic'),
    ('dev-member-05', 'dev-class-blade'),
    ('dev-member-06', 'dev-class-mystic'),
    ('dev-member-07', 'dev-class-vanguard'),
    ('dev-member-08', 'dev-class-healer')
)
INSERT OR IGNORE INTO member_profile_classes (user_id, class_id, sort_order)
SELECT seed.user_id, seed.class_id, 0
FROM seed
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO member_profile_videos (user_id, url, sort_order)
SELECT user_id, url, sort_order
FROM (
  SELECT 'dev-owner' AS user_id, 'https://www.youtube.com/watch?v=ScMzIvxBSi4' AS url, 0 AS sort_order
  UNION ALL SELECT 'dev-moderator-01', 'https://vimeo.com/76979871', 0
  UNION ALL SELECT 'dev-member-02', 'https://www.bilibili.com/video/BV1GJ411x7h7', 0
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO member_availability_windows (user_id, weekday, start_minute, end_minute)
SELECT users.id, weekdays.weekday, 1080, 1380
FROM users
CROSS JOIN (SELECT 5 AS weekday UNION ALL SELECT 6) AS weekdays
WHERE users.id LIKE 'dev-%';
--> statement-breakpoint

INSERT INTO member_absences (id, user_id, start_date, end_date, note, created_at)
SELECT
  'dev-absence-member-08', 'dev-member-08', date('now', '+2 days'), date('now', '+4 days'),
  'Development seed absence', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  note = excluded.note;
--> statement-breakpoint

INSERT OR IGNORE INTO member_badges (
  id, name, label_html, color, description, sort_order, created_at, updated_at
)
SELECT id, name, label_html, color, description, sort_order,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT 'dev-badge-veteran' AS id, 'Veteran' AS name, '<strong>Veteran</strong>' AS label_html,
    '#D6A84B' AS color, 'Long-standing guild member.' AS description, 0 AS sort_order
  UNION ALL SELECT 'dev-badge-war-hero', 'War Hero', '<strong>War Hero</strong>', '#E06C75', 'Recognized guild-war performance.', 1
  UNION ALL SELECT 'dev-badge-contributor', 'Contributor', '<strong>Contributor</strong>', '#61AFEF', 'Consistent guild contribution.', 2
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO member_badge_assignments (badge_id, user_id, assigned_by, assigned_at)
SELECT badge_id, user_id, 'dev-owner', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT 'dev-badge-veteran' AS badge_id, 'dev-moderator-01' AS user_id
  UNION ALL SELECT 'dev-badge-war-hero', 'dev-member-01'
  UNION ALL SELECT 'dev-badge-war-hero', 'dev-member-02'
  UNION ALL SELECT 'dev-badge-contributor', 'dev-member-03'
  UNION ALL SELECT 'dev-badge-contributor', 'dev-member-04'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT INTO announcements (
  id, title, body_json, pinned, status, publish_at, expires_at, archived_at,
  created_by, updated_by, revision_token, created_at, updated_at
)
SELECT
  'dev-announcement-welcome', 'Welcome to the development guild',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"This local database is populated with representative development data."}]},{"type":"image","attrs":{"src":"/api/media/dev-media-00000000019/view","alt":"Development guild hall","title":null}}]}',
  1, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), NULL, NULL,
  'dev-owner', 'dev-owner', 'dev-announcement-welcome-revision',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  body_json = excluded.body_json,
  pinned = excluded.pinned,
  status = excluded.status,
  publish_at = excluded.publish_at,
  expires_at = excluded.expires_at,
  archived_at = excluded.archived_at,
  updated_by = excluded.updated_by,
  revision_token = excluded.revision_token,
  updated_at = excluded.updated_at;
--> statement-breakpoint

INSERT INTO announcements (
  id, title, body_json, pinned, status, publish_at, expires_at, archived_at,
  created_by, updated_by, revision_token, created_at, updated_at
)
SELECT
  'dev-announcement-war', 'Guild war preparation',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Review your team assignment before the upcoming guild war."}]}]}',
  0, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), NULL, NULL,
  'dev-owner', 'dev-moderator-01', 'dev-announcement-war-revision',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  body_json = excluded.body_json,
  pinned = excluded.pinned,
  status = excluded.status,
  publish_at = excluded.publish_at,
  expires_at = excluded.expires_at,
  archived_at = excluded.archived_at,
  updated_by = excluded.updated_by,
  revision_token = excluded.revision_token,
  updated_at = excluded.updated_at;
--> statement-breakpoint

INSERT INTO announcements (
  id, title, body_json, pinned, status, publish_at, expires_at, archived_at,
  created_by, updated_by, revision_token, created_at, updated_at
)
SELECT
  id, title, body_json, pinned, status,
  CASE WHEN publish_modifier IS NULL THEN NULL
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', publish_modifier)
  END,
  CASE WHEN expires_modifier IS NULL THEN NULL
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', expires_modifier)
  END,
  CASE WHEN archived_modifier IS NULL THEN NULL
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', archived_modifier)
  END,
  'dev-owner', updated_by, revision_token,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', created_modifier),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', updated_modifier)
FROM (
  SELECT
    'dev-announcement-draft' AS id,
    'Draft: Event host checklist' AS title,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Review this draft before publishing the event host checklist."}]}]}' AS body_json,
    0 AS pinned, 'draft' AS status, NULL AS publish_modifier, NULL AS expires_modifier,
    NULL AS archived_modifier, 'dev-owner' AS updated_by,
    'dev-announcement-draft-revision' AS revision_token, '-3 hours' AS created_modifier,
    '-3 hours' AS updated_modifier
  UNION ALL SELECT
    'dev-announcement-scheduled', 'Scheduled: Weekend callout',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"This announcement is scheduled to publish before the weekend event."}]}]}',
    0, 'scheduled', '+2 days', '+9 days', NULL, 'dev-moderator-01',
    'dev-announcement-scheduled-revision', '-1 day', '-2 hours'
  UNION ALL SELECT
    'dev-announcement-archived', 'Archived: Previous season summary',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"This archived announcement preserves the previous season summary."}]}]}',
    0, 'archived', '-9 days', '-6 days', '-5 days', 'dev-owner',
    'dev-announcement-archived-revision', '-10 days', '-5 days'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  body_json = excluded.body_json,
  pinned = excluded.pinned,
  status = excluded.status,
  publish_at = excluded.publish_at,
  expires_at = excluded.expires_at,
  archived_at = excluded.archived_at,
  updated_by = excluded.updated_by,
  revision_token = excluded.revision_token,
  updated_at = excluded.updated_at;
--> statement-breakpoint

INSERT OR IGNORE INTO recurring_templates (
  id, type, title, description, start_time, duration_minutes, capacity,
  recurrence_frequency, recurrence_interval, recurrence_day_of_month,
  recurrence_end_after, recurrence_end_at, visibility_offset_minutes,
  auto_archive, paused, created_by, last_generated_date, generation_count,
  created_at, updated_at
)
SELECT
  id, type, title, description, start_time, duration_minutes, capacity,
  recurrence_frequency, recurrence_interval, NULL, NULL, NULL, visibility_offset_minutes,
  auto_archive, paused, 'dev-owner', last_generated_date, generation_count,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', created_modifier),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', created_modifier)
FROM (
  SELECT
    'dev-template-weekly' AS id, 'weekly_mission' AS type,
    'Weekly Mission Rotation' AS title, 'Recurring development weekly mission.' AS description,
    '19:30' AS start_time, 120 AS duration_minutes, 20 AS capacity,
    'weekly' AS recurrence_frequency, 1 AS recurrence_interval,
    60 AS visibility_offset_minutes, 1 AS auto_archive, 0 AS paused,
    date('now', '-7 days') AS last_generated_date, 1 AS generation_count,
    '-14 days' AS created_modifier
  UNION ALL SELECT
    'dev-template-social-paused', 'social', 'Monthly Social Pause Example',
    'Paused recurrence for administration controls.', '20:00', 90, 30,
    'weekly', 2, 30, 0, 1,
    NULL, 0, '-20 days'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO recurring_template_weekdays (template_id, weekday)
SELECT template_id, weekday
FROM (
  SELECT 'dev-template-weekly' AS template_id, 2 AS weekday
  UNION ALL SELECT 'dev-template-weekly', 5
  UNION ALL SELECT 'dev-template-social-paused', 6
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO recurring_template_class_quotas (template_id, tag_id, required)
SELECT template_id, tag_id, required
FROM (
  SELECT 'dev-template-weekly' AS template_id, 'dev-tag-frontline' AS tag_id, 2 AS required
  UNION ALL SELECT 'dev-template-weekly', 'dev-tag-support', 1
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

WITH seed(id, type, title, description, start_modifier, end_modifier, capacity, pinned) AS (
  VALUES
    ('dev-event-weekly', 'weekly_mission', 'Weekly Mission', 'Complete the weekly guild objectives.', '+1 day', '+1 day +2 hours', 20, 1),
    ('dev-event-social', 'social', 'Guild Social Night', 'A relaxed social event for all members.', '+3 days', '+3 days +2 hours', 30, 0),
    ('dev-event-war-active', 'guild_war', 'Guild War: Crimson Tide', 'Active development guild war.', '+2 hours', '+5 hours', 20, 1),
    ('dev-event-war-history-1', 'guild_war', 'Guild War: Shadow Legion', 'Completed development guild war.', '-8 days', '+1 day', 20, 0),
    ('dev-event-war-history-2', 'guild_war', 'Guild War: Iron Vanguard', 'Completed development guild war.', '-15 days', '+1 day', 20, 0),
    ('dev-event-war-history-3', 'guild_war', 'Guild War: Frost Reapers', 'Completed draw development guild war.', '-22 days', '+1 day', 20, 0)
)
INSERT INTO events (
  id, type, title, description, start_at, end_at, capacity, pinned, signup_locked,
  auto_archive, auto_archived, visible_at, archived_at, created_by, updated_by,
  series_id, instance_date, winner_count, created_at, updated_at
)
SELECT
  seed.id, seed.type, seed.title, seed.description,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', seed.start_modifier),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', seed.end_modifier),
  seed.capacity, seed.pinned, 0, 0, 0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), NULL,
  'dev-owner', 'dev-owner', NULL, NULL, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM seed
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
ON CONFLICT(id) DO UPDATE SET
  type = excluded.type,
  title = excluded.title,
  description = excluded.description,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  capacity = excluded.capacity,
  pinned = excluded.pinned,
  signup_locked = excluded.signup_locked,
  auto_archive = excluded.auto_archive,
  auto_archived = excluded.auto_archived,
  visible_at = excluded.visible_at,
  archived_at = excluded.archived_at,
  updated_by = excluded.updated_by,
  series_id = excluded.series_id,
  instance_date = excluded.instance_date,
  winner_count = excluded.winner_count,
  updated_at = excluded.updated_at;
--> statement-breakpoint

WITH seed(
  id, type, title, description, start_modifier, duration_minutes, capacity, pinned,
  signup_locked, auto_archive, visible_modifier, series_id, instance_date_modifier, winner_count
) AS (
  VALUES
    (
      'dev-event-poll', 'poll', 'Guild Schedule Poll',
      'Choose the preferred time for the next guild session.', '-1 day', 4320, NULL, 0,
      0, 0, '-2 days', NULL, NULL, NULL
    ),
    (
      'dev-event-raffle', 'raffle', 'Weekly Supply Raffle',
      'Closed development raffle with recorded winners.', '-6 days', 10080, 12, 1,
      1, 1, '-7 days', NULL, NULL, 2
    ),
    (
      'dev-event-other', 'other', 'Strategy Workshop',
      'Open-format guild strategy workshop.', '+4 days', 90, 12, 0,
      0, 0, '-1 day', NULL, NULL, NULL
    ),
    (
      'dev-event-template-instance', 'weekly_mission', 'Weekly Mission Rotation',
      'Upcoming instance generated from the recurring template.', '+7 days', 120, 20, 0,
      0, 1, '+6 days', 'dev-template-weekly', '+7 days', NULL
    )
)
INSERT INTO events (
  id, type, title, description, start_at, end_at, capacity, pinned, signup_locked,
  auto_archive, auto_archived, visible_at, archived_at, created_by, updated_by,
  series_id, instance_date, winner_count, created_at, updated_at
)
SELECT
  id, type, title, description,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', start_modifier),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', start_modifier, '+' || duration_minutes || ' minutes'),
  capacity, pinned, signup_locked, auto_archive, 0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', visible_modifier), NULL,
  'dev-owner', 'dev-owner', series_id,
  CASE WHEN instance_date_modifier IS NULL THEN NULL ELSE date('now', instance_date_modifier) END,
  winner_count,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM seed
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
ON CONFLICT(id) DO UPDATE SET
  type = excluded.type,
  title = excluded.title,
  description = excluded.description,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  capacity = excluded.capacity,
  pinned = excluded.pinned,
  signup_locked = excluded.signup_locked,
  auto_archive = excluded.auto_archive,
  auto_archived = excluded.auto_archived,
  visible_at = excluded.visible_at,
  archived_at = excluded.archived_at,
  updated_by = excluded.updated_by,
  series_id = excluded.series_id,
  instance_date = excluded.instance_date,
  winner_count = excluded.winner_count,
  updated_at = excluded.updated_at;
--> statement-breakpoint

INSERT OR IGNORE INTO event_class_quotas (event_id, tag_id, required)
SELECT event_id, tag_id, required
FROM (
  SELECT 'dev-event-weekly' AS event_id, 'dev-tag-frontline' AS tag_id, 2 AS required
  UNION ALL SELECT 'dev-event-other', 'dev-tag-support', 1
  UNION ALL SELECT 'dev-event-raffle', 'dev-tag-damage', 1
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

WITH event_ids(event_id) AS (
  VALUES
    ('dev-event-war-active'),
    ('dev-event-war-history-1'),
    ('dev-event-war-history-2'),
    ('dev-event-war-history-3')
), user_ids(user_id) AS (
  VALUES
    ('dev-moderator-01'),
    ('dev-member-01'),
    ('dev-member-02'),
    ('dev-member-03'),
    ('dev-member-04'),
    ('dev-member-05'),
    ('dev-member-06'),
    ('dev-member-07')
), participants(event_id, user_id) AS (
  SELECT event_ids.event_id, user_ids.user_id
  FROM event_ids
  CROSS JOIN user_ids
)
INSERT OR IGNORE INTO event_participants (id, event_id, user_id, joined_at)
SELECT
  'dev-participant-' || replace(participants.event_id, 'dev-event-', '') || '-' || replace(participants.user_id, 'dev-', ''),
  participants.event_id, participants.user_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM participants
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
  AND NOT EXISTS (
    SELECT 1
    FROM event_participants AS existing
    WHERE existing.event_id = participants.event_id
      AND existing.user_id = participants.user_id
  );
--> statement-breakpoint

WITH participants(event_id, user_id) AS (
  VALUES
    ('dev-event-weekly', 'dev-member-01'),
    ('dev-event-weekly', 'dev-member-02'),
    ('dev-event-weekly', 'dev-member-03'),
    ('dev-event-social', 'dev-member-03'),
    ('dev-event-social', 'dev-member-04'),
    ('dev-event-social', 'dev-member-05'),
    ('dev-event-other', 'dev-member-05'),
    ('dev-event-other', 'dev-member-06'),
    ('dev-event-template-instance', 'dev-member-01'),
    ('dev-event-template-instance', 'dev-member-08'),
    ('dev-event-raffle', 'dev-member-02'),
    ('dev-event-raffle', 'dev-member-03'),
    ('dev-event-raffle', 'dev-member-04'),
    ('dev-event-raffle', 'dev-member-05')
)
INSERT OR IGNORE INTO event_participants (id, event_id, user_id, joined_at)
SELECT
  'dev-participant-' || replace(event_id, 'dev-event-', '') || '-' || replace(user_id, 'dev-', ''),
  event_id, user_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')
FROM participants
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
  AND NOT EXISTS (
    SELECT 1
    FROM event_participants AS existing
    WHERE existing.event_id = participants.event_id
      AND existing.user_id = participants.user_id
  );
--> statement-breakpoint

INSERT OR IGNORE INTO event_polls (event_id, results_visibility, show_voter_names, created_at, updated_at)
SELECT
  'dev-event-poll', 'after_vote', 1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO event_poll_options (id, event_id, label, sort_order, created_at)
SELECT id, 'dev-event-poll', label, sort_order, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
FROM (
  SELECT 'dev-poll-option-weekday' AS id, 'Weekday evening' AS label, 0 AS sort_order
  UNION ALL SELECT 'dev-poll-option-weekend', 'Weekend afternoon', 1
  UNION ALL SELECT 'dev-poll-option-late', 'Late-night practice', 2
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO event_poll_votes (event_id, option_id, user_id, created_at)
SELECT event_id, option_id, user_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 hours')
FROM (
  SELECT 'dev-event-poll' AS event_id, 'dev-poll-option-weekday' AS option_id, 'dev-member-01' AS user_id
  UNION ALL SELECT 'dev-event-poll', 'dev-poll-option-weekday', 'dev-member-02'
  UNION ALL SELECT 'dev-event-poll', 'dev-poll-option-weekend', 'dev-member-03'
  UNION ALL SELECT 'dev-event-poll', 'dev-poll-option-late', 'dev-member-04'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO event_raffle_draws (event_id, winner_count, drawn_by, drawn_at, mutation_token)
SELECT
  'dev-event-raffle', 2, 'dev-moderator-01',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), 'dev-raffle-draw-mutation-token'
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO event_raffle_winners (id, event_id, user_id, drawn_at)
SELECT id, 'dev-event-raffle', user_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days')
FROM (
  SELECT 'dev-raffle-winner-member-02' AS id, 'dev-member-02' AS user_id
  UNION ALL SELECT 'dev-raffle-winner-member-03', 'dev-member-03'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

UPDATE events
SET
  end_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'),
  archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'),
  auto_archived = 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'dev-event-raffle'
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO wiki_categories (
  id, name, slug, sort_order, parent_id, revision_token, created_at, updated_at
)
SELECT id, name, slug, sort_order, NULL, revision_token,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT 'dev-wiki-category-guides' AS id, 'Guides' AS name, 'dev-guides' AS slug, 0 AS sort_order,
    'dev-wiki-guides-revision' AS revision_token
  UNION ALL SELECT 'dev-wiki-category-rules', 'Guild Rules', 'dev-guild-rules', 1, 'dev-wiki-rules-revision'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO wiki_articles (
  id, title, slug, category_id, body_json, sort_order, pinned, archived_at, deleted_at,
  created_by, updated_by, current_revision, revision_token, created_at, updated_at
)
SELECT id, title, slug, category_id, body_json, sort_order, pinned, NULL, NULL,
  'dev-owner', 'dev-owner', 1, revision_token,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT 'dev-wiki-article-start' AS id, 'Getting Started' AS title, 'dev-getting-started' AS slug,
    'dev-wiki-category-guides' AS category_id,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Use this development wiki article to test reading, editing, revision history, and restore."}]}]}' AS body_json,
    0 AS sort_order, 1 AS pinned, 'dev-wiki-start-revision' AS revision_token
  UNION ALL
  SELECT 'dev-wiki-article-conduct', 'Code of Conduct', 'dev-code-of-conduct',
    'dev-wiki-category-rules',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Treat guild members with respect and keep collaboration constructive."}]}]}',
    0, 0, 'dev-wiki-conduct-revision'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO wiki_revisions (
  id, article_id, revision, title, slug, category_id, body_json, sort_order, pinned,
  archived_at, deleted_at, edited_by, restored_from, created_at
)
SELECT
  'dev-revision-' || article.id, article.id, article.current_revision, article.title, article.slug,
  article.category_id, article.body_json, article.sort_order, article.pinned,
  article.archived_at, article.deleted_at, 'dev-owner', NULL, article.created_at
FROM wiki_articles AS article
WHERE article.id IN ('dev-wiki-article-start', 'dev-wiki-article-conduct')
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO wiki_articles (
  id, title, slug, category_id, body_json, sort_order, pinned, archived_at, deleted_at,
  created_by, updated_by, current_revision, revision_token, created_at, updated_at
)
SELECT
  'dev-wiki-article-war-playbook', 'Guild War Playbook', 'dev-guild-war-playbook',
  'dev-wiki-category-guides',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Begin every guild war by confirming the roster and objectives."}]},{"type":"image","attrs":{"src":"/api/media/dev-media-00000000020/view","alt":"Guild war strategy","title":null}}]}',
  1, 0, NULL, NULL, 'dev-owner', 'dev-owner', 1,
  'dev-wiki-playbook-revision-v1',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days')
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT INTO wiki_revisions (
  id, article_id, revision, title, slug, category_id, body_json, sort_order, pinned,
  archived_at, deleted_at, edited_by, restored_from, created_at
)
SELECT
  'dev-revision-war-playbook-1', article.id, 1, article.title, article.slug, article.category_id,
  article.body_json, article.sort_order, article.pinned, article.archived_at, article.deleted_at,
  'dev-owner', NULL, article.created_at
FROM wiki_articles AS article
WHERE article.id = 'dev-wiki-article-war-playbook'
  AND article.current_revision = 1
  AND NOT EXISTS (SELECT 1 FROM wiki_revisions WHERE id = 'dev-revision-war-playbook-1');
--> statement-breakpoint

UPDATE wiki_articles
SET
  body_json = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Confirm the roster, objectives, and reserve pool before every guild war."}]},{"type":"image","attrs":{"src":"/api/media/dev-media-00000000020/view","alt":"Guild war strategy","title":null}}]}',
  current_revision = 2,
  updated_by = 'dev-moderator-01',
  revision_token = 'dev-wiki-playbook-revision-v2',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')
WHERE id = 'dev-wiki-article-war-playbook'
  AND current_revision = 1;
--> statement-breakpoint

INSERT INTO wiki_revisions (
  id, article_id, revision, title, slug, category_id, body_json, sort_order, pinned,
  archived_at, deleted_at, edited_by, restored_from, created_at
)
SELECT
  'dev-revision-war-playbook-2', article.id, 2, article.title, article.slug, article.category_id,
  article.body_json, article.sort_order, article.pinned, article.archived_at, article.deleted_at,
  'dev-moderator-01', NULL, article.updated_at
FROM wiki_articles AS article
WHERE article.id = 'dev-wiki-article-war-playbook'
  AND article.current_revision = 2
  AND NOT EXISTS (SELECT 1 FROM wiki_revisions WHERE id = 'dev-revision-war-playbook-2');
--> statement-breakpoint

UPDATE wiki_articles
SET
  body_json = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Begin every guild war by confirming the roster and objectives."}]},{"type":"image","attrs":{"src":"/api/media/dev-media-00000000020/view","alt":"Guild war strategy","title":null}}]}',
  current_revision = 3,
  updated_by = 'dev-owner',
  revision_token = 'dev-wiki-playbook-revision-v3',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
WHERE id = 'dev-wiki-article-war-playbook'
  AND current_revision = 2;
--> statement-breakpoint

INSERT INTO wiki_revisions (
  id, article_id, revision, title, slug, category_id, body_json, sort_order, pinned,
  archived_at, deleted_at, edited_by, restored_from, created_at
)
SELECT
  'dev-revision-war-playbook-3', article.id, 3, article.title, article.slug, article.category_id,
  article.body_json, article.sort_order, article.pinned, article.archived_at, article.deleted_at,
  'dev-owner', 1, article.updated_at
FROM wiki_articles AS article
WHERE article.id = 'dev-wiki-article-war-playbook'
  AND article.current_revision = 3
  AND NOT EXISTS (SELECT 1 FROM wiki_revisions WHERE id = 'dev-revision-war-playbook-3');
--> statement-breakpoint

INSERT OR IGNORE INTO wiki_articles (
  id, title, slug, category_id, body_json, sort_order, pinned, archived_at, deleted_at,
  created_by, updated_by, current_revision, revision_token, created_at, updated_at
)
SELECT
  'dev-wiki-article-archived', 'Retired Strategy', 'dev-retired-strategy',
  'dev-wiki-category-rules',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"This retired strategy remains available to administrators for reference."}]}]}',
  1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 days'), NULL,
  'dev-owner', 'dev-owner', 1, 'dev-wiki-archived-revision',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 days')
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT INTO wiki_revisions (
  id, article_id, revision, title, slug, category_id, body_json, sort_order, pinned,
  archived_at, deleted_at, edited_by, restored_from, created_at
)
SELECT
  'dev-revision-archived-strategy-1', article.id, 1, article.title, article.slug, article.category_id,
  article.body_json, article.sort_order, article.pinned, article.archived_at, article.deleted_at,
  'dev-owner', NULL, article.created_at
FROM wiki_articles AS article
WHERE article.id = 'dev-wiki-article-archived'
  AND article.current_revision = 1
  AND NOT EXISTS (SELECT 1 FROM wiki_revisions WHERE id = 'dev-revision-archived-strategy-1');
--> statement-breakpoint

INSERT OR IGNORE INTO storages (id, name, description, created_at)
SELECT 'dev-storage-main', 'Guild Storage', 'Shared development inventory.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO storage_categories (id, storage_id, name, created_at)
SELECT id, 'dev-storage-main', name, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT 'dev-storage-category-materials' AS id, 'Materials' AS name
  UNION ALL SELECT 'dev-storage-category-consumables', 'Consumables'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO storage_items (
  id, storage_id, category_id, name, description, allow_member_deposit, allow_member_withdraw, created_at, updated_at
)
SELECT id, 'dev-storage-main', category_id, name, description, deposit, withdraw,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT 'dev-storage-item-crystal' AS id, 'dev-storage-category-materials' AS category_id,
    'Refined Crystal' AS name, 'A common guild crafting material.' AS description, 1 AS deposit, 1 AS withdraw
  UNION ALL SELECT 'dev-storage-item-ore', 'dev-storage-category-materials', 'Star Ore', 'Rare construction material.', 1, 0
  UNION ALL SELECT 'dev-storage-item-potion', 'dev-storage-category-consumables', 'Recovery Potion', 'Shared event consumable.', 1, 1
  UNION ALL SELECT 'dev-storage-item-token', 'dev-storage-category-consumables', 'Guild Token', 'Administrative guild currency.', 0, 0
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO storage_batches (
  id, actor_id, idempotency_key, access_mode, transaction_type, recipient_user_id, note, created_at
)
SELECT
  'dev-storage-opening-batch', 'dev-owner', 'dev-seed-opening-stock', 'stock_admin', 'intake', NULL,
  'Development opening stock', '2026-01-01T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO storage_ledger_entries (
  id, item_id, batch_id, batch_position, type, quantity_delta, recipient_user_id, note, actor_id, created_at
)
SELECT id, item_id, 'dev-storage-opening-batch', position, 'intake', quantity, NULL,
  'Development opening stock', 'dev-owner', '2026-01-01T00:00:00.000Z'
FROM (
  SELECT 'dev-ledger-crystal' AS id, 'dev-storage-item-crystal' AS item_id, 0 AS position, 240 AS quantity
  UNION ALL SELECT 'dev-ledger-ore', 'dev-storage-item-ore', 1, 80
  UNION ALL SELECT 'dev-ledger-potion', 'dev-storage-item-potion', 2, 150
  UNION ALL SELECT 'dev-ledger-token', 'dev-storage-item-token', 3, 1200
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO storage_batches (
  id, actor_id, idempotency_key, access_mode, transaction_type, recipient_user_id, note, created_at
)
SELECT id, actor_id, idempotency_key, access_mode, transaction_type, recipient_user_id, note, created_at
FROM (
  SELECT
    'dev-storage-member-intake-batch' AS id, 'dev-member-01' AS actor_id,
    'dev-seed-member-intake-01' AS idempotency_key, 'member_self' AS access_mode,
    'intake' AS transaction_type, 'dev-member-01' AS recipient_user_id,
    'Member self-service deposit' AS note, '2026-01-02T12:00:00.000Z' AS created_at
  UNION ALL SELECT
    'dev-storage-distribute-batch', 'dev-owner', 'dev-seed-distribute-01', 'stock_admin',
    'distribute', 'dev-member-02', 'Development reward distribution', '2026-01-03T12:00:00.000Z'
  UNION ALL SELECT
    'dev-storage-adjust-batch', 'dev-moderator-01', 'dev-seed-adjustment-01', 'stock_admin',
    'adjust', NULL, 'Development inventory correction', '2026-01-04T12:00:00.000Z'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO storage_ledger_entries (
  id, item_id, batch_id, batch_position, type, quantity_delta, recipient_user_id, note, actor_id, created_at
)
SELECT id, item_id, batch_id, batch_position, type, quantity_delta, recipient_user_id, note, actor_id, created_at
FROM (
  SELECT
    'dev-ledger-member-intake' AS id, 'dev-storage-item-crystal' AS item_id,
    'dev-storage-member-intake-batch' AS batch_id, 0 AS batch_position,
    'intake' AS type, 12.5 AS quantity_delta, 'dev-member-01' AS recipient_user_id,
    'Member self-service deposit' AS note, 'dev-member-01' AS actor_id,
    '2026-01-02T12:00:00.000Z' AS created_at
  UNION ALL SELECT
    'dev-ledger-distribute-potion', 'dev-storage-item-potion', 'dev-storage-distribute-batch', 0,
    'distribute', -5.0, 'dev-member-02', 'Development reward distribution', 'dev-owner',
    '2026-01-03T12:00:00.000Z'
  UNION ALL SELECT
    'dev-ledger-adjust-ore', 'dev-storage-item-ore', 'dev-storage-adjust-batch', 0,
    'adjust', 4.0, NULL, 'Development inventory correction', 'dev-moderator-01',
    '2026-01-04T12:00:00.000Z'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO guild_wars (
  id, event_id, status, war_name, enemy_name, result, own_kills, own_towers, own_base_hp,
  own_credits, own_distance, enemy_kills, enemy_towers, enemy_base_hp, enemy_credits,
  enemy_distance, duration_minutes, notes, roster_version, mutation_token, concluded_at,
  created_by, updated_by, created_at, updated_at
)
SELECT id, event_id, 'active', war_name, enemy_name, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, notes, 0, NULL, NULL, 'dev-owner', 'dev-owner',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT 'dev-war-active' AS id, 'dev-event-war-active' AS event_id, 'Crimson Tide' AS war_name,
    'Crimson Tide' AS enemy_name, 'Active development board' AS notes
  UNION ALL SELECT 'dev-war-history-1', 'dev-event-war-history-1', 'Shadow Legion', 'Shadow Legion', 'Completed development war'
  UNION ALL SELECT 'dev-war-history-2', 'dev-event-war-history-2', 'Iron Vanguard', 'Iron Vanguard', 'Completed development war'
  UNION ALL SELECT 'dev-war-history-3', 'dev-event-war-history-3', 'Frost Reapers', 'Frost Reapers', 'Completed draw development war'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

WITH teams(id, war_id, team_name, sort_order) AS (
  VALUES
    ('dev-team-active-a', 'dev-war-active', 'Team A', 0),
    ('dev-team-active-b', 'dev-war-active', 'Team B', 1),
    ('dev-team-history-1-a', 'dev-war-history-1', 'Team A', 0),
    ('dev-team-history-1-b', 'dev-war-history-1', 'Team B', 1),
    ('dev-team-history-2-a', 'dev-war-history-2', 'Team A', 0),
    ('dev-team-history-2-b', 'dev-war-history-2', 'Team B', 1),
    ('dev-team-history-3-a', 'dev-war-history-3', 'Team A', 0),
    ('dev-team-history-3-b', 'dev-war-history-3', 'Team B', 1)
)
INSERT OR IGNORE INTO war_teams (id, war_id, team_name, sort_order, notes, is_locked)
SELECT teams.id, teams.war_id, teams.team_name, teams.sort_order, NULL, 0
FROM teams
JOIN guild_wars ON guild_wars.id = teams.war_id AND guild_wars.status = 'active'
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

UPDATE war_teams
SET is_locked = 1
WHERE id = 'dev-team-active-a'
  AND EXISTS (SELECT 1 FROM guild_wars WHERE id = 'dev-war-active' AND status = 'active');
--> statement-breakpoint

WITH wars(war_id, team_a, team_b) AS (
  VALUES
    ('dev-war-active', 'dev-team-active-a', 'dev-team-active-b'),
    ('dev-war-history-1', 'dev-team-history-1-a', 'dev-team-history-1-b'),
    ('dev-war-history-2', 'dev-team-history-2-a', 'dev-team-history-2-b'),
    ('dev-war-history-3', 'dev-team-history-3-a', 'dev-team-history-3-b')
), members(user_id, position) AS (
  VALUES
    ('dev-moderator-01', 0), ('dev-member-01', 1), ('dev-member-02', 2), ('dev-member-03', 3),
    ('dev-member-04', 4), ('dev-member-05', 5), ('dev-member-06', 6), ('dev-member-07', 7)
)
INSERT OR IGNORE INTO war_members (
  id, war_id, team_id, user_id, role_tag, sort_order, kills, deaths, assists,
  damage, healing, building_damage, credits, damage_taken, note
)
SELECT
  'dev-war-member-' || replace(wars.war_id, 'dev-war-', '') || '-' || replace(members.user_id, 'dev-', ''),
  wars.war_id,
  CASE
    WHEN wars.war_id = 'dev-war-active' AND members.position = 7 THEN NULL
    WHEN members.position < 4 THEN wars.team_a
    ELSE wars.team_b
  END,
  members.user_id,
  CASE WHEN members.position IN (0, 4) THEN 'Leader' ELSE NULL END,
  members.position % 4,
  CASE WHEN wars.war_id = 'dev-war-active' THEN NULL ELSE 3 + members.position END,
  CASE WHEN wars.war_id = 'dev-war-active' THEN NULL ELSE 1 + (members.position % 3) END,
  CASE WHEN wars.war_id = 'dev-war-active' THEN NULL ELSE 2 + members.position END,
  CASE WHEN wars.war_id = 'dev-war-active' THEN NULL ELSE 12000 + members.position * 900 END,
  CASE WHEN wars.war_id = 'dev-war-active' THEN NULL ELSE 2500 + members.position * 350 END,
  CASE WHEN wars.war_id = 'dev-war-active' THEN NULL ELSE 700 + members.position * 80 END,
  CASE WHEN wars.war_id = 'dev-war-active' THEN NULL ELSE 400 + members.position * 25 END,
  CASE WHEN wars.war_id = 'dev-war-active' THEN NULL ELSE 9000 + members.position * 500 END,
  NULL
FROM wars
CROSS JOIN members
JOIN guild_wars ON guild_wars.id = wars.war_id AND guild_wars.status = 'active'
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

UPDATE guild_wars
SET status = 'concluded',
    result = CASE id
      WHEN 'dev-war-history-1' THEN 'win'
      WHEN 'dev-war-history-2' THEN 'loss'
      ELSE 'draw'
    END,
    own_kills = CASE id WHEN 'dev-war-history-1' THEN 38 WHEN 'dev-war-history-2' THEN 24 ELSE 30 END,
    enemy_kills = CASE id WHEN 'dev-war-history-1' THEN 27 WHEN 'dev-war-history-2' THEN 34 ELSE 30 END,
    own_towers = CASE id WHEN 'dev-war-history-1' THEN 5 WHEN 'dev-war-history-2' THEN 3 ELSE 4 END,
    enemy_towers = CASE id WHEN 'dev-war-history-1' THEN 3 WHEN 'dev-war-history-2' THEN 5 ELSE 4 END,
    own_base_hp = CASE id WHEN 'dev-war-history-1' THEN 42 WHEN 'dev-war-history-2' THEN 0 ELSE 18 END,
    enemy_base_hp = CASE id WHEN 'dev-war-history-1' THEN 0 WHEN 'dev-war-history-2' THEN 31 ELSE 18 END,
    duration_minutes = CASE id WHEN 'dev-war-history-1' THEN 46 WHEN 'dev-war-history-2' THEN 52 ELSE 49 END,
    concluded_at = CASE id
      WHEN 'dev-war-history-1' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
      WHEN 'dev-war-history-2' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days')
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-21 days')
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN ('dev-war-history-1', 'dev-war-history-2', 'dev-war-history-3') AND status = 'active';
--> statement-breakpoint

UPDATE events
SET end_at = CASE id
      WHEN 'dev-event-war-history-1' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
      WHEN 'dev-event-war-history-2' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days')
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-21 days')
    END,
    archived_at = CASE id
      WHEN 'dev-event-war-history-1' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
      WHEN 'dev-event-war-history-2' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days')
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-21 days')
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN ('dev-event-war-history-1', 'dev-event-war-history-2', 'dev-event-war-history-3')
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO gallery_items (
  id, type, url, caption, uploaded_by, revision_token, created_at
)
SELECT id, type, url, caption, uploaded_by, revision_token,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', created_modifier)
FROM (
  SELECT
    'dev-gallery-01' AS id, 'image' AS type, NULL AS url,
    'Guild formation preview' AS caption, 'dev-owner' AS uploaded_by,
    'dev-gallery-01-revision' AS revision_token, '-5 days' AS created_modifier
  UNION ALL SELECT
    'dev-gallery-02', 'image', NULL, 'Strategy workshop preview', 'dev-moderator-01',
    'dev-gallery-02-revision', '-4 days'
  UNION ALL SELECT
    'dev-gallery-03', 'image', NULL, 'Weekly mission preview', 'dev-member-01',
    'dev-gallery-03-revision', '-3 days'
  UNION ALL SELECT
    'dev-gallery-video-01', 'video', 'https://www.youtube.com/watch?v=ScMzIvxBSi4',
    'External development video preview', 'dev-moderator-01',
    'dev-gallery-video-01-revision', '-2 days'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO audit_log (
  id, request_id, actor_user_id, entity_type, entity_id, action, summary, detail_json, occurred_at
)
SELECT id, request_id, actor_user_id, entity_type, entity_id, action, summary, detail_json,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', occurred_modifier)
FROM (
  SELECT
    'dev-audit-seed-init' AS id, 'dev-request-seed-init' AS request_id, 'dev-owner' AS actor_user_id,
    'seed' AS entity_type, 'development-database' AS entity_id, 'init' AS action,
    'Initialized development data' AS summary, '{"runtime":"local"}' AS detail_json,
    '-7 days' AS occurred_modifier
  UNION ALL SELECT
    'dev-audit-invite-create', 'dev-request-invite-create', 'dev-owner', 'invite_link',
    'dev-invite-active', 'create', 'Created an active development invite',
    '{"maxUses":10}', '-2 days'
  UNION ALL SELECT
    'dev-audit-storage-distribute', 'dev-request-storage-distribute', 'dev-owner', 'storage_transaction',
    'dev-storage-distribute-batch', 'distribute', 'Distributed development rewards',
    '{"recipientUserId":"dev-member-02"}', '-6 days'
  UNION ALL SELECT
    'dev-audit-war-draw', 'dev-request-war-draw', 'dev-moderator-01', 'guild_war_history',
    'dev-war-history-3', 'conclude', 'Concluded a draw guild war',
    '{"result":"draw"}', '-21 days'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO error_log (
  id, source, level, message, request_path, request_method, request_id, stack, created_at
)
SELECT id, source, level, message, request_path, request_method, request_id, stack,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', created_modifier)
FROM (
  SELECT
    'dev-error-request-warn' AS id, 'request' AS source, 'warn' AS level,
    'Development request warning' AS message, '/api/events' AS request_path, 'GET' AS request_method,
    'dev-request-warning' AS request_id, NULL AS stack, '-3 days' AS created_modifier
  UNION ALL SELECT
    'dev-error-scheduler-error', 'scheduler', 'error', 'Development scheduled job retry',
    NULL, NULL, NULL, 'ScheduledJobError: development retry', '-2 days'
  UNION ALL SELECT
    'dev-error-realtime-warn', 'realtime', 'warn', 'Development realtime reconnect',
    '/api/notifications/ws', 'GET', 'dev-realtime-warning', NULL, '-1 day'
  UNION ALL SELECT
    'dev-error-audit-error', 'audit', 'error', 'Development audit export warning',
    '/api/admin/audit/export', 'POST', 'dev-audit-warning', 'AuditExportError: development warning', '-12 hours'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
