PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__legacy_important_notice_acknowledgements` AS
SELECT `notice_id`, `user_id`, `publication_revision`, `acknowledged_at`
FROM `important_notice_acknowledgements`;--> statement-breakpoint
CREATE TABLE `__new_important_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body_json` text NOT NULL,
	`status` text NOT NULL,
	`publish_at` text,
	`expires_at` text,
	`publication_revision` integer DEFAULT 0 NOT NULL,
	`requires_acknowledgement` integer DEFAULT false NOT NULL,
	`audience_scope` text DEFAULT 'all' NOT NULL,
	`revision_token` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "important_notices_status_valid" CHECK("__new_important_notices"."status" IN ('draft', 'scheduled', 'published', 'withdrawn')),
	CONSTRAINT "important_notices_title_present" CHECK(length("__new_important_notices"."title") BETWEEN 1 AND 200),
	CONSTRAINT "important_notices_body_json" CHECK(json_valid("__new_important_notices"."body_json")),
	CONSTRAINT "important_notices_revision_present" CHECK(length("__new_important_notices"."revision_token") >= 16),
	CONSTRAINT "important_notices_publication_revision_valid" CHECK("__new_important_notices"."publication_revision" >= 0),
	CONSTRAINT "important_notices_requires_acknowledgement_boolean" CHECK("__new_important_notices"."requires_acknowledgement" IN (0, 1)),
	CONSTRAINT "important_notices_audience_scope_valid" CHECK("__new_important_notices"."audience_scope" IN ('all', 'roles')),
	CONSTRAINT "important_notices_state_consistent" CHECK(("__new_important_notices"."status" = 'draft' AND "__new_important_notices"."publish_at" IS NULL AND "__new_important_notices"."publication_revision" >= 0)
        OR ("__new_important_notices"."status" IN ('scheduled', 'published') AND "__new_important_notices"."publish_at" IS NOT NULL AND "__new_important_notices"."publication_revision" >= 1)
        OR ("__new_important_notices"."status" = 'withdrawn' AND "__new_important_notices"."publication_revision" >= 1)),
	CONSTRAINT "important_notices_expiry_after_publish" CHECK("__new_important_notices"."expires_at" IS NULL OR "__new_important_notices"."publish_at" IS NULL OR "__new_important_notices"."expires_at" > "__new_important_notices"."publish_at")
);--> statement-breakpoint
INSERT INTO `__new_important_notices`(
  "id", "title", "body_json", "status", "publish_at", "expires_at", "publication_revision",
  "requires_acknowledgement", "audience_scope", "revision_token", "created_by", "updated_by", "created_at", "updated_at"
) SELECT
  "id", "title", "body_json", "status",
  CASE WHEN "publish_at" IS NULL THEN NULL
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', "publish_at") END,
  CASE WHEN "expires_at" IS NULL THEN NULL
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', "expires_at") END,
  "publication_revision",
  1, 'all', "revision_token", "created_by", "updated_by", "created_at", "updated_at"
FROM `important_notices`;--> statement-breakpoint
DROP TABLE `important_notices`;--> statement-breakpoint
ALTER TABLE `__new_important_notices` RENAME TO `important_notices`;--> statement-breakpoint
CREATE INDEX `idx_important_notices_active` ON `important_notices` (`status`,`publish_at`,`expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_important_notices_admin` ON `important_notices` (`status`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `important_notice_audience_roles` (
	`notice_id` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`notice_id`, `role_id`),
	FOREIGN KEY (`notice_id`) REFERENCES `important_notices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_important_notice_audience_role` ON `important_notice_audience_roles` (`role_id`,`notice_id`);--> statement-breakpoint
CREATE TABLE `important_notice_receipts` (
	`notice_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` text,
	`read_publication_revision` integer NOT NULL,
	`acknowledged_at` text,
	PRIMARY KEY(`notice_id`, `user_id`),
	FOREIGN KEY (`notice_id`) REFERENCES `important_notices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "important_notice_receipt_read_revision_valid" CHECK("important_notice_receipts"."read_publication_revision" > 0),
	CONSTRAINT "important_notice_receipt_has_state" CHECK("important_notice_receipts"."read_at" IS NOT NULL OR "important_notice_receipts"."acknowledged_at" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX `idx_important_notice_receipt_user` ON `important_notice_receipts` (`user_id`,`notice_id`);--> statement-breakpoint
INSERT INTO `important_notice_receipts`
  (`notice_id`, `user_id`, `read_at`, `read_publication_revision`, `acknowledged_at`)
SELECT latest.`notice_id`, latest.`user_id`, latest.`acknowledged_at`, latest.`publication_revision`,
  (SELECT min(first_ack.`acknowledged_at`)
    FROM `__legacy_important_notice_acknowledgements` AS first_ack
    WHERE first_ack.`notice_id` = latest.`notice_id` AND first_ack.`user_id` = latest.`user_id`)
FROM `__legacy_important_notice_acknowledgements` AS latest
WHERE latest.`publication_revision` = (
  SELECT max(newest.`publication_revision`)
  FROM `__legacy_important_notice_acknowledgements` AS newest
  WHERE newest.`notice_id` = latest.`notice_id` AND newest.`user_id` = latest.`user_id`
);--> statement-breakpoint
DROP TABLE `important_notice_acknowledgements`;--> statement-breakpoint
DROP TABLE `__legacy_important_notice_acknowledgements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;

-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0017_notice_delivery', 17, '99397d1bbf9afd8c46d7dba1639e01cbf99e3ac6178b49a8479bf4c990c0d0e7');
