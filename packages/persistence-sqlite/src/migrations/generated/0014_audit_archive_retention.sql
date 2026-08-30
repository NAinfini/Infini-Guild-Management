DROP TRIGGER IF EXISTS audit_archives_ready_delete_forbidden;--> statement-breakpoint
CREATE INDEX idx_audit_archives_retention ON audit_archives (status, completed_at, id);--> statement-breakpoint

-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0014_audit_archive_retention', 14, '5ec1667d6c8e673025f87b19aa6c11505e290b55b70410876ad1c99ee8baeb91');
