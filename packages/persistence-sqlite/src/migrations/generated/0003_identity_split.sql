DROP TRIGGER IF EXISTS `auth_login_failure_cleanup_after_user_delete`;--> statement-breakpoint
ALTER TABLE `users` RENAME COLUMN `username` TO `display_name`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `notification_inbox_member_joined`;--> statement-breakpoint
UPDATE `notification_inbox`
SET `payload_json` = json_set(json_remove(`payload_json`, '$.username'), '$.display_name', json_extract(`payload_json`, '$.username'))
WHERE `kind` = 'member_joined' AND json_type(`payload_json`, '$.username') = 'text';--> statement-breakpoint
CREATE TRIGGER notification_inbox_member_joined
AFTER INSERT ON users
WHEN NEW.is_active = 1 AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'member_joined', 'member', NEW.id,
    'member_joined:' || NEW.id, json_object('display_name', NEW.display_name), NEW.created_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL AND recipients.id <> NEW.id
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;--> statement-breakpoint
DROP INDEX `ux_users_username_nocase`;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_users_display_name_nocase` ON `users` (`display_name` COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `__new_user_credentials` (
  `user_id` text PRIMARY KEY NOT NULL,
  `login_name` text NOT NULL,
  `password_hash` text NOT NULL,
  `temporary_password_expires_at` text,
  `temporary_password_used_at` text,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_user_credentials` (`user_id`, `login_name`, `password_hash`, `temporary_password_expires_at`, `temporary_password_used_at`, `updated_at`)
SELECT `credentials`.`user_id`, `users`.`display_name`, `credentials`.`password_hash`,
  `credentials`.`temporary_password_expires_at`, `credentials`.`temporary_password_used_at`, `credentials`.`updated_at`
FROM `user_credentials` AS `credentials`
JOIN `users` ON `users`.`id` = `credentials`.`user_id`;--> statement-breakpoint
DROP TABLE `user_credentials`;--> statement-breakpoint
ALTER TABLE `__new_user_credentials` RENAME TO `user_credentials`;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_user_credentials_login_name_nocase` ON `user_credentials` (`login_name` COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `__new_login_failures` (
  `login_name` text PRIMARY KEY NOT NULL,
  `fail_count` integer DEFAULT 0 NOT NULL,
  `locked_until` text,
  `last_failed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  CONSTRAINT "login_failures_count_nonnegative" CHECK("fail_count" >= 0)
);--> statement-breakpoint
INSERT INTO `__new_login_failures` (`login_name`, `fail_count`, `locked_until`, `last_failed_at`)
SELECT `username`, `fail_count`, `locked_until`, `last_failed_at` FROM `login_failures`;--> statement-breakpoint
DROP TABLE `login_failures`;--> statement-breakpoint
ALTER TABLE `__new_login_failures` RENAME TO `login_failures`;--> statement-breakpoint
CREATE INDEX `idx_login_failures_last_failed` ON `login_failures` (`last_failed_at`);--> statement-breakpoint
CREATE TRIGGER auth_login_failure_cleanup_after_user_delete
BEFORE DELETE ON users
BEGIN
  DELETE FROM login_failures
  WHERE login_name = lower((SELECT login_name FROM user_credentials WHERE user_id = OLD.id));
END;--> statement-breakpoint
-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0003_identity_split', 3, '20ebcd903479ace252a455dd1101ccb991160a902b69563e31ebd60558ed7dff');
