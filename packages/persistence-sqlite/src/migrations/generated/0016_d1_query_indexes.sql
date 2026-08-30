DROP INDEX `idx_announcements_category_public`;--> statement-breakpoint
CREATE INDEX `idx_announcements_category_public` ON `announcements` (`category`,`status`,`pinned`,`updated_at`,`id`,`publish_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_announcements_category_manage` ON `announcements` (`category`,`pinned`,`updated_at`,`id`,`archived_at`,`status`);--> statement-breakpoint
CREATE INDEX `idx_media_assets_gc_deleting` ON `media_assets` (`state`,`delete_claim_until`,`updated_at`,`id`);--> statement-breakpoint
DROP INDEX `idx_events_auto_archive_due`;--> statement-breakpoint
CREATE INDEX `idx_events_auto_archive_end_due` ON `events` (`auto_archive`,`auto_archived`,`archived_at`,`end_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_events_auto_archive_start_due` ON `events` (`auto_archive`,`auto_archived`,`archived_at`,`end_at`,`start_at`,`id`);--> statement-breakpoint
DROP INDEX `idx_oauth_challenges_expiry`;--> statement-breakpoint
CREATE INDEX `idx_oauth_challenges_cleanup_expiry` ON `oauth_challenges` (`expires_at`,`state_digest`);--> statement-breakpoint
CREATE INDEX `idx_oauth_challenges_cleanup_consumed` ON `oauth_challenges` (`consumed_at`,`state_digest`) WHERE "oauth_challenges"."consumed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_email_verification_cleanup_expiry` ON `email_verification_challenges` (`expires_at`,`token_digest`);--> statement-breakpoint
CREATE INDEX `idx_email_verification_cleanup_consumed` ON `email_verification_challenges` (`consumed_at`,`token_digest`) WHERE "email_verification_challenges"."consumed_at" IS NOT NULL;--> statement-breakpoint

-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0016_d1_query_indexes', 16, '1c453bbf328dd11da9a53bc9851f0db5cc8e1efb36f02e2755bc8112f9317cdd');
