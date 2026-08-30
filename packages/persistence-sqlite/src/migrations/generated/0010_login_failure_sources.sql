DROP TRIGGER IF EXISTS `auth_login_failure_cleanup_after_user_delete`;--> statement-breakpoint
CREATE TABLE `__new_login_failures` (
	`login_name` text NOT NULL,
	`source_digest` text NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_failed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`login_name`, `source_digest`),
	CONSTRAINT "login_failures_count_nonnegative" CHECK("fail_count" >= 0),
	CONSTRAINT "login_failures_source_digest_valid" CHECK(length("source_digest") = 43 AND "source_digest" NOT GLOB '*[^A-Za-z0-9_-]*')
);--> statement-breakpoint
DROP TABLE `login_failures`;--> statement-breakpoint
ALTER TABLE `__new_login_failures` RENAME TO `login_failures`;--> statement-breakpoint
CREATE INDEX `idx_login_failures_last_failed` ON `login_failures` (`last_failed_at`,`login_name`,`source_digest`);--> statement-breakpoint
CREATE INDEX `idx_login_failures_name_last_failed` ON `login_failures` (`login_name`,`last_failed_at`,`source_digest`);--> statement-breakpoint
CREATE TRIGGER auth_login_failure_cleanup_after_user_delete
BEFORE DELETE ON users
BEGIN
  DELETE FROM login_failures
  WHERE login_name = lower((SELECT login_name FROM user_credentials WHERE user_id = OLD.id));
END;--> statement-breakpoint
-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0010_login_failure_sources', 10, '20caad367837fb888ad5664f30767760ff060dd3cd9305d0e726085f0a34a4cd');
