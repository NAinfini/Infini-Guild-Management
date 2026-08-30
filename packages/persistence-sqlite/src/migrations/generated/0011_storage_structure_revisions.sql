ALTER TABLE `storages` ADD COLUMN `structure_revision` integer DEFAULT 0 NOT NULL
  CONSTRAINT "storages_structure_revision_nonnegative" CHECK(`structure_revision` >= 0);--> statement-breakpoint

CREATE TRIGGER storage_ledger_advance_item_revision
AFTER INSERT ON storage_ledger_entries
BEGIN
  UPDATE storage_items
  SET updated_at = CASE
    WHEN julianday(updated_at) IS NOT NULL
      AND julianday(updated_at) >= julianday(NEW.created_at)
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', julianday(updated_at) + 0.001 / 86400.0)
    ELSE NEW.created_at
  END
  WHERE id = NEW.item_id;

  SELECT CASE WHEN changes() <> 1
    THEN RAISE(ABORT, 'storage_item_revision_update_failed')
  END;
END;--> statement-breakpoint

-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0011_storage_structure_revisions', 11, 'eae62a97fd9577585074113b3c79f89983032921e589b33a93fed9b505970161');
