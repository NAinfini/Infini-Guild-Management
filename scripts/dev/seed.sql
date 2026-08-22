-- Local development data shared by Cloudflare D1 and VPS SQLite.
-- The development administrator is created only for a pristine database. Every
-- later insert depends on that fixed user, so this file is a no-op for an existing site.
--
-- 固定行请用多行 VALUES，不要写 `SELECT ... UNION ALL SELECT ...` 长链：D1 的 SQLite
-- 把复合 SELECT 的分支数卡在 5，第 6 条就报 "too many terms in compound SELECT"。
-- 多行 VALUES 不走这条限制，同样的数据换个写法就没有上限问题。

INSERT OR IGNORE INTO users (
  id, username, role_id, is_active, deleted_at, revision_token, created_at, updated_at
)
SELECT
  'dev-owner', 'admin', 'admin', 1, NULL, 'dev-owner-user-revision',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-900 days'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-900 days')
WHERE NOT EXISTS (SELECT 1 FROM users);
--> statement-breakpoint

INSERT OR IGNORE INTO user_credentials (user_id, password_hash, updated_at)
SELECT
  'dev-owner',
  'pbkdf2-sha256$10000$aW5maW5pLWUyZS1vd25lcg$-VYi6RNWPNIdHw3hXNV9jsMaTTUvgCy-AqKVhQy7kVw',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

-- 一个开了两年的公会：会长 + 3 名管理 + 28 名成员，入会时间散在两年里。
-- 其中 3 人已停用——「退会」在本站就是停用账号（战绩和审计留着），名册筛选、
-- 公会战候选人和统计都要能碰到这个状态，所以种子里必须有。
--
-- 账号尾号在全站唯一（会长 00、成员 01-28、管理 29-31），不按角色各自从 01 起编：
-- 下面所有分布都拿这个尾号当席位号，尾号撞车会让两个人的战力、职业、战绩完全一样。
WITH seed(id, username, role_id, is_active, joined_days_ago) AS (
  VALUES
    ('dev-moderator-29', 'moderator_29', 'moderator', 1, 815),
    ('dev-moderator-30', 'moderator_30', 'moderator', 1, 702),
    ('dev-moderator-31', 'moderator_31', 'moderator', 1, 468),
    ('dev-member-01', 'member_01', 'member', 1, 784),
    ('dev-member-02', 'member_02', 'member', 1, 771),
    ('dev-member-03', 'member_03', 'member', 1, 749),
    ('dev-member-04', 'member_04', 'member', 1, 700),
    ('dev-member-05', 'member_05', 'member', 1, 664),
    ('dev-member-06', 'member_06', 'member', 1, 631),
    ('dev-member-07', 'member_07', 'member', 1, 590),
    ('dev-member-08', 'member_08', 'member', 1, 552),
    ('dev-member-09', 'member_09', 'member', 1, 523),
    ('dev-member-10', 'member_10', 'member', 1, 498),
    ('dev-member-11', 'member_11', 'member', 1, 470),
    ('dev-member-12', 'member_12', 'member', 1, 441),
    ('dev-member-13', 'member_13', 'member', 0, 407),
    ('dev-member-14', 'member_14', 'member', 1, 372),
    ('dev-member-15', 'member_15', 'member', 1, 341),
    ('dev-member-16', 'member_16', 'member', 1, 310),
    ('dev-member-17', 'member_17', 'member', 1, 286),
    ('dev-member-18', 'member_18', 'member', 1, 251),
    ('dev-member-19', 'member_19', 'member', 1, 224),
    ('dev-member-20', 'member_20', 'member', 1, 197),
    ('dev-member-21', 'member_21', 'member', 1, 168),
    ('dev-member-22', 'member_22', 'member', 0, 141),
    ('dev-member-23', 'member_23', 'member', 1, 112),
    ('dev-member-24', 'member_24', 'member', 1, 86),
    ('dev-member-25', 'member_25', 'member', 1, 63),
    ('dev-member-26', 'member_26', 'member', 1, 44),
    ('dev-member-27', 'member_27', 'member', 0, 27),
    ('dev-member-28', 'member_28', 'member', 1, 11)
)
INSERT OR IGNORE INTO users (
  id, username, role_id, is_active, deleted_at, revision_token, created_at, updated_at
)
SELECT
  seed.id, seed.username, seed.role_id, seed.is_active, NULL, seed.id || '-revision',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || seed.joined_days_ago || ' days'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || seed.joined_days_ago || ' days')
FROM seed
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO user_credentials (user_id, password_hash, updated_at)
SELECT
  id,
  'pbkdf2-sha256$10000$aW5maW5pLWUyZS1vd25lcg$-VYi6RNWPNIdHw3hXNV9jsMaTTUvgCy-AqKVhQy7kVw',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users
WHERE id LIKE 'dev-%' AND id <> 'dev-owner'
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

-- 只填从未登录过的行：真实登录时刻由会话签发写入（auth-store 的 touchLastLogin），
-- 种子重跑不能把它冲掉。停用的人停在几个月前，两个刚拿到邀请的人保持「从未登录」。
--
-- 下面各处反复出现的 `CAST(substr(id, -2) AS INTEGER)` 是「席位号」，即账号尾号
-- （会长的 `dev-owner` 取不到数字，落成 0）。它是全站唯一的，只用来把战力、职业、
-- 空闲时段、参战名单和战绩摊开成有差异的分布，不承担身份含义。
UPDATE users
SET last_login_at = CASE
    WHEN id IN ('dev-member-26', 'dev-member-28') THEN NULL
    WHEN is_active = 0 THEN strftime(
      '%Y-%m-%dT%H:%M:%fZ', 'now',
      '-' || (60 + CAST(substr(id, -2) AS INTEGER) * 3) || ' days'
    )
    ELSE strftime(
      '%Y-%m-%dT%H:%M:%fZ', 'now',
      '-' || ((CAST(substr(id, -2) AS INTEGER) * 947) % 30240) || ' minutes'
    )
  END
WHERE id LIKE 'dev-%' AND last_login_at IS NULL
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

-- 头衔和自我介绍只给会长、管理和几位老成员：真实公会里大多数人不填简介，
-- 逐行编一段假话反而更不像。
--
-- 战力 = 入会时长趋势 + 席位噪声：练得久的整体更强，但噪声幅度和趋势幅度相当，
-- 所以按战力排序不会退化成按入会顺序（或按账号）排序——新人里有大佬，老人里有咸鱼。
-- 管理另加 400，带队的一般是练度靠前的人。
WITH intro(user_id, title_html, bio) AS (
  VALUES
    ('dev-owner', '<strong>Admin</strong>', 'Local development administrator.'),
    ('dev-moderator-29', '<strong>War Coordinator</strong>', 'Coordinates events and guild wars.'),
    ('dev-moderator-30', '<strong>Roster Officer</strong>', 'Keeps the war roster and the absence board current.'),
    ('dev-moderator-31', '<strong>Quartermaster</strong>', 'Runs storage intake and distribution.'),
    ('dev-member-01', NULL, 'Frontline specialist.'),
    ('dev-member-02', NULL, 'Reliable damage dealer.'),
    ('dev-member-03', NULL, 'Support and recovery.'),
    ('dev-member-05', NULL, 'Guild event regular.'),
    ('dev-member-11', NULL, 'Runs the late-night practice group.'),
    ('dev-member-18', NULL, 'Back after a long break.')
)
INSERT OR IGNORE INTO member_profiles (
  user_id, power, title_html, bio, availability_timezone, notes, revision_token, created_at, updated_at
)
SELECT
  users.id,
  4800 + CAST((julianday('now') - julianday(users.created_at)) / 900.0 * 3000 AS INTEGER)
    + (CAST(substr(users.id, -2) AS INTEGER) * 337) % 2200
    + CASE WHEN users.id LIKE 'dev-moderator-%' THEN 400 ELSE 0 END,
  intro.title_html, intro.bio, 'UTC', NULL, users.id || '-profile-revision',
  users.created_at, users.created_at
FROM users
LEFT JOIN intro ON intro.user_id = users.id
WHERE users.id LIKE 'dev-%'
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

-- 职业按 7 人一轮分配：先锋、剑士、术士各约三成，治疗最少。真实公会就是这个比例，
-- 公会战统计里的角色差异也才有东西可看（治疗堆治疗量、先锋吃伤害）。
INSERT OR IGNORE INTO member_profile_classes (user_id, class_id, sort_order)
SELECT
  users.id,
  CASE CAST(substr(users.id, -2) AS INTEGER) % 7
    WHEN 0 THEN 'dev-class-vanguard'
    WHEN 1 THEN 'dev-class-blade'
    WHEN 2 THEN 'dev-class-mystic'
    WHEN 3 THEN 'dev-class-blade'
    WHEN 4 THEN 'dev-class-healer'
    WHEN 5 THEN 'dev-class-mystic'
    ELSE 'dev-class-vanguard'
  END,
  0
FROM users
WHERE users.id LIKE 'dev-%'
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO member_profile_videos (user_id, url, sort_order)
SELECT user_id, url, sort_order
FROM (
  SELECT 'dev-owner' AS user_id, 'https://www.youtube.com/watch?v=ScMzIvxBSi4' AS url, 0 AS sort_order
  UNION ALL SELECT 'dev-moderator-29', 'https://vimeo.com/76979871', 0
  UNION ALL SELECT 'dev-member-02', 'https://www.bilibili.com/video/BV1GJ411x7h7', 0
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

-- 周五、周六是全公会统一的开战夜，时段对所有人一致（18:00-23:00）。
INSERT OR IGNORE INTO member_availability_windows (user_id, weekday, start_minute, end_minute)
SELECT users.id, weekdays.weekday, 1080, 1380
FROM users
CROSS JOIN (SELECT 5 AS weekday UNION ALL SELECT 6) AS weekdays
WHERE users.id LIKE 'dev-%';
--> statement-breakpoint

-- 其余几天是各自的空闲时间，按席位散开：排班视图要能筛出「谁只在开战夜在线」，
-- 全员一模一样的时段什么也筛不出来。
INSERT OR IGNORE INTO member_availability_windows (user_id, weekday, start_minute, end_minute)
SELECT
  users.id, weekdays.weekday,
  1020 + (CAST(substr(users.id, -2) AS INTEGER) % 4) * 60,
  1320 + (CAST(substr(users.id, -2) AS INTEGER) % 3) * 40
FROM users
CROSS JOIN (
  SELECT 0 AS weekday UNION ALL SELECT 1 UNION ALL SELECT 2
  UNION ALL SELECT 3 UNION ALL SELECT 4
) AS weekdays
WHERE users.id LIKE 'dev-%'
  AND (CAST(substr(users.id, -2) AS INTEGER) * 3 + weekdays.weekday * 5) % 7 < 3;
--> statement-breakpoint

-- 请假板要同时有「已结束」「进行中」「还没开始」三种，排班和候选人筛选才分得出来。
WITH seed(id, user_id, start_offset, end_offset, note) AS (
  VALUES
    ('dev-absence-member-08', 'dev-member-08', '+2 days', '+4 days', 'Development seed absence'),
    ('dev-absence-member-12', 'dev-member-12', '-2 days', '+3 days', 'Away on a work trip'),
    ('dev-absence-member-19', 'dev-member-19', '-24 days', '-17 days', 'Exam period'),
    ('dev-absence-member-05', 'dev-member-05', '+10 days', '+17 days', 'Holiday, back for the next war')
)
INSERT INTO member_absences (id, user_id, start_date, end_date, note, created_at)
SELECT
  seed.id, seed.user_id, date('now', seed.start_offset), date('now', seed.end_offset),
  seed.note, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM seed
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

WITH seed(badge_id, user_id) AS (
  VALUES
    ('dev-badge-veteran', 'dev-moderator-29'),
    ('dev-badge-veteran', 'dev-moderator-30'),
    ('dev-badge-veteran', 'dev-member-01'),
    ('dev-badge-veteran', 'dev-member-04'),
    ('dev-badge-veteran', 'dev-member-07'),
    ('dev-badge-war-hero', 'dev-member-01'),
    ('dev-badge-war-hero', 'dev-member-02'),
    ('dev-badge-war-hero', 'dev-member-09'),
    ('dev-badge-war-hero', 'dev-member-15'),
    ('dev-badge-contributor', 'dev-moderator-31'),
    ('dev-badge-contributor', 'dev-member-03'),
    ('dev-badge-contributor', 'dev-member-04'),
    ('dev-badge-contributor', 'dev-member-11'),
    ('dev-badge-contributor', 'dev-member-20'),
    ('dev-badge-contributor', 'dev-member-25')
)
INSERT OR IGNORE INTO member_badge_assignments (badge_id, user_id, assigned_by, assigned_at)
SELECT seed.badge_id, seed.user_id, 'dev-owner', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM seed
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
  'dev-owner', 'dev-moderator-29', 'dev-announcement-war-revision',
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
    0, 'scheduled', '+2 days', '+9 days', NULL, 'dev-moderator-29',
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
    ('dev-event-social', 'social', 'Guild Social Night', 'A relaxed social event for all members.', '+3 days', '+3 days +2 hours', 30, 0)
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

-- 公会战每周一场，对手名单只在这里写一次：下面的 guild_wars 行从事件标题反推对手，
-- 两张表不各存一份名字。事件必须先落库——active 状态要求 event_id 非空
-- （见 0000_core.sql 的 guild_wars_status_shape）。
--
-- 历史场次也先按「未归档、明天结束」建：event_signup_available 触发器不许往已归档
-- 或已结束的事件里加人，报名灌不进去名册就编不出来。等战报结算完，再把事件的结束
-- 和归档时间对齐到战役的结算时刻（本节最后一条语句）。
WITH wars(slug, enemy, weeks_ago) AS (
  VALUES
    ('active', 'Crimson Tide', NULL),
    ('active-2', 'Ember Coalition', NULL),
    ('history-1', 'Shadow Legion', 1),
    ('history-2', 'Iron Vanguard', 2),
    ('history-3', 'Frost Reapers', 3),
    ('history-4', 'Gilded Talon', 4),
    ('history-5', 'Duskwatch', 5),
    ('history-6', 'Storm Aerie', 6),
    ('history-7', 'Obsidian Choir', 7),
    ('history-8', 'Vermilion Pact', 8),
    ('history-9', 'Hollow Crown', 9),
    ('history-10', 'Ashen Covenant', 10)
), schedule(slug, title, description, start_modifier, end_modifier, visible_modifier, pinned) AS (
  SELECT
    slug, 'Guild War: ' || enemy,
    CASE WHEN weeks_ago IS NULL THEN 'Scheduled guild war against ' || enemy || '.'
      ELSE 'Concluded guild war against ' || enemy || '.'
    END,
    CASE slug WHEN 'active' THEN '+2 hours' WHEN 'active-2' THEN '+5 days'
      ELSE '-' || (weeks_ago * 7 + 1) || ' days'
    END,
    CASE slug WHEN 'active' THEN '+5 hours' WHEN 'active-2' THEN '+5 days +3 hours'
      ELSE '+1 day'
    END,
    CASE slug WHEN 'active' THEN '-1 day' WHEN 'active-2' THEN '-2 hours'
      ELSE '-' || (weeks_ago * 7 + 3) || ' days'
    END,
    CASE WHEN slug = 'active' THEN 1 ELSE 0 END
  FROM wars
)
INSERT INTO events (
  id, type, title, description, start_at, end_at, capacity, pinned, signup_locked,
  auto_archive, auto_archived, visible_at, archived_at, created_by, updated_by,
  series_id, instance_date, winner_count, created_at, updated_at
)
SELECT
  'dev-event-war-' || schedule.slug, 'guild_war', schedule.title, schedule.description,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', schedule.start_modifier),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', schedule.end_modifier),
  24, schedule.pinned, 0, 0, 0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', schedule.visible_modifier), NULL,
  'dev-owner', 'dev-owner', NULL, NULL, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', schedule.visible_modifier),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM schedule
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

-- 非公会战活动的报名：每个活动挑一段席位，报名人数各不相同——周常近半数、
-- 联谊夜几乎全员、工作坊和抽奖只有一小撮。全都塞满或全都只有三个人都不像真站点。
-- 公会战事件的报名由名册派生，写在下面的公会战一节里。
-- 每个活动取 (席位 + shift) % span < keep 的那一段：span/keep 决定报名比例，
-- shift 决定取哪一段，抽奖那条用 shift 把两位中奖人圈进报名名单。
WITH signup(event_id, span, shift, keep, joined_offset) AS (
  VALUES
    ('dev-event-weekly', 5, 0, 3, '-1 hour'),
    ('dev-event-social', 5, 0, 4, '-6 hours'),
    ('dev-event-other', 3, 0, 1, '-2 hours'),
    ('dev-event-template-instance', 2, 1, 1, '-30 minutes'),
    ('dev-event-raffle', 5, 3, 2, '-5 days')
)
INSERT OR IGNORE INTO event_participants (id, event_id, user_id, joined_at)
SELECT
  'dev-participant-' || substr(signup.event_id, length('dev-event-') + 1)
    || '-' || substr(users.id, length('dev-') + 1),
  signup.event_id, users.id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', signup.joined_offset)
FROM signup
CROSS JOIN users
WHERE users.id LIKE 'dev-%' AND users.is_active = 1
  AND (CAST(substr(users.id, -2) AS INTEGER) + signup.shift) % signup.span < signup.keep
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
  AND NOT EXISTS (
    SELECT 1
    FROM event_participants AS existing
    WHERE existing.event_id = signup.event_id
      AND existing.user_id = users.id
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

-- 约三分之二的在册成员投了票，票数明显偏向周末场——只有四票的投票看不出聚合，
-- 也压不出结果可见性和票数排序的问题。
INSERT OR IGNORE INTO event_poll_votes (event_id, option_id, user_id, created_at)
SELECT
  'dev-event-poll',
  CASE (CAST(substr(users.id, -2) AS INTEGER) * 3) % 7
    WHEN 1 THEN 'dev-poll-option-weekday'
    WHEN 5 THEN 'dev-poll-option-weekday'
    WHEN 4 THEN 'dev-poll-option-late'
    ELSE 'dev-poll-option-weekend'
  END,
  users.id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (6 + CAST(substr(users.id, -2) AS INTEGER)) || ' hours')
FROM users
WHERE users.id LIKE 'dev-%' AND users.is_active = 1
  AND (CAST(substr(users.id, -2) AS INTEGER) + 2) % 3 <> 0
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO event_raffle_draws (event_id, winner_count, drawn_by, drawn_at, mutation_token)
SELECT
  'dev-event-raffle', 2, 'dev-moderator-29',
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
  updated_by = 'dev-moderator-29',
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
  'dev-moderator-29', NULL, article.updated_at
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
    'dev-storage-adjust-batch', 'dev-moderator-29', 'dev-seed-adjustment-01', 'stock_admin',
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
    'adjust', 4.0, NULL, 'Development inventory correction', 'dev-moderator-29',
    '2026-01-04T12:00:00.000Z'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

-- 公会战从事件派生：对手名字只在上面的事件标题里写过一次，这里用同一个前缀切回来。
-- 全部先按 active 落库（状态约束要求 active 必须挂事件、且不带任何结算字段），
-- 编队和名册跟着 active 状态生成，最后再把历史场次一次性结算。这个顺序也是幂等的来源：
-- 重跑时历史场次已经是 concluded，编队和名册那两条的 JOIN 直接落空。
INSERT OR IGNORE INTO guild_wars (
  id, event_id, status, war_name, enemy_name, result, own_kills, own_towers, own_base_hp,
  own_credits, own_distance, enemy_kills, enemy_towers, enemy_base_hp, enemy_credits,
  enemy_distance, duration_minutes, notes, roster_version, mutation_token, concluded_at,
  created_by, updated_by, created_at, updated_at
)
SELECT
  'dev-war-' || substr(events.id, length('dev-event-war-') + 1),
  events.id, 'active',
  substr(events.title, length('Guild War: ') + 1),
  substr(events.title, length('Guild War: ') + 1),
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  CASE events.id
    WHEN 'dev-event-war-active' THEN 'Team A is locked; a few members are still unassigned.'
    WHEN 'dev-event-war-active-2' THEN 'Draft in progress; most of the roster is still in the pool.'
  END,
  0, NULL, NULL, 'dev-owner', 'dev-owner', events.visible_at, events.updated_at
FROM events
WHERE events.id LIKE 'dev-event-war-%'
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO war_teams (id, war_id, team_name, sort_order, notes, is_locked)
SELECT
  'dev-team-' || substr(guild_wars.id, length('dev-war-') + 1) || '-' || sides.suffix,
  guild_wars.id, sides.team_name, sides.sort_order, NULL, 0
FROM guild_wars
CROSS JOIN (
  SELECT 'a' AS suffix, 'Team A' AS team_name, 0 AS sort_order
  UNION ALL SELECT 'b', 'Team B', 1
) AS sides
WHERE guild_wars.id LIKE 'dev-war-%' AND guild_wars.status = 'active'
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

UPDATE war_teams
SET is_locked = 1
WHERE id = 'dev-team-active-a'
  AND EXISTS (SELECT 1 FROM guild_wars WHERE id = 'dev-war-active' AND status = 'active');
--> statement-breakpoint

-- 报名表：每场换一批人，而且出勤率因人而异——`4 + 席位 % 5` 把每个人的出勤率定在
-- 四成到八成之间，于是有人场场不落、有人一季只来两三次。全员统一比例排出来的
-- 出勤榜是一条平线，看不出谁是主力。
-- 报名必须先落库：名册只能从报名的人里编（war_member_participant_insert 触发器就是
-- 这条规则），下一条语句直接把这里的人分进队伍或留在候选池。
-- 场次盐值取历史周次，进行中的第二场单独给一个，两场进行中的战役才不会撞出同一份名单。
INSERT OR IGNORE INTO event_participants (id, event_id, user_id, joined_at)
SELECT
  'dev-participant-' || substr(events.id, length('dev-event-') + 1)
    || '-' || substr(users.id, length('dev-') + 1),
  events.id, users.id,
  strftime('%Y-%m-%dT%H:%M:%fZ', events.start_at, '-1 day')
FROM guild_wars
JOIN events ON events.id = guild_wars.event_id
CROSS JOIN users
WHERE guild_wars.id LIKE 'dev-war-%' AND guild_wars.status = 'active'
  AND users.id LIKE 'dev-%' AND users.is_active = 1
  AND (
    CAST(substr(users.id, -2) AS INTEGER) * 13
    + CASE
        WHEN guild_wars.id = 'dev-war-active-2' THEN 11
        ELSE CAST(substr(guild_wars.id, length('dev-war-history-') + 1) AS INTEGER)
      END * 29
  ) % 10 < 4 + CAST(substr(users.id, -2) AS INTEGER) % 5
  AND EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner')
  AND NOT EXISTS (
    SELECT 1
    FROM event_participants AS existing
    WHERE existing.event_id = events.id AND existing.user_id = users.id
  );
--> statement-breakpoint

-- 名册就是报名表编完队的样子。战绩按职业分开算（治疗堆治疗量、先锋吃伤害、
-- 剑士拆建筑），统计面板才有东西可比；抖动由席位和周次算出，确定性可重跑，
-- 但不会排成等差数列。进行中的两场不写战绩——仗还没打，两场的编队进度也不同：
-- 一场只差几个人没排，一场刚开摊、大部分人还在候选池里。
WITH lineup(war_id, week, team_a, team_b, user_id, seat, class_id, jitter) AS (
  SELECT
    guild_wars.id,
    CAST(substr(guild_wars.id, length('dev-war-history-') + 1) AS INTEGER),
    'dev-team-' || substr(guild_wars.id, length('dev-war-') + 1) || '-a',
    'dev-team-' || substr(guild_wars.id, length('dev-war-') + 1) || '-b',
    event_participants.user_id,
    CAST(substr(event_participants.user_id, -2) AS INTEGER),
    member_profile_classes.class_id,
    (
      CAST(substr(event_participants.user_id, -2) AS INTEGER) * 37
      + CAST(substr(guild_wars.id, length('dev-war-history-') + 1) AS INTEGER) * 53
    ) % 100
  FROM guild_wars
  JOIN event_participants ON event_participants.event_id = guild_wars.event_id
  JOIN member_profile_classes ON member_profile_classes.user_id = event_participants.user_id
  WHERE guild_wars.id LIKE 'dev-war-%' AND guild_wars.status = 'active'
)
INSERT OR IGNORE INTO war_members (
  id, war_id, team_id, user_id, role_tag, sort_order, kills, deaths, assists,
  damage, healing, building_damage, credits, damage_taken, note
)
SELECT
  'dev-war-member-' || substr(lineup.war_id, length('dev-war-') + 1)
    || '-' || substr(lineup.user_id, length('dev-') + 1),
  lineup.war_id,
  CASE
    WHEN lineup.war_id = 'dev-war-active-2' AND lineup.seat % 3 <> 2 THEN NULL
    WHEN lineup.war_id = 'dev-war-active' AND lineup.seat % 7 = 1 THEN NULL
    WHEN (lineup.seat + lineup.week) % 2 = 0 THEN lineup.team_a
    ELSE lineup.team_b
  END,
  lineup.user_id,
  CASE WHEN lineup.user_id = 'dev-owner' OR lineup.user_id LIKE 'dev-moderator-%' THEN 'Leader' END,
  lineup.seat,
  CASE WHEN lineup.week = 0 THEN NULL ELSE 3 + (lineup.seat * 5 + lineup.week * 11) % 14 END,
  CASE WHEN lineup.week = 0 THEN NULL ELSE 1 + (lineup.seat * 5 + lineup.week * 3) % 7 END,
  CASE WHEN lineup.week = 0 THEN NULL ELSE 4 + (lineup.seat * 3 + lineup.week * 7) % 16 END,
  CASE
    WHEN lineup.week = 0 THEN NULL
    WHEN lineup.class_id = 'dev-class-healer' THEN 4200 + lineup.jitter * 45
    WHEN lineup.class_id = 'dev-class-vanguard' THEN 9000 + lineup.jitter * 70
    ELSE 14000 + lineup.jitter * 95
  END,
  CASE
    WHEN lineup.week = 0 THEN NULL
    WHEN lineup.class_id = 'dev-class-healer' THEN 9000 + lineup.jitter * 80
    ELSE 300 + lineup.jitter * 22
  END,
  CASE
    WHEN lineup.week = 0 THEN NULL
    WHEN lineup.class_id = 'dev-class-blade' THEN 1400 + lineup.jitter * 32
    ELSE 480 + lineup.jitter * 11
  END,
  CASE WHEN lineup.week = 0 THEN NULL ELSE 380 + lineup.jitter * 7 END,
  CASE
    WHEN lineup.week = 0 THEN NULL
    WHEN lineup.class_id = 'dev-class-vanguard' THEN 14000 + lineup.jitter * 85
    ELSE 6000 + lineup.jitter * 40
  END,
  NULL
FROM lineup
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

-- 结算：胜负由基地血量决定，人头、阵亡和战功直接取名册合计——总览上的数字必须和
-- 逐人明细对得上，否则统计页的「总计」是另编的一套数。十场里六胜三负一平，
-- 每周一场，最近的一场在七天前。只处理还挂着 active 的历史场次，重跑不会重写战绩。
UPDATE guild_wars
SET status = 'concluded',
    result = outcome.result,
    own_kills = outcome.own_kills,
    enemy_kills = outcome.enemy_kills,
    own_towers = outcome.own_towers,
    enemy_towers = outcome.enemy_towers,
    own_base_hp = outcome.own_base_hp,
    enemy_base_hp = outcome.enemy_base_hp,
    own_credits = outcome.own_credits,
    enemy_credits = outcome.enemy_credits,
    own_distance = outcome.own_distance,
    enemy_distance = outcome.enemy_distance,
    duration_minutes = outcome.duration_minutes,
    concluded_at = outcome.concluded_at,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT
    tally.war_id, tally.own_kills, tally.enemy_kills, tally.own_credits,
    CASE tally.result
      WHEN 'win' THEN 4 + tally.week % 3
      WHEN 'loss' THEN 1 + tally.week % 3
      ELSE 3
    END AS own_towers,
    CASE tally.result
      WHEN 'win' THEN 1 + tally.week % 2
      WHEN 'loss' THEN 4 + tally.week % 2
      ELSE 3
    END AS enemy_towers,
    CASE tally.result
      WHEN 'win' THEN 22 + (tally.week * 7) % 40
      WHEN 'loss' THEN 0
      ELSE 14 + tally.week % 9
    END AS own_base_hp,
    CASE tally.result
      WHEN 'win' THEN 0
      WHEN 'loss' THEN 18 + (tally.week * 5) % 35
      ELSE 14 + tally.week % 9
    END AS enemy_base_hp,
    round(tally.own_credits * CASE tally.result
      WHEN 'win' THEN 0.86
      WHEN 'loss' THEN 1.15
      ELSE 1.0
    END) AS enemy_credits,
    CASE tally.result
      WHEN 'win' THEN 70 + (tally.week * 11) % 25
      WHEN 'loss' THEN 32 + (tally.week * 9) % 18
      ELSE 50
    END AS own_distance,
    CASE tally.result
      WHEN 'win' THEN 30 + (tally.week * 7) % 20
      WHEN 'loss' THEN 68 + (tally.week * 13) % 22
      ELSE 50
    END AS enemy_distance,
    42 + (tally.week * 13) % 16 AS duration_minutes,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (tally.week * 7) || ' days') AS concluded_at,
    tally.result
  FROM (
    SELECT
      schedule.war_id, schedule.week,
      CASE
        WHEN schedule.week IN (2, 6, 8) THEN 'loss'
        WHEN schedule.week = 3 THEN 'draw'
        ELSE 'win'
      END AS result,
      (SELECT sum(kills) FROM war_members WHERE war_members.war_id = schedule.war_id) AS own_kills,
      (SELECT sum(deaths) FROM war_members WHERE war_members.war_id = schedule.war_id) AS enemy_kills,
      (SELECT sum(credits) FROM war_members WHERE war_members.war_id = schedule.war_id) AS own_credits
    FROM (
      SELECT
        id AS war_id,
        CAST(substr(id, length('dev-war-history-') + 1) AS INTEGER) AS week
      FROM guild_wars
      WHERE id LIKE 'dev-war-history-%' AND status = 'active'
    ) AS schedule
  ) AS tally
) AS outcome
WHERE guild_wars.id = outcome.war_id;
--> statement-breakpoint

-- 战报结算完事件才落幕：结束和归档时间取战役的结算时刻，两条时间线不会各说各话。
UPDATE events
SET end_at = (SELECT concluded_at FROM guild_wars WHERE guild_wars.event_id = events.id),
    archived_at = (SELECT concluded_at FROM guild_wars WHERE guild_wars.event_id = events.id),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE events.id LIKE 'dev-event-war-history-%'
  AND EXISTS (
    SELECT 1 FROM guild_wars
    WHERE guild_wars.event_id = events.id AND guild_wars.status = 'concluded'
  );
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
    'dev-gallery-02', 'image', NULL, 'Strategy workshop preview', 'dev-moderator-29',
    'dev-gallery-02-revision', '-4 days'
  UNION ALL SELECT
    'dev-gallery-03', 'image', NULL, 'Weekly mission preview', 'dev-member-01',
    'dev-gallery-03-revision', '-3 days'
  UNION ALL SELECT
    'dev-gallery-video-01', 'video', 'https://www.youtube.com/watch?v=ScMzIvxBSi4',
    'External development video preview', 'dev-moderator-29',
    'dev-gallery-video-01-revision', '-2 days'
)
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'dev-owner');
--> statement-breakpoint

INSERT OR IGNORE INTO audit_log (
  id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
  subject_label, action, payload_json, occurred_at
)
SELECT id, request_id, 'user', actor_id,
  (SELECT username FROM users WHERE users.id = seed_audit.actor_id),
  subject_type, subject_id, subject_label, action, payload_json,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', occurred_modifier)
FROM (
  SELECT
    'dev-audit-seed-init' AS id, 'dev-request-seed-init' AS request_id, 'dev-owner' AS actor_id,
    'seed' AS subject_type, 'development-database' AS subject_id,
    'Development database' AS subject_label, 'init' AS action,
    json_object(
      'schema_version', 2,
      'changes', json_array(),
      'context', json_array(
        json_object('field', 'type', 'value', json_object('type', 'code', 'value', 'local'))
      )
    ) AS payload_json,
    '-7 days' AS occurred_modifier
  UNION ALL SELECT
    'dev-audit-invite-create', 'dev-request-invite-create', 'dev-owner', 'invite_link',
    'dev-invite-active', 'Member', 'create',
    json_object(
      'schema_version', 2,
      'changes', json_array(),
      'context', json_array(
        json_object('field', 'role_id', 'value', json_object(
          'type', 'reference', 'value', json_object('id', 'member', 'label', 'Member')
        )),
        json_object('field', 'role_name', 'value', json_object('type', 'text', 'value', 'Member')),
        json_object('field', 'max_uses', 'value', json_object('type', 'number', 'value', 10)),
        json_object('field', 'used_count', 'value', json_object('type', 'number', 'value', 0)),
        json_object('field', 'status', 'value', json_object('type', 'code', 'value', 'active')),
        json_object('field', 'expires_at', 'value', json_object(
          'type', 'datetime', 'value', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+14 days')
        ))
      )
    ), '-2 days'
  UNION ALL SELECT
    'dev-audit-storage-distribute', 'dev-request-storage-distribute', 'dev-owner', 'storage_transaction',
    'dev-storage-distribute-batch', 'Recovery Potion distribution', 'distribute',
    json_object(
      'schema_version', 2,
      'changes', json_array(),
      'context', json_array(
        json_object('field', 'transaction_count', 'value', json_object('type', 'number', 'value', 1)),
        json_object('field', 'type', 'value', json_object('type', 'code', 'value', 'distribute')),
        json_object('field', 'item_ids', 'value', json_object(
          'type', 'list', 'value', json_array(json_object(
            'type', 'reference', 'value', json_object('id', 'dev-storage-item-potion', 'label', 'Recovery Potion')
          ))
        )),
        json_object('field', 'quantity', 'value', json_object(
          'type', 'list', 'value', json_array(json_object('type', 'number', 'value', 5))
        )),
        json_object('field', 'user_ids', 'value', json_object(
          'type', 'list', 'value', json_array(json_object(
            'type', 'reference', 'value', json_object('id', 'dev-member-02', 'label', 'member_02')
          ))
        ))
      )
    ), '-6 days'
  UNION ALL SELECT
    'dev-audit-war-draw', 'dev-request-war-draw', 'dev-moderator-29', 'guild_war_history',
    'dev-war-history-3', 'Guild War: Frost Reapers', 'conclude',
    json_object(
      'schema_version', 2,
      'changes', json_array(),
      'context', json_array(
        json_object('field', 'event_id', 'value', json_object(
          'type', 'reference', 'value', json_object(
            'id', 'dev-event-war-history-3', 'label', 'Guild War: Frost Reapers'
          )
        )),
        json_object('field', 'result', 'value', json_object('type', 'code', 'value', 'draw')),
        json_object('field', 'member_count', 'value', json_object(
          'type', 'number',
          'value', (SELECT count(*) FROM war_members WHERE war_id = 'dev-war-history-3')
        ))
      )
    ), '-21 days'
) AS seed_audit
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
--> statement-breakpoint

-- 种子行的 search_text 与迁移回填同一表达式派生，避免逐行维护重复的文本字面量。
UPDATE announcements SET search_text = coalesce((
  SELECT group_concat(json_tree.value, ' ')
  FROM json_tree(announcements.body_json)
  WHERE json_tree.type = 'text' AND json_tree.key = 'text'
), '')
WHERE id LIKE 'dev-announcement-%';
--> statement-breakpoint

UPDATE wiki_articles SET search_text = coalesce((
  SELECT group_concat(json_tree.value, ' ')
  FROM json_tree(wiki_articles.body_json)
  WHERE json_tree.type = 'text' AND json_tree.key = 'text'
), '')
WHERE id LIKE 'dev-wiki-article-%';
