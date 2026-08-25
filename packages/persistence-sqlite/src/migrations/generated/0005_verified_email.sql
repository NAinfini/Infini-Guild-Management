CREATE TABLE `user_emails` (
  `user_id` text PRIMARY KEY NOT NULL,
  `normalized_email` text NOT NULL,
  `verified_at` text NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_user_emails_normalized_nocase` ON `user_emails` (`normalized_email` COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `email_verification_challenges` (
  `token_digest` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `pending_email` text NOT NULL,
  `expires_at` text NOT NULL,
  `consumed_at` text,
  `sent_count` integer DEFAULT 1 NOT NULL,
  `last_sent_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "email_verification_challenges_sent_count" CHECK(`sent_count` >= 1)
);--> statement-breakpoint
CREATE INDEX `idx_email_verification_challenges_user` ON `email_verification_challenges` (`user_id`,`expires_at`);--> statement-breakpoint
-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0005_verified_email', 5, 'f8661004d5a116fadd43d9949eda50b854960a03d4e3ccd02d96a5a1219ee27d');
