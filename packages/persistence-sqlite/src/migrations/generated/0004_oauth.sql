CREATE TABLE `external_identities` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `provider` text NOT NULL,
  `provider_subject` text NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `last_used_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "external_identities_provider_valid" CHECK(`provider` IN ('google', 'discord', 'kook', 'wechat'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_external_identities_provider_subject` ON `external_identities` (`provider`,`provider_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_external_identities_user_provider` ON `external_identities` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `idx_external_identities_user` ON `external_identities` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `oauth_challenges` (
  `state_digest` text PRIMARY KEY NOT NULL,
  `browser_binding_digest` text NOT NULL,
  `provider` text NOT NULL,
  `purpose` text NOT NULL,
  `user_id` text,
  `nonce` text,
  `pkce_verifier` text,
  `expires_at` text NOT NULL,
  `consumed_at` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "oauth_challenges_provider_valid" CHECK(`provider` IN ('google', 'discord', 'kook', 'wechat')),
  CONSTRAINT "oauth_challenges_purpose_valid" CHECK(`purpose` IN ('login', 'link')),
  CONSTRAINT "oauth_challenges_link_user" CHECK((`purpose` = 'link' AND `user_id` IS NOT NULL) OR (`purpose` = 'login' AND `user_id` IS NULL))
);--> statement-breakpoint
CREATE INDEX `idx_oauth_challenges_expiry` ON `oauth_challenges` (`expires_at`);--> statement-breakpoint
ALTER TABLE `site_config` ADD COLUMN `oauth_google_enabled` integer NOT NULL DEFAULT 0 CONSTRAINT "site_config_oauth_google_boolean" CHECK (`oauth_google_enabled` IN (0, 1));--> statement-breakpoint
ALTER TABLE `site_config` ADD COLUMN `oauth_discord_enabled` integer NOT NULL DEFAULT 0 CONSTRAINT "site_config_oauth_discord_boolean" CHECK (`oauth_discord_enabled` IN (0, 1));--> statement-breakpoint
ALTER TABLE `site_config` ADD COLUMN `oauth_kook_enabled` integer NOT NULL DEFAULT 0 CONSTRAINT "site_config_oauth_kook_boolean" CHECK (`oauth_kook_enabled` IN (0, 1));--> statement-breakpoint
ALTER TABLE `site_config` ADD COLUMN `oauth_wechat_enabled` integer NOT NULL DEFAULT 0 CONSTRAINT "site_config_oauth_wechat_boolean" CHECK (`oauth_wechat_enabled` IN (0, 1));--> statement-breakpoint
-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0004_oauth', 4, 'b03462eda1ea967474c45a95e0d1a41c57a53c4e9e47cfb77ec152d27aa9a0d2');
