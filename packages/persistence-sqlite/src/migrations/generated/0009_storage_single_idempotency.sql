ALTER TABLE `storage_batches` ADD COLUMN `request_fingerprint` text
  CONSTRAINT "storage_batches_request_fingerprint_valid" CHECK(
    `request_fingerprint` IS NULL OR (
      length(`request_fingerprint`) = 64
      AND `request_fingerprint` NOT GLOB '*[^0-9a-f]*'
    )
  );--> statement-breakpoint

-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0009_storage_single_idempotency', 9, '79e347dc5ebbd91aa59a5fe78e75b9490e7aadd6f9b51bd487f128ae12cb6516');
