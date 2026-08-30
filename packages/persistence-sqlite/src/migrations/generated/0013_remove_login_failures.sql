DROP TRIGGER IF EXISTS auth_login_failure_cleanup_after_user_delete;--> statement-breakpoint
DROP TABLE login_failures;--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_immutable;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_archive_items_pending_only;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_archive_items_immutable;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_delete_only_ready_archive;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_archives_finalize_consistent;--> statement-breakpoint
DROP TRIGGER IF EXISTS system_test_audit_artifact_registry;--> statement-breakpoint

CREATE TABLE __audit_archive_items_backup (
  archive_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(archive_id, audit_id)
);--> statement-breakpoint
INSERT INTO __audit_archive_items_backup (archive_id, audit_id, position)
SELECT archive_id, audit_id, position FROM audit_archive_items;--> statement-breakpoint
DROP TABLE audit_archive_items;--> statement-breakpoint

CREATE TABLE __new_audit_log (
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
    'intake', 'join', 'leave', 'move_member', 'pause', 'publish', 'raffle_draw',
    'reactivate', 'register', 'reorder', 'reset_password', 'rollback', 'run', 'resume',
    'revoke', 'save_teams', 'set_role_tag', 'unassign', 'update', 'update_role', 'upload',
    'upload_audio', 'upload_avatar', 'upload_icon', 'upload_images', 'withdraw', 'vote'
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
);--> statement-breakpoint

INSERT INTO __new_audit_log (
  id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
  subject_label, action, payload_json, occurred_at
)
SELECT
  id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id, subject_label,
  CASE WHEN action IN ('login_failed', 'reset_login_lock') THEN 'update' ELSE action END,
  json_set(
    payload_json,
    '$.changes',
    json((
      SELECT json_group_array(json(
        CASE json_extract(change.value, '$.field')
          WHEN 'failed_attempts' THEN json_set(change.value, '$.field', 'count')
          WHEN 'locked_until' THEN json_set(change.value, '$.field', 'expires_at')
          ELSE change.value
        END
      ))
      FROM json_each(payload_json, '$.changes') AS change
    )),
    '$.context',
    json((
      SELECT json_group_array(json(
        CASE json_extract(context.value, '$.field')
          WHEN 'failed_attempts' THEN json_set(context.value, '$.field', 'count')
          WHEN 'locked_until' THEN json_set(context.value, '$.field', 'expires_at')
          ELSE context.value
        END
      ))
      FROM json_each(payload_json, '$.context') AS context
    ))
  ),
  occurred_at
FROM audit_log;--> statement-breakpoint

DROP TABLE audit_log;--> statement-breakpoint
ALTER TABLE __new_audit_log RENAME TO audit_log;--> statement-breakpoint
CREATE INDEX idx_audit_log_occurred ON audit_log (occurred_at, id);--> statement-breakpoint
CREATE INDEX idx_audit_log_actor_occurred ON audit_log (actor_id, occurred_at, id);--> statement-breakpoint
CREATE INDEX idx_audit_log_subject_occurred ON audit_log (subject_type, occurred_at, id);--> statement-breakpoint
CREATE INDEX idx_audit_log_target_occurred ON audit_log (subject_type, subject_id, occurred_at, id);--> statement-breakpoint
CREATE INDEX idx_audit_log_request ON audit_log (request_id);--> statement-breakpoint

CREATE TABLE audit_archive_items (
  archive_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(archive_id, audit_id),
  FOREIGN KEY (archive_id) REFERENCES audit_archives(id) ON DELETE CASCADE,
  FOREIGN KEY (audit_id) REFERENCES audit_log(id) ON DELETE CASCADE,
  CONSTRAINT audit_archive_items_position_valid CHECK(position BETWEEN 0 AND 99)
);--> statement-breakpoint
INSERT INTO audit_archive_items (archive_id, audit_id, position)
SELECT archive_id, audit_id, position FROM __audit_archive_items_backup;--> statement-breakpoint
DROP TABLE __audit_archive_items_backup;--> statement-breakpoint
CREATE UNIQUE INDEX ux_audit_archive_items_audit ON audit_archive_items (audit_id);--> statement-breakpoint
CREATE UNIQUE INDEX ux_audit_archive_items_position ON audit_archive_items (archive_id, position);--> statement-breakpoint

CREATE TRIGGER audit_log_immutable
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit rows are immutable');
END;--> statement-breakpoint

CREATE TRIGGER audit_archive_items_pending_only
BEFORE INSERT ON audit_archive_items
WHEN NOT EXISTS (
  SELECT 1 FROM audit_archives
  WHERE id = NEW.archive_id AND status = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'audit archive is not pending');
END;--> statement-breakpoint

CREATE TRIGGER audit_archive_items_immutable
BEFORE UPDATE ON audit_archive_items
BEGIN
  SELECT RAISE(ABORT, 'audit archive items are immutable');
END;--> statement-breakpoint

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
END;--> statement-breakpoint

CREATE TRIGGER audit_archives_finalize_consistent
BEFORE UPDATE OF status ON audit_archives
WHEN OLD.status = 'pending' AND NEW.status = 'ready'
  AND (
    NEW.row_count < 1
    OR NEW.row_count <> (SELECT COUNT(*) FROM audit_archive_items WHERE archive_id = OLD.id)
  )
BEGIN
  SELECT RAISE(ABORT, 'audit archive item count mismatch');
END;--> statement-breakpoint

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
END;--> statement-breakpoint

-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0013_remove_login_failures', 13, 'fb1a6ec8d2c51d03b5356e00e53793b19c9fe77d8b149ad99f213adbcee82f19');
