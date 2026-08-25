ALTER TABLE `user_credentials` ADD COLUMN `temporary_password_expires_at` text;--> statement-breakpoint
ALTER TABLE `user_credentials` ADD COLUMN `temporary_password_used_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `scope` text NOT NULL DEFAULT 'normal' CONSTRAINT "sessions_scope_valid" CHECK (`scope` IN ('normal', 'password_change'));--> statement-breakpoint
-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0002_auth_hardening', 2, '116fd617c7db31ba6e9ddb54ba46e0c182dc73941c60e6f8e870d8ec34c367af');
