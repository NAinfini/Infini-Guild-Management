ALTER TABLE `user_credentials` ADD COLUMN `auth_revision` integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `auth_revision` integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `oauth_challenges` ADD COLUMN `auth_revision` integer;--> statement-breakpoint
CREATE INDEX `idx_email_verification_challenges_user_last_sent` ON `email_verification_challenges` (`user_id`,`last_sent_at`);--> statement-breakpoint
-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0006_auth_lifecycle_hardening', 6, '92df36c19a96807bbb1e581347a74f2b0dd819ecf296b1426de1849852dcd187');
