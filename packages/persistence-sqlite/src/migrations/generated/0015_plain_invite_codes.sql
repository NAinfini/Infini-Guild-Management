CREATE TABLE `__new_invite_links` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`created_by` text NOT NULL,
	`role_id` text NOT NULL,
	`max_uses` integer NOT NULL,
	`used_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invite_links_max_uses_positive" CHECK("__new_invite_links"."max_uses" > 0),
	CONSTRAINT "invite_links_code_valid" CHECK(length("__new_invite_links"."code") = 10 AND "__new_invite_links"."code" NOT GLOB '*[^A-Z0-9]*'),
	CONSTRAINT "invite_links_used_count_valid" CHECK("__new_invite_links"."used_count" >= 0 AND "__new_invite_links"."used_count" <= "__new_invite_links"."max_uses")
);
--> statement-breakpoint
INSERT INTO `__new_invite_links` (
	`id`, `code`, `created_by`, `role_id`, `max_uses`, `used_count`, `expires_at`, `created_at`, `revoked_at`
)
SELECT
	`id`,
	printf('%010d', row_number() OVER (ORDER BY `id`)),
	`created_by`,
	`role_id`,
	`max_uses`,
	`used_count`,
	`expires_at`,
	`created_at`,
	CASE
		WHEN `revoked_at` IS NULL
			AND `used_count` < `max_uses`
			AND (`expires_at` IS NULL OR `expires_at` > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		ELSE `revoked_at`
	END
FROM `invite_links`;
--> statement-breakpoint
DROP TABLE `invite_links`;
--> statement-breakpoint
ALTER TABLE `__new_invite_links` RENAME TO `invite_links`;
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_invite_links_code_nocase` ON `invite_links` (`code` COLLATE NOCASE);
--> statement-breakpoint
CREATE INDEX `idx_invite_links_created` ON `invite_links` (`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `idx_invite_links_status` ON `invite_links` (`revoked_at`,`expires_at`,`used_count`,`max_uses`);
--> statement-breakpoint
CREATE INDEX `idx_invite_links_role` ON `invite_links` (`role_id`);
--> statement-breakpoint

-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0015_plain_invite_codes', 15, 'ceabce77b56139e60e0fedd33d69e59284ab4c57d644c68dfff61e5b44a727cc');
