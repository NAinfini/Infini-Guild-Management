CREATE TRIGGER audit_log_immutable
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit rows are immutable');
END;

CREATE TRIGGER audit_archive_items_pending_only
BEFORE INSERT ON audit_archive_items
WHEN NOT EXISTS (
  SELECT 1 FROM audit_archives
  WHERE id = NEW.archive_id AND status = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'audit archive is not pending');
END;

CREATE TRIGGER audit_archive_items_immutable
BEFORE UPDATE ON audit_archive_items
BEGIN
  SELECT RAISE(ABORT, 'audit archive items are immutable');
END;

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

CREATE TRIGGER audit_archives_ready_immutable
BEFORE UPDATE ON audit_archives
WHEN OLD.status = 'ready'
BEGIN
  SELECT RAISE(ABORT, 'ready audit archives are immutable');
END;

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

CREATE TRIGGER audit_archives_ready_delete_forbidden
BEFORE DELETE ON audit_archives
WHEN OLD.status = 'ready'
BEGIN
  SELECT RAISE(ABORT, 'ready audit archives cannot be deleted');
END;
