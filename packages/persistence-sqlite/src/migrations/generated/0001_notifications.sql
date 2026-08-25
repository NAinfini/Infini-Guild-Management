DROP TRIGGER audit_log_immutable;
--> statement-breakpoint
DROP TRIGGER audit_archive_items_pending_only;
--> statement-breakpoint
DROP TRIGGER audit_archive_items_immutable;
--> statement-breakpoint
DROP TRIGGER audit_log_delete_only_ready_archive;
--> statement-breakpoint
DROP TRIGGER audit_archives_finalize_consistent;
--> statement-breakpoint
DROP TRIGGER system_test_audit_artifact_registry;
--> statement-breakpoint
ALTER TABLE audit_archive_items RENAME TO audit_archive_items_legacy;
--> statement-breakpoint
ALTER TABLE audit_log RENAME TO audit_log_legacy;
--> statement-breakpoint
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_label TEXT,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_label TEXT,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  CONSTRAINT audit_log_actor_kind_valid CHECK(actor_kind IN ('user', 'system')),
  CONSTRAINT audit_log_subject_type_valid CHECK(subject_type IN (
    'analytics_settings', 'announcement', 'audit_archive_export', 'audit_log_export', 'badge',
    'class_catalog', 'class_tag', 'event', 'event_participant', 'event_poll_vote', 'gallery',
    'gallery_item', 'guild_war', 'guild_war_history', 'guild_war_member_stats', 'invite_link',
    'important_notice', 'media_cleanup', 'media_asset', 'member_absence', 'member_badge',
    'member_profile', 'recurring_template', 'role', 'seed', 'site_config', 'system_test',
    'storage', 'storage_category', 'storage_item', 'storage_transaction', 'user', 'user_auth',
    'wiki', 'wiki_article', 'wiki_category'
  )),
  CONSTRAINT audit_log_action_valid CHECK(action IN (
    'admin_create_member', 'archive', 'adjust', 'assign', 'batch_add_by_moderator',
    'batch_deactivate', 'batch_delete', 'batch_reactivate', 'batch_remove_by_moderator',
    'batch_role_update', 'batch_update', 'change_password', 'change_username', 'conclude',
    'create', 'create_video', 'deactivate', 'delete', 'delete_audio', 'delete_avatar',
    'delete_images', 'distribute', 'export_filtered_csv', 'export_filtered_json', 'init',
    'intake', 'join', 'leave', 'login_failed', 'move_member', 'pause', 'publish',
    'raffle_draw', 'reactivate', 'register', 'reorder', 'reset_login_lock', 'reset_password',
    'rollback', 'run', 'resume', 'revoke', 'save_teams', 'set_role_tag', 'unassign',
    'update', 'update_role', 'upload', 'upload_audio', 'upload_avatar', 'upload_icon',
    'upload_images', 'withdraw', 'vote'
  )),
  CONSTRAINT audit_log_actor_id_present CHECK(length(trim(actor_id)) > 0),
  CONSTRAINT audit_log_actor_label_bounded CHECK(actor_label IS NULL OR length(trim(actor_label)) BETWEEN 1 AND 200),
  CONSTRAINT audit_log_subject_id_present CHECK(length(trim(subject_id)) > 0),
  CONSTRAINT audit_log_request_id_present CHECK(length(trim(request_id)) > 0),
  CONSTRAINT audit_log_subject_label_bounded CHECK(subject_label IS NULL OR length(trim(subject_label)) BETWEEN 1 AND 200),
  CONSTRAINT audit_log_payload_v2 CHECK(json_valid(payload_json)
    AND json_type(payload_json) = 'object'
    AND json_extract(payload_json, '$.schema_version') = 2
    AND json_type(payload_json, '$.changes') = 'array'
    AND json_type(payload_json, '$.context') = 'array'
    AND length(payload_json) <= 32768)
);
--> statement-breakpoint
INSERT INTO audit_log (
  id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
  subject_label, action, payload_json, occurred_at
) SELECT
  id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
  subject_label, action, payload_json, occurred_at
FROM audit_log_legacy;
--> statement-breakpoint
CREATE TABLE audit_archive_items_rebuilt (
  archive_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(archive_id, audit_id),
  FOREIGN KEY (archive_id) REFERENCES audit_archives(id) ON DELETE CASCADE,
  FOREIGN KEY (audit_id) REFERENCES audit_log(id) ON DELETE CASCADE,
  CONSTRAINT audit_archive_items_position_valid CHECK(position BETWEEN 0 AND 99)
);
--> statement-breakpoint
INSERT INTO audit_archive_items_rebuilt (archive_id, audit_id, position)
SELECT archive_id, audit_id, position FROM audit_archive_items_legacy;
--> statement-breakpoint
DROP TABLE audit_archive_items_legacy;
--> statement-breakpoint
DROP TABLE audit_log_legacy;
--> statement-breakpoint
ALTER TABLE audit_archive_items_rebuilt RENAME TO audit_archive_items;
--> statement-breakpoint
CREATE UNIQUE INDEX ux_audit_archive_items_audit ON audit_archive_items (audit_id);
--> statement-breakpoint
CREATE UNIQUE INDEX ux_audit_archive_items_position ON audit_archive_items (archive_id, position);
--> statement-breakpoint
CREATE INDEX idx_audit_log_occurred ON audit_log (occurred_at, id);
--> statement-breakpoint
CREATE INDEX idx_audit_log_actor_occurred ON audit_log (actor_id, occurred_at, id);
--> statement-breakpoint
CREATE INDEX idx_audit_log_subject_occurred ON audit_log (subject_type, occurred_at, id);
--> statement-breakpoint
CREATE INDEX idx_audit_log_target_occurred ON audit_log (subject_type, subject_id, occurred_at, id);
--> statement-breakpoint
CREATE INDEX idx_audit_log_request ON audit_log (request_id);
--> statement-breakpoint
CREATE TRIGGER audit_log_immutable
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit rows are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER audit_archive_items_pending_only
BEFORE INSERT ON audit_archive_items
WHEN NOT EXISTS (
  SELECT 1 FROM audit_archives
  WHERE id = NEW.archive_id AND status = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'audit archive is not pending');
END;
--> statement-breakpoint
CREATE TRIGGER audit_archive_items_immutable
BEFORE UPDATE ON audit_archive_items
BEGIN
  SELECT RAISE(ABORT, 'audit archive items are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_delete_only_ready_archive
BEFORE DELETE ON audit_log
WHEN NOT EXISTS (
  SELECT 1
  FROM audit_archive_items AS items
  JOIN audit_archives AS archives ON archives.id = items.archive_id
  WHERE items.audit_id = OLD.id AND archives.status = 'ready'
)
AND NOT EXISTS (
  SELECT 1
  FROM system_test_artifacts AS artifacts
  JOIN system_test_runs AS runs ON runs.id = artifacts.run_id
  WHERE artifacts.artifact_type = 'audit_log'
    AND artifacts.artifact_key = OLD.id
    AND runs.status = 'cleaning'
)
BEGIN
  SELECT RAISE(ABORT, 'audit rows may only be deleted after archive finalization');
END;
--> statement-breakpoint
CREATE TRIGGER audit_archives_finalize_consistent
BEFORE UPDATE OF status ON audit_archives
WHEN OLD.status = 'pending' AND NEW.status = 'ready'
  AND (
    NEW.row_count < 1
    OR NEW.row_count <> (SELECT COUNT(*) FROM audit_archive_items WHERE archive_id = OLD.id)
  )
BEGIN
  SELECT RAISE(ABORT, 'audit archive item count mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER system_test_audit_artifact_registry
AFTER INSERT ON audit_log
WHEN EXISTS (
  SELECT 1 FROM system_test_requests
  WHERE request_id = NEW.request_id
)
BEGIN
  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT run_id, 'audit_log', NEW.id, NEW.request_id, NEW.occurred_at
  FROM system_test_requests
  WHERE request_id = NEW.request_id;

  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT requests.run_id,
    CASE
      WHEN NEW.subject_type = 'user' AND NEW.action IN ('create', 'register', 'admin_create_member') THEN 'user'
      WHEN NEW.subject_type = 'invite_link' AND NEW.action = 'create' THEN 'invite_link'
      WHEN NEW.subject_type = 'role' AND NEW.action = 'create' THEN 'role'
      WHEN NEW.subject_type = 'event' AND NEW.action = 'create' THEN 'event'
      WHEN NEW.subject_type = 'recurring_template' AND NEW.action = 'create' THEN 'recurring_template'
      WHEN NEW.subject_type = 'announcement' AND NEW.action = 'create' THEN 'announcement'
      WHEN NEW.subject_type = 'gallery_item' AND NEW.action = 'create_video' THEN 'gallery_item'
      WHEN NEW.subject_type = 'guild_war_history' AND NEW.action IN ('create', 'conclude') THEN 'guild_war'
      WHEN NEW.subject_type = 'wiki_category' AND NEW.action = 'create' THEN 'wiki_category'
      WHEN NEW.subject_type = 'wiki_article' AND NEW.action = 'create' THEN 'wiki_article'
      WHEN NEW.subject_type IN ('badge', 'member_badge') AND NEW.action = 'create' THEN 'badge'
      WHEN NEW.subject_type = 'storage' AND NEW.action = 'create' THEN 'storage'
      WHEN NEW.subject_type = 'storage_category' AND NEW.action = 'create' THEN 'storage_category'
      WHEN NEW.subject_type = 'storage_item' AND NEW.action = 'create' THEN 'storage_item'
      WHEN NEW.subject_type = 'storage_transaction' AND NEW.action IN ('intake', 'distribute', 'adjust') THEN 'storage_batch'
      WHEN NEW.subject_type = 'media_asset' AND NEW.action = 'upload' THEN 'media_asset'
      WHEN NEW.subject_type = 'class_catalog' AND NEW.action = 'create' THEN 'class_catalog'
      WHEN NEW.subject_type = 'class_tag' AND NEW.action = 'create' THEN 'class_tag'
      WHEN NEW.subject_type = 'member_absence' AND NEW.action = 'create' THEN 'member_absence'
    END,
    NEW.subject_id,
    NEW.request_id,
    NEW.occurred_at
  FROM system_test_requests AS requests
  WHERE requests.request_id = NEW.request_id
    AND (
      (NEW.subject_type = 'user' AND NEW.action IN ('create', 'register', 'admin_create_member'))
      OR (NEW.subject_type = 'invite_link' AND NEW.action = 'create')
      OR (NEW.subject_type = 'role' AND NEW.action = 'create')
      OR (NEW.subject_type = 'event' AND NEW.action = 'create')
      OR (NEW.subject_type = 'recurring_template' AND NEW.action = 'create')
      OR (NEW.subject_type = 'announcement' AND NEW.action = 'create')
      OR (NEW.subject_type = 'gallery_item' AND NEW.action = 'create_video')
      OR (NEW.subject_type = 'guild_war_history' AND NEW.action IN ('create', 'conclude'))
      OR (NEW.subject_type = 'wiki_category' AND NEW.action = 'create')
      OR (NEW.subject_type = 'wiki_article' AND NEW.action = 'create')
      OR (NEW.subject_type IN ('badge', 'member_badge') AND NEW.action = 'create')
      OR (NEW.subject_type = 'storage' AND NEW.action = 'create')
      OR (NEW.subject_type = 'storage_category' AND NEW.action = 'create')
      OR (NEW.subject_type = 'storage_item' AND NEW.action = 'create')
      OR (NEW.subject_type = 'storage_transaction' AND NEW.action IN ('intake', 'distribute', 'adjust'))
      OR (NEW.subject_type = 'media_asset' AND NEW.action = 'upload')
      OR (NEW.subject_type = 'class_catalog' AND NEW.action = 'create')
      OR (NEW.subject_type = 'class_tag' AND NEW.action = 'create')
      OR (NEW.subject_type = 'member_absence' AND NEW.action = 'create')
    );

  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT requests.run_id, 'gallery_item', items.id, NEW.request_id, NEW.occurred_at
  FROM system_test_requests AS requests
  JOIN json_each(CASE
    WHEN NEW.subject_type = 'gallery_item' AND NEW.action = 'upload_images'
      THEN '["' || replace(NEW.subject_id, ',', '","') || '"]'
    ELSE '[]'
  END) AS ids
  JOIN gallery_items AS items ON items.id = ids.value
  WHERE requests.request_id = NEW.request_id
    AND NEW.subject_type = 'gallery_item'
    AND NEW.action = 'upload_images';

  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT requests.run_id, 'guild_war', wars.id, NEW.request_id, NEW.occurred_at
  FROM system_test_requests AS requests
  JOIN guild_wars AS wars ON wars.event_id = NEW.subject_id
  WHERE requests.request_id = NEW.request_id
    AND NEW.subject_type = 'guild_war'
    AND NEW.action = 'init';
END;
--> statement-breakpoint
DROP TRIGGER auth_role_permission_identity_immutable;
--> statement-breakpoint
DROP TRIGGER auth_keep_last_role_manager_on_permission_delete;
--> statement-breakpoint
DROP TRIGGER auth_keep_last_role_manager_on_user_update;
--> statement-breakpoint
DROP TRIGGER auth_keep_last_role_manager_on_user_delete;
--> statement-breakpoint
ALTER TABLE role_permissions RENAME TO role_permissions_legacy;
--> statement-breakpoint
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY(role_id, permission),
  CONSTRAINT role_permissions_permission_valid CHECK(permission IN (
    'admin.users.view', 'admin.users.edit', 'admin.users.role', 'admin.users.activate',
    'admin.users.delete', 'admin.users.password', 'admin.invite.view', 'admin.invite.manage',
    'admin.audit.view', 'admin.audit.export', 'admin.status.view', 'admin.analytics.view',
    'admin.analytics.manage', 'admin.roles.view', 'admin.roles.manage', 'admin.siteConfig.manage',
    'admin.importantNotices.manage', 'admin.classes.manage', 'guildwar.teams.edit',
    'guildwar.history.edit', 'events.create', 'events.edit', 'events.archive', 'events.delete',
    'events.templates', 'announcements.create', 'announcements.edit', 'announcements.archive',
    'announcements.delete', 'gallery.upload', 'gallery.manage', 'gallery.delete',
    'wiki.articles.create', 'wiki.articles.edit', 'wiki.articles.archive', 'wiki.articles.delete',
    'wiki.categories.manage', 'admin.badges.manage', 'admin.storage.structure',
    'admin.storage.items', 'admin.storage.stock'
  ))
);
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission)
SELECT role_id, permission FROM role_permissions_legacy;
--> statement-breakpoint
DROP TABLE role_permissions_legacy;
--> statement-breakpoint
CREATE INDEX idx_role_permissions_permission ON role_permissions (permission, role_id);
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission)
SELECT 'admin', 'admin.importantNotices.manage'
WHERE EXISTS (SELECT 1 FROM roles WHERE id = 'admin')
ON CONFLICT(role_id, permission) DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER auth_role_permission_identity_immutable
BEFORE UPDATE OF role_id, permission ON role_permissions
WHEN OLD.role_id IS NOT NEW.role_id OR OLD.permission IS NOT NEW.permission
BEGIN
  SELECT RAISE(ABORT, 'role permission identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER auth_keep_last_role_manager_on_permission_delete
BEFORE DELETE ON role_permissions
WHEN OLD.permission = 'admin.roles.manage'
 AND EXISTS (
   SELECT 1
   FROM users u
   WHERE u.role_id = OLD.role_id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
 )
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.role_id <> OLD.role_id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND rp.permission = 'admin.roles.manage'
 )
BEGIN
  SELECT RAISE(ABORT, 'last role manager required');
END;
--> statement-breakpoint
CREATE TRIGGER auth_keep_last_role_manager_on_user_update
BEFORE UPDATE OF role_id, is_active, deleted_at ON users
WHEN OLD.is_active = 1
 AND OLD.deleted_at IS NULL
 AND EXISTS (
   SELECT 1 FROM role_permissions rp
   WHERE rp.role_id = OLD.role_id AND rp.permission = 'admin.roles.manage'
 )
 AND (
   NEW.is_active = 0
   OR NEW.deleted_at IS NOT NULL
   OR NOT EXISTS (
     SELECT 1 FROM role_permissions rp
     WHERE rp.role_id = NEW.role_id AND rp.permission = 'admin.roles.manage'
   )
 )
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.id <> OLD.id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND rp.permission = 'admin.roles.manage'
 )
BEGIN
  SELECT RAISE(ABORT, 'last role manager required');
END;
--> statement-breakpoint
CREATE TRIGGER auth_keep_last_role_manager_on_user_delete
BEFORE DELETE ON users
WHEN OLD.is_active = 1
 AND OLD.deleted_at IS NULL
 AND EXISTS (
   SELECT 1 FROM role_permissions rp
   WHERE rp.role_id = OLD.role_id AND rp.permission = 'admin.roles.manage'
 )
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.id <> OLD.id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND rp.permission = 'admin.roles.manage'
 )
BEGIN
  SELECT RAISE(ABORT, 'last role manager required');
END;
--> statement-breakpoint
CREATE TABLE notification_inbox (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  read_at TEXT,
  CONSTRAINT notification_inbox_kind_valid CHECK(kind IN (
    'member_joined', 'announcement_published', 'event_created', 'wiki_article_created'
  )),
  CONSTRAINT notification_inbox_entity_type_valid CHECK(entity_type IN (
    'member', 'announcement', 'event', 'wiki_article'
  )),
  CONSTRAINT notification_inbox_id_present CHECK(length(id) BETWEEN 16 AND 200),
  CONSTRAINT notification_inbox_entity_present CHECK(length(entity_id) BETWEEN 1 AND 200),
  CONSTRAINT notification_inbox_source_present CHECK(length(source_key) BETWEEN 1 AND 300),
  CONSTRAINT notification_inbox_payload_json CHECK(json_valid(payload_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX ux_notification_inbox_user_source ON notification_inbox (user_id, source_key);
--> statement-breakpoint
CREATE INDEX idx_notification_inbox_retention ON notification_inbox (occurred_at, id);
--> statement-breakpoint
CREATE INDEX idx_notification_inbox_user_occurred ON notification_inbox (user_id, occurred_at, id);
--> statement-breakpoint
CREATE INDEX idx_notification_inbox_user_unread ON notification_inbox (user_id, read_at, occurred_at, id);
--> statement-breakpoint
CREATE TABLE important_notices (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body_json TEXT NOT NULL,
  status TEXT NOT NULL,
  publish_at TEXT,
  expires_at TEXT,
  publication_revision INTEGER NOT NULL DEFAULT 0,
  revision_token TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT important_notices_status_valid CHECK(status IN ('draft', 'scheduled', 'published', 'withdrawn')),
  CONSTRAINT important_notices_title_present CHECK(length(title) BETWEEN 1 AND 200),
  CONSTRAINT important_notices_body_json CHECK(json_valid(body_json)),
  CONSTRAINT important_notices_revision_present CHECK(length(revision_token) >= 16),
  CONSTRAINT important_notices_publication_revision_valid CHECK(publication_revision >= 0),
  CONSTRAINT important_notices_state_consistent CHECK(
    (status = 'draft' AND publish_at IS NULL AND publication_revision >= 0)
    OR (status IN ('scheduled', 'published') AND publish_at IS NOT NULL AND publication_revision >= 1)
    OR (status = 'withdrawn' AND publication_revision >= 1)
  ),
  CONSTRAINT important_notices_expiry_after_publish CHECK(
    expires_at IS NULL OR publish_at IS NULL OR expires_at > publish_at
  )
);
--> statement-breakpoint
CREATE INDEX idx_important_notices_active ON important_notices (status, publish_at, expires_at, id);
--> statement-breakpoint
CREATE INDEX idx_important_notices_admin ON important_notices (status, updated_at, id);
--> statement-breakpoint
CREATE TABLE important_notice_acknowledgements (
  notice_id TEXT NOT NULL REFERENCES important_notices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  publication_revision INTEGER NOT NULL,
  acknowledged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(notice_id, user_id, publication_revision),
  CONSTRAINT important_notice_ack_revision_valid CHECK(publication_revision > 0)
);
--> statement-breakpoint
CREATE INDEX idx_important_notice_ack_user ON important_notice_acknowledgements (user_id, notice_id, publication_revision);
--> statement-breakpoint
CREATE TRIGGER notification_inbox_member_joined
AFTER INSERT ON users
WHEN NEW.is_active = 1 AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'member_joined', 'member', NEW.id,
    'member_joined:' || NEW.id, json_object('username', NEW.username), NEW.created_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL AND recipients.id <> NEW.id
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER notification_inbox_announcement_published_insert
AFTER INSERT ON announcements
WHEN NEW.status = 'published' AND NEW.publish_at IS NOT NULL
  AND NEW.publish_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'announcement_published', 'announcement', NEW.id,
    'announcement_published:' || NEW.id, json_object('title', NEW.title), NEW.publish_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER notification_inbox_announcement_published_update
AFTER UPDATE OF status ON announcements
WHEN OLD.status <> 'published' AND NEW.status = 'published' AND NEW.publish_at IS NOT NULL
  AND NEW.publish_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'announcement_published', 'announcement', NEW.id,
    'announcement_published:' || NEW.id, json_object('title', NEW.title), NEW.publish_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER notification_inbox_event_created
AFTER INSERT ON events
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'event_created', 'event', NEW.id,
    'event_created:' || NEW.id, json_object('title', NEW.title, 'start_at', NEW.start_at), NEW.created_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER notification_inbox_wiki_article_created
AFTER INSERT ON wiki_articles
WHEN NEW.archived_at IS NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'wiki_article_created', 'wiki_article', NEW.id,
    'wiki_article_created:' || NEW.id, json_object('title', NEW.title, 'slug', NEW.slug), NEW.created_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
--> statement-breakpoint
-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0001_notifications', 1, 'eeac006b5ac111e6b94d42572f316591773a51ed922d86d4fd17d84daedf767b');
