CREATE TRIGGER system_test_runs_identity_immutable
BEFORE UPDATE OF id, actor_user_id, created_at, expires_at ON system_test_runs
WHEN OLD.id IS NOT NEW.id
  OR OLD.actor_user_id IS NOT NEW.actor_user_id
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.expires_at IS NOT NEW.expires_at
BEGIN
  SELECT RAISE(ABORT, 'system test run identity is immutable');
END;

CREATE TRIGGER system_test_runs_status_transition
BEFORE UPDATE OF status ON system_test_runs
WHEN OLD.status <> NEW.status AND NOT (
  (OLD.status = 'running' AND NEW.status = 'cleaning')
  OR (OLD.status = 'cleaning' AND NEW.status IN ('cleanup_failed', 'completed'))
  OR (OLD.status = 'cleanup_failed' AND NEW.status = 'cleaning')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid system test run status transition');
END;

CREATE TRIGGER system_test_requests_active_run_insert
BEFORE INSERT ON system_test_requests
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_runs AS runs
  WHERE runs.id = NEW.run_id
    AND runs.status = 'running'
    AND (
      NEW.actor_user_id IS NULL
      OR runs.actor_user_id = NEW.actor_user_id
      OR EXISTS (
        SELECT 1 FROM system_test_artifacts AS artifacts
        WHERE artifacts.run_id = runs.id
          AND artifacts.artifact_type = 'user'
          AND artifacts.artifact_key = NEW.actor_user_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'system test request is not bound to an active run actor');
END;

CREATE TRIGGER system_test_requests_immutable
BEFORE UPDATE ON system_test_requests
BEGIN
  SELECT RAISE(ABORT, 'system test requests are immutable');
END;

CREATE TRIGGER system_test_artifacts_active_request_insert
BEFORE INSERT ON system_test_artifacts
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_requests AS requests
  JOIN system_test_runs AS runs ON runs.id = requests.run_id
  WHERE requests.request_id = NEW.request_id
    AND requests.run_id = NEW.run_id
    AND runs.status = 'running'
)
BEGIN
  SELECT RAISE(ABORT, 'system test artifact requires its active request');
END;

CREATE TRIGGER system_test_artifacts_immutable
BEFORE UPDATE ON system_test_artifacts
BEGIN
  SELECT RAISE(ABORT, 'system test artifacts are immutable');
END;

CREATE TRIGGER system_test_artifacts_cleanup_delete_only
BEFORE DELETE ON system_test_artifacts
WHEN EXISTS (SELECT 1 FROM system_test_runs WHERE id = OLD.run_id)
  AND NOT EXISTS (
    SELECT 1 FROM system_test_runs
    WHERE id = OLD.run_id AND status = 'cleaning'
  )
BEGIN
  SELECT RAISE(ABORT, 'system test artifacts may only be deleted during cleanup');
END;

CREATE TRIGGER system_test_before_images_active_request_insert
BEFORE INSERT ON system_test_before_images
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_requests AS requests
  JOIN system_test_runs AS runs ON runs.id = requests.run_id
  WHERE requests.request_id = NEW.request_id
    AND requests.run_id = NEW.run_id
    AND runs.status = 'running'
)
OR EXISTS (
  SELECT 1 FROM system_test_artifacts AS artifacts
  WHERE artifacts.run_id = NEW.run_id
    AND artifacts.artifact_type = NEW.target_type
    AND artifacts.artifact_key = NEW.target_id
)
OR NOT (
  (NEW.target_type = 'class_catalog' AND EXISTS (
    SELECT 1 FROM class_catalog
    WHERE id = NEW.target_id
      AND sort_order = NEW.before_sort_order
      AND updated_at = NEW.before_updated_at
  ))
  OR (NEW.target_type = 'class_tag' AND EXISTS (
    SELECT 1 FROM class_tags
    WHERE id = NEW.target_id
      AND owner_kind IS NULL
      AND sort_order = NEW.before_sort_order
      AND updated_at = NEW.before_updated_at
  ))
  OR (NEW.target_type = 'badge' AND EXISTS (
    SELECT 1 FROM member_badges
    WHERE id = NEW.target_id
      AND sort_order = NEW.before_sort_order
      AND updated_at = NEW.before_updated_at
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'system test before-image requires an active request and exact existing target');
END;

CREATE TRIGGER system_test_before_images_guard_update
BEFORE UPDATE ON system_test_before_images
WHEN OLD.run_id IS NOT NEW.run_id
  OR OLD.target_type IS NOT NEW.target_type
  OR OLD.target_id IS NOT NEW.target_id
  OR OLD.before_sort_order IS NOT NEW.before_sort_order
  OR OLD.before_updated_at IS NOT NEW.before_updated_at
  OR OLD.created_at IS NOT NEW.created_at
  OR NOT EXISTS (
    SELECT 1
    FROM system_test_requests AS requests
    JOIN system_test_runs AS runs ON runs.id = requests.run_id
    WHERE requests.request_id = NEW.request_id
      AND requests.run_id = NEW.run_id
      AND runs.status = 'running'
  )
BEGIN
  SELECT RAISE(ABORT, 'system test before-image original state is immutable');
END;

CREATE TRIGGER system_test_before_images_cleanup_delete_only
BEFORE DELETE ON system_test_before_images
WHEN EXISTS (SELECT 1 FROM system_test_runs WHERE id = OLD.run_id)
  AND (
    NOT EXISTS (
      SELECT 1 FROM system_test_runs
      WHERE id = OLD.run_id AND status = 'cleaning'
    )
    OR NOT (
      (OLD.target_type = 'class_catalog' AND EXISTS (
        SELECT 1 FROM class_catalog
        WHERE id = OLD.target_id
          AND sort_order = OLD.before_sort_order
          AND updated_at = OLD.before_updated_at
      ))
      OR (OLD.target_type = 'class_tag' AND EXISTS (
        SELECT 1 FROM class_tags
        WHERE id = OLD.target_id
          AND owner_kind IS NULL
          AND sort_order = OLD.before_sort_order
          AND updated_at = OLD.before_updated_at
      ))
      OR (OLD.target_type = 'badge' AND EXISTS (
        SELECT 1 FROM member_badges
        WHERE id = OLD.target_id
          AND sort_order = OLD.before_sort_order
          AND updated_at = OLD.before_updated_at
      ))
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'system test before-image may only be deleted after exact cleanup restore');
END;

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
      WHEN NEW.entity_type = 'user' AND NEW.action IN ('create', 'register', 'admin_create_member') THEN 'user'
      WHEN NEW.entity_type = 'invite_link' AND NEW.action = 'create' THEN 'invite_link'
      WHEN NEW.entity_type = 'role' AND NEW.action = 'create' THEN 'role'
      WHEN NEW.entity_type = 'event' AND NEW.action = 'create' THEN 'event'
      WHEN NEW.entity_type = 'recurring_template' AND NEW.action = 'create' THEN 'recurring_template'
      WHEN NEW.entity_type = 'announcement' AND NEW.action = 'create' THEN 'announcement'
      WHEN NEW.entity_type = 'gallery_item' AND NEW.action = 'create_video' THEN 'gallery_item'
      WHEN NEW.entity_type = 'guild_war_history' AND NEW.action IN ('create', 'conclude') THEN 'guild_war'
      WHEN NEW.entity_type = 'wiki_category' AND NEW.action = 'create' THEN 'wiki_category'
      WHEN NEW.entity_type = 'wiki_article' AND NEW.action = 'create' THEN 'wiki_article'
      WHEN NEW.entity_type IN ('badge', 'member_badge') AND NEW.action = 'create' THEN 'badge'
      WHEN NEW.entity_type = 'storage' AND NEW.action = 'create' THEN 'storage'
      WHEN NEW.entity_type = 'storage_category' AND NEW.action = 'create' THEN 'storage_category'
      WHEN NEW.entity_type = 'storage_item' AND NEW.action = 'create' THEN 'storage_item'
      WHEN NEW.entity_type = 'storage_transaction' AND NEW.action IN ('intake', 'distribute', 'adjust') THEN 'storage_batch'
      WHEN NEW.entity_type = 'media_asset' AND NEW.action = 'upload' THEN 'media_asset'
      WHEN NEW.entity_type = 'class_catalog' AND NEW.action = 'create' THEN 'class_catalog'
      WHEN NEW.entity_type = 'class_tag' AND NEW.action = 'create' THEN 'class_tag'
      WHEN NEW.entity_type = 'member_absence' AND NEW.action = 'create' THEN 'member_absence'
    END,
    NEW.entity_id,
    NEW.request_id,
    NEW.occurred_at
  FROM system_test_requests AS requests
  WHERE requests.request_id = NEW.request_id
    AND (
      (NEW.entity_type = 'user' AND NEW.action IN ('create', 'register', 'admin_create_member'))
      OR (NEW.entity_type = 'invite_link' AND NEW.action = 'create')
      OR (NEW.entity_type = 'role' AND NEW.action = 'create')
      OR (NEW.entity_type = 'event' AND NEW.action = 'create')
      OR (NEW.entity_type = 'recurring_template' AND NEW.action = 'create')
      OR (NEW.entity_type = 'announcement' AND NEW.action = 'create')
      OR (NEW.entity_type = 'gallery_item' AND NEW.action = 'create_video')
      OR (NEW.entity_type = 'guild_war_history' AND NEW.action IN ('create', 'conclude'))
      OR (NEW.entity_type = 'wiki_category' AND NEW.action = 'create')
      OR (NEW.entity_type = 'wiki_article' AND NEW.action = 'create')
      OR (NEW.entity_type IN ('badge', 'member_badge') AND NEW.action = 'create')
      OR (NEW.entity_type = 'storage' AND NEW.action = 'create')
      OR (NEW.entity_type = 'storage_category' AND NEW.action = 'create')
      OR (NEW.entity_type = 'storage_item' AND NEW.action = 'create')
      OR (NEW.entity_type = 'storage_transaction' AND NEW.action IN ('intake', 'distribute', 'adjust'))
      OR (NEW.entity_type = 'media_asset' AND NEW.action = 'upload')
      OR (NEW.entity_type = 'class_catalog' AND NEW.action = 'create')
      OR (NEW.entity_type = 'class_tag' AND NEW.action = 'create')
      OR (NEW.entity_type = 'member_absence' AND NEW.action = 'create')
    );

  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT requests.run_id, 'gallery_item', items.id, NEW.request_id, NEW.occurred_at
  FROM system_test_requests AS requests
  JOIN json_each(CASE
    WHEN NEW.entity_type = 'gallery_item' AND NEW.action = 'upload_images'
      THEN '["' || replace(NEW.entity_id, ',', '","') || '"]'
    ELSE '[]'
  END) AS ids
  JOIN gallery_items AS items ON items.id = ids.value
  WHERE requests.request_id = NEW.request_id
    AND NEW.entity_type = 'gallery_item'
    AND NEW.action = 'upload_images';

  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT requests.run_id, 'guild_war', wars.id, NEW.request_id, NEW.occurred_at
  FROM system_test_requests AS requests
  JOIN guild_wars AS wars ON wars.event_id = NEW.entity_id
  WHERE requests.request_id = NEW.request_id
    AND NEW.entity_type = 'guild_war'
    AND NEW.action = 'init';
END;

CREATE TRIGGER system_test_error_artifact_registry
AFTER INSERT ON error_log
WHEN NEW.request_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM system_test_requests
    WHERE request_id = NEW.request_id
  )
BEGIN
  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT run_id, 'error_log', NEW.id, NEW.request_id, NEW.created_at
  FROM system_test_requests
  WHERE request_id = NEW.request_id;
END;
