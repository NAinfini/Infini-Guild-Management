CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body_json` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`publish_at` text,
	`expires_at` text,
	`archived_at` text,
	`created_by` text NOT NULL,
	`updated_by` text,
	`revision_token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`search_text` text DEFAULT '' NOT NULL, `category` text DEFAULT 'announcement' NOT NULL
  CONSTRAINT "announcements_category_valid" CHECK(`category` IN ('announcement', 'event', 'war', 'important')), `view_count` integer DEFAULT 0 NOT NULL
  CONSTRAINT "announcements_view_count_valid" CHECK(`view_count` >= 0),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "announcements_title_present" CHECK(length(trim("announcements"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "announcements_body_object" CHECK(json_valid("announcements"."body_json") AND json_type("announcements"."body_json") = 'object'),
	CONSTRAINT "announcements_pinned_boolean" CHECK("announcements"."pinned" IN (0, 1)),
	CONSTRAINT "announcements_status_valid" CHECK("announcements"."status" IN ('draft', 'scheduled', 'published', 'archived')),
	CONSTRAINT "announcements_state_consistent" CHECK(("announcements"."status" = 'draft' AND "announcements"."archived_at" IS NULL)
        OR ("announcements"."status" = 'scheduled' AND "announcements"."publish_at" IS NOT NULL AND "announcements"."archived_at" IS NULL)
        OR ("announcements"."status" = 'published' AND "announcements"."publish_at" IS NOT NULL AND "announcements"."archived_at" IS NULL)
        OR ("announcements"."status" = 'archived' AND "announcements"."archived_at" IS NOT NULL)),
	CONSTRAINT "announcements_expiry_after_publish" CHECK("announcements"."expires_at" IS NULL OR "announcements"."publish_at" IS NULL OR "announcements"."expires_at" > "announcements"."publish_at"),
	CONSTRAINT "announcements_revision_present" CHECK(length("announcements"."revision_token") >= 16)
);
--> statement-breakpoint

CREATE TABLE `app_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`ordinal` integer NOT NULL,
	`checksum` text NOT NULL,
	`applied_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "app_migrations_id_valid" CHECK(length("app_migrations"."id") > 0),
	CONSTRAINT "app_migrations_ordinal_valid" CHECK("app_migrations"."ordinal" >= 0),
	CONSTRAINT "app_migrations_checksum_valid" CHECK(length("app_migrations"."checksum") = 64 AND "app_migrations"."checksum" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint

CREATE TABLE audit_archive_items (
  archive_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(archive_id, audit_id),
  FOREIGN KEY (archive_id) REFERENCES audit_archives(id) ON DELETE CASCADE,
  FOREIGN KEY (audit_id) REFERENCES audit_log(id) ON DELETE CASCADE,
  CONSTRAINT audit_archive_items_position_valid CHECK(position BETWEEN 0 AND 99)
);
--> statement-breakpoint

CREATE TABLE `audit_archives` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`status` text NOT NULL,
	`object_key` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`size_bytes` integer,
	`sha256` text,
	`lease_token` text,
	`lease_expires_at` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT "audit_archives_id_present" CHECK(length(trim("audit_archives"."id")) BETWEEN 1 AND 64),
	CONSTRAINT "audit_archives_month_valid" CHECK("audit_archives"."month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "audit_archives_status_valid" CHECK("audit_archives"."status" IN ('pending', 'ready')),
	CONSTRAINT "audit_archives_object_key_valid" CHECK("audit_archives"."object_key" GLOB 'audit/[0-9][0-9][0-9][0-9]/[0-9][0-9]/*.ndjson'),
	CONSTRAINT "audit_archives_row_count_valid" CHECK("audit_archives"."row_count" BETWEEN 0 AND 100),
	CONSTRAINT "audit_archives_state_consistent" CHECK((
        "audit_archives"."status" = 'pending'
        AND "audit_archives"."size_bytes" IS NULL
        AND "audit_archives"."sha256" IS NULL
        AND "audit_archives"."completed_at" IS NULL
        AND "audit_archives"."lease_token" IS NOT NULL
        AND "audit_archives"."lease_expires_at" IS NOT NULL
      ) OR (
        "audit_archives"."status" = 'ready'
        AND "audit_archives"."row_count" > 0
        AND "audit_archives"."starts_at" IS NOT NULL
        AND "audit_archives"."ends_at" IS NOT NULL
        AND "audit_archives"."size_bytes" > 0
        AND length("audit_archives"."sha256") = 64
        AND "audit_archives"."sha256" NOT GLOB '*[^0-9a-f]*'
        AND "audit_archives"."completed_at" IS NOT NULL
        AND "audit_archives"."lease_token" IS NULL
        AND "audit_archives"."lease_expires_at" IS NULL
      ))
);
--> statement-breakpoint

CREATE TABLE "audit_log" (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_label TEXT,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_label TEXT,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  CONSTRAINT audit_log_actor_kind_valid CHECK(actor_kind IN ('user', 'system')),
  CONSTRAINT audit_log_subject_type_valid CHECK(subject_type IN (
    'analytics_settings', 'announcement', 'audit_archive_export', 'audit_log_export', 'badge',
    'class_catalog', 'class_tag', 'event', 'event_participant', 'event_poll_vote', 'gallery',
    'gallery_item', 'guild_war', 'guild_war_history', 'guild_war_member_stats', 'invite_link',
    'important_notice', 'media_cleanup', 'media_asset', 'member_absence', 'member_badge',
    'member_profile', 'recurring_template', 'role', 'seed', 'site_config', 'system_test',
    'storage', 'storage_category', 'storage_item', 'storage_transaction', 'user', 'user_auth',
    'wiki', 'wiki_article', 'wiki_category'
  )),
  CONSTRAINT audit_log_action_valid CHECK(action IN (
    'admin_create_member', 'archive', 'adjust', 'assign', 'batch_add_by_moderator',
    'batch_deactivate', 'batch_delete', 'batch_reactivate', 'batch_remove_by_moderator',
    'batch_role_update', 'batch_update', 'change_password', 'change_username', 'conclude',
    'create', 'create_video', 'deactivate', 'delete', 'delete_audio', 'delete_avatar',
    'delete_images', 'distribute', 'export_filtered_csv', 'export_filtered_json', 'init',
    'intake', 'join', 'leave', 'move_member', 'pause', 'publish', 'raffle_draw',
    'reactivate', 'register', 'reorder', 'reset_password', 'rollback', 'run', 'resume',
    'revoke', 'save_teams', 'set_role_tag', 'unassign', 'update', 'update_role', 'upload',
    'upload_audio', 'upload_avatar', 'upload_icon', 'upload_images', 'withdraw', 'vote'
  )),
  CONSTRAINT audit_log_actor_id_present CHECK(length(trim(actor_id)) > 0),
  CONSTRAINT audit_log_actor_label_bounded CHECK(actor_label IS NULL OR length(trim(actor_label)) BETWEEN 1 AND 200),
  CONSTRAINT audit_log_subject_id_present CHECK(length(trim(subject_id)) > 0),
  CONSTRAINT audit_log_request_id_present CHECK(length(trim(request_id)) > 0),
  CONSTRAINT audit_log_subject_label_bounded CHECK(subject_label IS NULL OR length(trim(subject_label)) BETWEEN 1 AND 200),
  CONSTRAINT audit_log_payload_v2 CHECK(json_valid(payload_json)
    AND json_type(payload_json) = 'object'
    AND json_extract(payload_json, '$.schema_version') = 2
    AND json_type(payload_json, '$.changes') = 'array'
    AND json_type(payload_json, '$.context') = 'array'
    AND length(payload_json) <= 32768)
);
--> statement-breakpoint

CREATE TABLE `class_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`color` text NOT NULL,
	`icon_type` text DEFAULT 'vector' NOT NULL,
	`vector_icon` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "class_catalog_sort_nonnegative" CHECK("class_catalog"."sort_order" >= 0),
	CONSTRAINT "class_catalog_icon_consistent" CHECK(("class_catalog"."icon_type" = 'vector' AND "class_catalog"."vector_icon" IS NOT NULL) OR ("class_catalog"."icon_type" = 'image' AND "class_catalog"."vector_icon" IS NULL))
);
--> statement-breakpoint

CREATE TABLE `class_tag_members` (
	`tag_id` text NOT NULL,
	`class_id` text NOT NULL,
	PRIMARY KEY(`tag_id`, `class_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `class_tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `class_catalog`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `class_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`owner_kind` text,
	`owner_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "class_tags_sort_nonnegative" CHECK("class_tags"."sort_order" >= 0),
	CONSTRAINT "class_tags_owner_consistent" CHECK(("class_tags"."owner_kind" IS NULL AND "class_tags"."owner_id" IS NULL) OR ("class_tags"."owner_kind" IS NOT NULL AND "class_tags"."owner_id" IS NOT NULL))
);
--> statement-breakpoint

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
);
--> statement-breakpoint

CREATE TABLE `error_log` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`request_path` text,
	`request_method` text,
	`request_id` text,
	`stack` text,
	`created_at` text NOT NULL,
	CONSTRAINT "error_log_source_valid" CHECK("error_log"."source" IN ('request', 'scheduler', 'realtime', 'audit')),
	CONSTRAINT "error_log_level_valid" CHECK("error_log"."level" IN ('error', 'warn')),
	CONSTRAINT "error_log_message_bounded" CHECK(length("error_log"."message") BETWEEN 1 AND 2000),
	CONSTRAINT "error_log_path_bounded" CHECK("error_log"."request_path" IS NULL OR length("error_log"."request_path") BETWEEN 1 AND 2048),
	CONSTRAINT "error_log_method_bounded" CHECK("error_log"."request_method" IS NULL OR length("error_log"."request_method") BETWEEN 1 AND 16),
	CONSTRAINT "error_log_request_bounded" CHECK("error_log"."request_id" IS NULL OR length("error_log"."request_id") BETWEEN 1 AND 200),
	CONSTRAINT "error_log_stack_bounded" CHECK("error_log"."stack" IS NULL OR length("error_log"."stack") BETWEEN 1 AND 4000)
);
--> statement-breakpoint

CREATE TABLE `event_class_quotas` (
	`event_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`required` integer NOT NULL,
	PRIMARY KEY(`event_id`, `tag_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `class_tags`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_class_quotas_required_positive" CHECK("event_class_quotas"."required" > 0)
);
--> statement-breakpoint

CREATE TABLE `event_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `event_poll_options` (
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`event_id`, `id`),
	FOREIGN KEY (`event_id`) REFERENCES `event_polls`(`event_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_poll_options_sort_nonnegative" CHECK("event_poll_options"."sort_order" >= 0)
);
--> statement-breakpoint

CREATE TABLE `event_poll_votes` (
	`event_id` text NOT NULL,
	`option_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`event_id`, `option_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`,`option_id`) REFERENCES `event_poll_options`(`event_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `event_polls` (
	`event_id` text PRIMARY KEY NOT NULL,
	`results_visibility` text DEFAULT 'after_vote' NOT NULL,
	`show_voter_names` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_polls_visibility_valid" CHECK("event_polls"."results_visibility" IN ('always', 'after_vote', 'after_close')),
	CONSTRAINT "event_polls_show_voters_valid" CHECK("event_polls"."show_voter_names" IN (0, 1))
);
--> statement-breakpoint

CREATE TABLE `event_raffle_draws` (
	`event_id` text PRIMARY KEY NOT NULL,
	`winner_count` integer NOT NULL,
	`drawn_by` text NOT NULL,
	`drawn_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`mutation_token` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`drawn_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_raffle_draws_winner_count_positive" CHECK("event_raffle_draws"."winner_count" > 0)
);
--> statement-breakpoint

CREATE TABLE `event_raffle_winners` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`drawn_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event_raffle_draws`(`event_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`start_at` text NOT NULL,
	`end_at` text,
	`capacity` integer,
	`pinned` integer DEFAULT false NOT NULL,
	`signup_locked` integer DEFAULT false NOT NULL,
	`auto_archive` integer DEFAULT false NOT NULL,
	`auto_archived` integer DEFAULT false NOT NULL,
	`visible_at` text,
	`archived_at` text,
	`created_by` text NOT NULL,
	`updated_by` text,
	`series_id` text,
	`instance_date` text,
	`winner_count` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`series_id`) REFERENCES `recurring_templates`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "events_type_valid" CHECK("events"."type" IN ('weekly_mission', 'guild_war', 'social', 'poll', 'raffle', 'other')),
	CONSTRAINT "events_capacity_bounded" CHECK("events"."capacity" IS NULL OR "events"."capacity" BETWEEN 1 AND 500),
	CONSTRAINT "events_winner_count_bounded" CHECK("events"."winner_count" IS NULL OR "events"."winner_count" BETWEEN 1 AND 500),
	CONSTRAINT "events_end_after_start" CHECK("events"."end_at" IS NULL OR "events"."end_at" > "events"."start_at"),
	CONSTRAINT "events_flags_valid" CHECK("events"."pinned" IN (0, 1) AND "events"."signup_locked" IN (0, 1) AND "events"."auto_archive" IN (0, 1) AND "events"."auto_archived" IN (0, 1)),
	CONSTRAINT "events_series_instance_pair" CHECK(("events"."series_id" IS NULL AND "events"."instance_date" IS NULL)
        OR ("events"."series_id" IS NOT NULL AND "events"."instance_date" IS NOT NULL)),
	CONSTRAINT "events_behavior_columns" CHECK(("events"."type" = 'poll' AND "events"."end_at" IS NOT NULL AND "events"."capacity" IS NULL AND "events"."winner_count" IS NULL)
        OR ("events"."type" = 'raffle' AND "events"."end_at" IS NOT NULL AND "events"."winner_count" > 0)
        OR ("events"."type" NOT IN ('poll', 'raffle') AND "events"."winner_count" IS NULL))
);
--> statement-breakpoint

CREATE TABLE `external_identities` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `provider` text NOT NULL,
  `provider_subject` text NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `last_used_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "external_identities_provider_valid" CHECK(`provider` IN ('google', 'discord', 'kook', 'wechat'))
);
--> statement-breakpoint

CREATE TABLE `gallery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`url` text,
	`caption` text,
	`uploaded_by` text NOT NULL,
	`revision_token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL, `title` text DEFAULT 'Untitled' NOT NULL
  CONSTRAINT "gallery_items_title_bounded" CHECK(length(trim(`title`)) BETWEEN 1 AND 100),
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "gallery_items_type_valid" CHECK("gallery_items"."type" IN ('image', 'video')),
	CONSTRAINT "gallery_items_source_consistent" CHECK(("gallery_items"."type" = 'image' AND "gallery_items"."url" IS NULL) OR ("gallery_items"."type" = 'video' AND "gallery_items"."url" IS NOT NULL)),
	CONSTRAINT "gallery_items_caption_bounded" CHECK("gallery_items"."caption" IS NULL OR length("gallery_items"."caption") <= 200),
	CONSTRAINT "gallery_items_revision_present" CHECK(length("gallery_items"."revision_token") >= 16)
);
--> statement-breakpoint

CREATE TABLE `gallery_likes` (
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`item_id`, `user_id`),
	FOREIGN KEY (`item_id`) REFERENCES `gallery_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `guild_wars` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`status` text NOT NULL,
	`war_name` text NOT NULL,
	`enemy_name` text,
	`result` text,
	`own_kills` real,
	`own_towers` real,
	`own_base_hp` real,
	`own_credits` real,
	`own_distance` real,
	`enemy_kills` real,
	`enemy_towers` real,
	`enemy_base_hp` real,
	`enemy_credits` real,
	`enemy_distance` real,
	`duration_minutes` real,
	`notes` text,
	`roster_version` integer DEFAULT 0 NOT NULL,
	`mutation_token` text,
	`concluded_at` text,
	`created_by` text NOT NULL,
	`updated_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "guild_wars_status_valid" CHECK("guild_wars"."status" IN ('active', 'concluded')),
	CONSTRAINT "guild_wars_result_valid" CHECK("guild_wars"."result" IS NULL OR "guild_wars"."result" IN ('win', 'loss', 'draw')),
	CONSTRAINT "guild_wars_duration_positive" CHECK("guild_wars"."duration_minutes" IS NULL OR "guild_wars"."duration_minutes" > 0),
	CONSTRAINT "guild_wars_roster_version_nonnegative" CHECK("guild_wars"."roster_version" >= 0),
	CONSTRAINT "guild_wars_status_shape" CHECK(("guild_wars"."status" = 'active' AND "guild_wars"."event_id" IS NOT NULL AND "guild_wars"."concluded_at" IS NULL AND "guild_wars"."result" IS NULL)
        OR ("guild_wars"."status" = 'concluded' AND "guild_wars"."concluded_at" IS NOT NULL AND "guild_wars"."result" IN ('win', 'loss', 'draw'))),
	CONSTRAINT "guild_wars_team_stats_nonnegative" CHECK(("guild_wars"."own_kills" IS NULL OR "guild_wars"."own_kills" >= 0)
        AND ("guild_wars"."own_towers" IS NULL OR "guild_wars"."own_towers" >= 0)
        AND ("guild_wars"."own_base_hp" IS NULL OR "guild_wars"."own_base_hp" >= 0)
        AND ("guild_wars"."own_credits" IS NULL OR "guild_wars"."own_credits" >= 0)
        AND ("guild_wars"."own_distance" IS NULL OR "guild_wars"."own_distance" >= 0)
        AND ("guild_wars"."enemy_kills" IS NULL OR "guild_wars"."enemy_kills" >= 0)
        AND ("guild_wars"."enemy_towers" IS NULL OR "guild_wars"."enemy_towers" >= 0)
        AND ("guild_wars"."enemy_base_hp" IS NULL OR "guild_wars"."enemy_base_hp" >= 0)
        AND ("guild_wars"."enemy_credits" IS NULL OR "guild_wars"."enemy_credits" >= 0)
        AND ("guild_wars"."enemy_distance" IS NULL OR "guild_wars"."enemy_distance" >= 0))
);
--> statement-breakpoint

CREATE TABLE `important_notice_audience_roles` (
	`notice_id` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`notice_id`, `role_id`),
	FOREIGN KEY (`notice_id`) REFERENCES `important_notices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

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
);
--> statement-breakpoint

CREATE TABLE "important_notices" (
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
	CONSTRAINT "important_notices_status_valid" CHECK("important_notices"."status" IN ('draft', 'scheduled', 'published', 'withdrawn')),
	CONSTRAINT "important_notices_title_present" CHECK(length("important_notices"."title") BETWEEN 1 AND 200),
	CONSTRAINT "important_notices_body_json" CHECK(json_valid("important_notices"."body_json")),
	CONSTRAINT "important_notices_revision_present" CHECK(length("important_notices"."revision_token") >= 16),
	CONSTRAINT "important_notices_publication_revision_valid" CHECK("important_notices"."publication_revision" >= 0),
	CONSTRAINT "important_notices_requires_acknowledgement_boolean" CHECK("important_notices"."requires_acknowledgement" IN (0, 1)),
	CONSTRAINT "important_notices_audience_scope_valid" CHECK("important_notices"."audience_scope" IN ('all', 'roles')),
	CONSTRAINT "important_notices_state_consistent" CHECK(("important_notices"."status" = 'draft' AND "important_notices"."publish_at" IS NULL AND "important_notices"."publication_revision" >= 0)
        OR ("important_notices"."status" IN ('scheduled', 'published') AND "important_notices"."publish_at" IS NOT NULL AND "important_notices"."publication_revision" >= 1)
        OR ("important_notices"."status" = 'withdrawn' AND "important_notices"."publication_revision" >= 1)),
	CONSTRAINT "important_notices_expiry_after_publish" CHECK("important_notices"."expires_at" IS NULL OR "important_notices"."publish_at" IS NULL OR "important_notices"."expires_at" > "important_notices"."publish_at")
);
--> statement-breakpoint

CREATE TABLE "invite_links" (
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
	CONSTRAINT "invite_links_max_uses_positive" CHECK("invite_links"."max_uses" > 0),
	CONSTRAINT "invite_links_code_valid" CHECK(length("invite_links"."code") = 10 AND "invite_links"."code" NOT GLOB '*[^A-Z0-9]*'),
	CONSTRAINT "invite_links_used_count_valid" CHECK("invite_links"."used_count" >= 0 AND "invite_links"."used_count" <= "invite_links"."max_uses")
);
--> statement-breakpoint

CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`purpose` text NOT NULL,
	`media_type` text NOT NULL,
	`state` text NOT NULL,
	`original_name` text,
	`expires_at` text,
	`delete_claim_token` text,
	`delete_claim_until` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "media_assets_id_nanoid" CHECK(length("media_assets"."id") = 21 AND "media_assets"."id" NOT GLOB '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "media_assets_purpose_valid" CHECK("media_assets"."purpose" IN ('member_avatar', 'member_image', 'member_audio', 'gallery_image', 'event_image', 'announcement_image', 'announcement_attachment', 'wiki_image', 'storage_image', 'class_icon', 'site_logo')),
	CONSTRAINT "media_assets_type_valid" CHECK("media_assets"."media_type" IN ('image', 'audio', 'file')),
	CONSTRAINT "media_assets_state_valid" CHECK("media_assets"."state" IN ('uploading', 'staged', 'attached', 'deleting')),
	CONSTRAINT "media_assets_purpose_type_consistent" CHECK(("media_assets"."purpose" = 'member_audio' AND "media_assets"."media_type" = 'audio')
        OR ("media_assets"."purpose" = 'announcement_attachment' AND "media_assets"."media_type" = 'file')
        OR ("media_assets"."purpose" NOT IN ('member_audio', 'announcement_attachment') AND "media_assets"."media_type" = 'image')),
	CONSTRAINT "media_assets_name_consistent" CHECK(("media_assets"."media_type" IN ('audio', 'file') AND length(trim("media_assets"."original_name")) BETWEEN 1 AND 255)
        OR ("media_assets"."media_type" = 'image' AND "media_assets"."original_name" IS NULL)),
	CONSTRAINT "media_assets_expiry_consistent" CHECK(("media_assets"."state" IN ('uploading', 'staged') AND "media_assets"."expires_at" IS NOT NULL) OR ("media_assets"."state" IN ('attached', 'deleting'))),
	CONSTRAINT "media_assets_claim_consistent" CHECK(("media_assets"."delete_claim_token" IS NULL AND "media_assets"."delete_claim_until" IS NULL) OR ("media_assets"."state" = 'deleting' AND "media_assets"."delete_claim_token" IS NOT NULL AND "media_assets"."delete_claim_until" IS NOT NULL))
);
--> statement-breakpoint

CREATE TABLE `media_links` (
	`media_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`slot` text NOT NULL,
	`audience` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`attached_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`entity_type`, `entity_id`, `slot`, `media_id`),
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "media_links_entity_valid" CHECK("media_links"."entity_type" IN ('member_profile', 'gallery_item', 'event', 'recurring_template', 'announcement', 'wiki_article', 'storage_item', 'class_catalog', 'site_config')),
	CONSTRAINT "media_links_slot_valid" CHECK("media_links"."slot" IN ('avatar', 'image', 'audio', 'attachment', 'body', 'icon', 'logo')),
	CONSTRAINT "media_links_audience_valid" CHECK("media_links"."audience" IN ('public', 'authenticated', 'private')),
	CONSTRAINT "media_links_sort_nonnegative" CHECK("media_links"."sort_order" >= 0)
);
--> statement-breakpoint

CREATE TABLE "media_variants" (
	`media_id` text NOT NULL,
	`variant` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`width` integer,
	`height` integer,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "media_variants_variant_valid" CHECK("media_variants"."variant" IN ('full', 'view')),
	CONSTRAINT "media_variants_size_positive" CHECK("media_variants"."byte_size" > 0),
	CONSTRAINT "media_variants_sha256_valid" CHECK(length("media_variants"."sha256") = 64 AND "media_variants"."sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "media_variants_dimensions_consistent" CHECK(("media_variants"."content_type" = 'image/webp' AND "media_variants"."width" > 0 AND "media_variants"."height" > 0)
        OR ("media_variants"."content_type" IN (
          'audio/ogg',
          'application/octet-stream',
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ) AND "media_variants"."width" IS NULL AND "media_variants"."height" IS NULL))
);
--> statement-breakpoint

CREATE TABLE `member_absences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_absences_range_valid" CHECK("member_absences"."start_date" <= "member_absences"."end_date")
);
--> statement-breakpoint

CREATE TABLE `member_availability_windows` (
	`user_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	PRIMARY KEY(`user_id`, `weekday`, `start_minute`, `end_minute`),
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_availability_weekday_valid" CHECK("member_availability_windows"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "member_availability_start_valid" CHECK("member_availability_windows"."start_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "member_availability_end_valid" CHECK("member_availability_windows"."end_minute" BETWEEN 1 AND 1440),
	CONSTRAINT "member_availability_range_valid" CHECK("member_availability_windows"."start_minute" < "member_availability_windows"."end_minute")
);
--> statement-breakpoint

CREATE TABLE `member_badge_assignments` (
	`badge_id` text NOT NULL,
	`user_id` text NOT NULL,
	`assigned_by` text NOT NULL,
	`assigned_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`badge_id`, `user_id`),
	FOREIGN KEY (`badge_id`) REFERENCES `member_badges`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

CREATE TABLE `member_badges` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`label_html` text NOT NULL,
	`color` text DEFAULT '#3b82f6' NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "member_badges_sort_nonnegative" CHECK("member_badges"."sort_order" >= 0)
);
--> statement-breakpoint

CREATE TABLE `member_profile_classes` (
	`user_id` text NOT NULL,
	`class_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`user_id`, `class_id`),
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `class_catalog`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "member_profile_classes_sort_nonnegative" CHECK("member_profile_classes"."sort_order" >= 0)
);
--> statement-breakpoint

CREATE TABLE `member_profile_videos` (
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`user_id`, `url`),
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_profile_videos_sort_nonnegative" CHECK("member_profile_videos"."sort_order" >= 0)
);
--> statement-breakpoint

CREATE TABLE `member_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`power` real DEFAULT 0 NOT NULL,
	`title_html` text,
	`bio` text,
	`availability_timezone` text,
	`notes` text,
	`revision_token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_profiles_power_nonnegative" CHECK("member_profiles"."power" >= 0),
	CONSTRAINT "member_profiles_revision_present" CHECK(length("member_profiles"."revision_token") >= 16),
	CONSTRAINT "member_profiles_timezone_valid" CHECK("member_profiles"."availability_timezone" IS NULL OR (length("member_profiles"."availability_timezone") BETWEEN 1 AND 64 AND "member_profiles"."availability_timezone" = trim("member_profiles"."availability_timezone")))
);
--> statement-breakpoint

CREATE TABLE notification_inbox (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  read_at TEXT,
  CONSTRAINT notification_inbox_kind_valid CHECK(kind IN (
    'member_joined', 'announcement_published', 'event_created', 'wiki_article_created'
  )),
  CONSTRAINT notification_inbox_entity_type_valid CHECK(entity_type IN (
    'member', 'announcement', 'event', 'wiki_article'
  )),
  CONSTRAINT notification_inbox_id_present CHECK(length(id) BETWEEN 16 AND 200),
  CONSTRAINT notification_inbox_entity_present CHECK(length(entity_id) BETWEEN 1 AND 200),
  CONSTRAINT notification_inbox_source_present CHECK(length(source_key) BETWEEN 1 AND 300),
  CONSTRAINT notification_inbox_payload_json CHECK(json_valid(payload_json))
);
--> statement-breakpoint

CREATE TABLE `notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`member_joined` integer DEFAULT true NOT NULL,
	`announcement_published` integer DEFAULT true NOT NULL,
	`event_created` integer DEFAULT true NOT NULL,
	`wiki_article_created` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_preferences_member_joined_boolean" CHECK(`member_joined` IN (0, 1)),
	CONSTRAINT "notification_preferences_announcement_published_boolean" CHECK(`announcement_published` IN (0, 1)),
	CONSTRAINT "notification_preferences_event_created_boolean" CHECK(`event_created` IN (0, 1)),
	CONSTRAINT "notification_preferences_wiki_article_created_boolean" CHECK(`wiki_article_created` IN (0, 1))
);
--> statement-breakpoint

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
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL, `auth_revision` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "oauth_challenges_provider_valid" CHECK(`provider` IN ('google', 'discord', 'kook', 'wechat')),
  CONSTRAINT "oauth_challenges_purpose_valid" CHECK(`purpose` IN ('login', 'link')),
  CONSTRAINT "oauth_challenges_link_user" CHECK((`purpose` = 'link' AND `user_id` IS NOT NULL) OR (`purpose` = 'login' AND `user_id` IS NULL))
);
--> statement-breakpoint

CREATE TABLE `recurring_template_class_quotas` (
	`template_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`required` integer NOT NULL,
	PRIMARY KEY(`template_id`, `tag_id`),
	FOREIGN KEY (`template_id`) REFERENCES `recurring_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `class_tags`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_template_class_quotas_required_positive" CHECK("recurring_template_class_quotas"."required" > 0)
);
--> statement-breakpoint

CREATE TABLE `recurring_template_weekdays` (
	`template_id` text NOT NULL,
	`weekday` integer NOT NULL,
	PRIMARY KEY(`template_id`, `weekday`),
	FOREIGN KEY (`template_id`) REFERENCES `recurring_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_template_weekdays_valid" CHECK("recurring_template_weekdays"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint

CREATE TABLE `recurring_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`start_time` text NOT NULL,
	`duration_minutes` integer,
	`capacity` integer,
	`recurrence_frequency` text NOT NULL,
	`recurrence_interval` integer NOT NULL,
	`recurrence_day_of_month` integer,
	`recurrence_end_after` integer,
	`recurrence_end_at` text,
	`visibility_offset_minutes` integer DEFAULT 0 NOT NULL,
	`auto_archive` integer DEFAULT false NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`last_generated_date` text,
	`generation_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recurring_templates_type_valid" CHECK("recurring_templates"."type" IN ('weekly_mission', 'guild_war', 'social', 'poll', 'raffle', 'other')),
	CONSTRAINT "recurring_templates_capacity_bounded" CHECK("recurring_templates"."capacity" IS NULL OR "recurring_templates"."capacity" BETWEEN 1 AND 500),
	CONSTRAINT "recurring_templates_duration_nonnegative" CHECK("recurring_templates"."duration_minutes" IS NULL OR "recurring_templates"."duration_minutes" >= 0),
	CONSTRAINT "recurring_templates_visibility_offset_nonnegative" CHECK("recurring_templates"."visibility_offset_minutes" >= 0),
	CONSTRAINT "recurring_templates_generation_count_nonnegative" CHECK("recurring_templates"."generation_count" >= 0),
	CONSTRAINT "recurring_templates_boolean_flags" CHECK("recurring_templates"."auto_archive" IN (0, 1) AND "recurring_templates"."paused" IN (0, 1)),
	CONSTRAINT "recurring_templates_start_time_valid" CHECK(length("recurring_templates"."start_time") = 5
        AND "recurring_templates"."start_time" GLOB '[0-9][0-9]:[0-9][0-9]'
        AND CAST(substr("recurring_templates"."start_time", 1, 2) AS INTEGER) BETWEEN 0 AND 23
        AND CAST(substr("recurring_templates"."start_time", 4, 2) AS INTEGER) BETWEEN 0 AND 59),
	CONSTRAINT "recurring_templates_rule_valid" CHECK("recurring_templates"."recurrence_interval" > 0
        AND (
          ("recurring_templates"."recurrence_frequency" IN ('daily', 'weekly') AND "recurring_templates"."recurrence_day_of_month" IS NULL)
          OR ("recurring_templates"."recurrence_frequency" = 'monthly' AND "recurring_templates"."recurrence_day_of_month" BETWEEN 1 AND 31)
        )),
	CONSTRAINT "recurring_templates_end_valid" CHECK(("recurring_templates"."recurrence_end_after" IS NULL OR "recurring_templates"."recurrence_end_after" > 0)
        AND NOT ("recurring_templates"."recurrence_end_after" IS NOT NULL AND "recurring_templates"."recurrence_end_at" IS NOT NULL))
);
--> statement-breakpoint

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY(role_id, permission),
  CONSTRAINT role_permissions_permission_valid CHECK(permission IN (
    'admin.users.view', 'admin.users.edit', 'admin.users.role', 'admin.users.activate',
    'admin.users.delete', 'admin.users.password', 'admin.invite.view', 'admin.invite.manage',
    'admin.audit.view', 'admin.audit.export', 'admin.status.view', 'admin.analytics.view',
    'admin.analytics.manage', 'admin.roles.view', 'admin.roles.manage', 'admin.siteConfig.manage',
    'admin.importantNotices.manage', 'admin.classes.manage', 'guildwar.teams.edit',
    'guildwar.history.edit', 'events.create', 'events.edit', 'events.archive', 'events.delete',
    'events.templates', 'announcements.create', 'announcements.edit', 'announcements.archive',
    'announcements.delete', 'gallery.upload', 'gallery.manage', 'gallery.delete',
    'wiki.articles.create', 'wiki.articles.edit', 'wiki.articles.archive', 'wiki.articles.delete',
    'wiki.categories.manage', 'admin.badges.manage', 'admin.storage.structure',
    'admin.storage.items', 'admin.storage.stock'
  ))
);
--> statement-breakpoint

CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`level` integer NOT NULL,
	`color` text,
	`revision_token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "roles_level_valid" CHECK("roles"."level" BETWEEN 1 AND 1000),
	CONSTRAINT "roles_revision_present" CHECK(length("roles"."revision_token") >= 16)
);
--> statement-breakpoint

CREATE TABLE `scheduled_job_leases` (
	`job_name` text PRIMARY KEY NOT NULL,
	`lease_token` text NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`cursor_value` text,
	CONSTRAINT "scheduled_job_leases_job_name_valid" CHECK("scheduled_job_leases"."job_name" IN ('recurrence-materialization', 'announcement-publish', 'raffle-auto-draw', 'event-auto-archive', 'media-gc', 'audit-archive', 'session-cleanup', 'system-test-cleanup')),
	CONSTRAINT "scheduled_job_leases_lease_token_valid" CHECK(length("scheduled_job_leases"."lease_token") BETWEEN 16 AND 128),
	CONSTRAINT "scheduled_job_leases_interval_valid" CHECK("scheduled_job_leases"."acquired_at" < "scheduled_job_leases"."expires_at")
) WITHOUT ROWID;
--> statement-breakpoint

CREATE TABLE `scheduled_job_statuses` (
	`job_name` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`processed` integer,
	`batches` integer,
	`has_more` integer,
	`backlog_count_precision` text,
	`backlog_pending_count` integer,
	`backlog_oldest_pending_at` text,
	`backlog_reason` text,
	`backlog_detail` text,
	`error_summary` text,
	CONSTRAINT "scheduled_job_statuses_job_name_valid" CHECK("scheduled_job_statuses"."job_name" IN ('recurrence-materialization', 'announcement-publish', 'raffle-auto-draw', 'event-auto-archive', 'media-gc', 'audit-archive', 'session-cleanup', 'system-test-cleanup')),
	CONSTRAINT "scheduled_job_statuses_status_valid" CHECK("scheduled_job_statuses"."status" IN ('running', 'completed', 'lease-held', 'failed')),
	CONSTRAINT "scheduled_job_statuses_duration_valid" CHECK("scheduled_job_statuses"."duration_ms" IS NULL OR "scheduled_job_statuses"."duration_ms" >= 0),
	CONSTRAINT "scheduled_job_statuses_processed_valid" CHECK("scheduled_job_statuses"."processed" IS NULL OR "scheduled_job_statuses"."processed" >= 0),
	CONSTRAINT "scheduled_job_statuses_batches_valid" CHECK("scheduled_job_statuses"."batches" IS NULL OR "scheduled_job_statuses"."batches" >= 0),
	CONSTRAINT "scheduled_job_statuses_backlog_count_valid" CHECK("scheduled_job_statuses"."backlog_pending_count" IS NULL OR "scheduled_job_statuses"."backlog_pending_count" >= 0),
	CONSTRAINT "scheduled_job_statuses_backlog_valid" CHECK((
        "scheduled_job_statuses"."backlog_count_precision" IS NULL
        AND "scheduled_job_statuses"."backlog_pending_count" IS NULL
        AND "scheduled_job_statuses"."backlog_oldest_pending_at" IS NULL
        AND "scheduled_job_statuses"."backlog_reason" IS NULL
        AND "scheduled_job_statuses"."backlog_detail" IS NULL
      ) OR (
        "scheduled_job_statuses"."backlog_count_precision" = 'unknown'
        AND "scheduled_job_statuses"."backlog_pending_count" IS NULL
        AND "scheduled_job_statuses"."backlog_oldest_pending_at" IS NULL
        AND "scheduled_job_statuses"."backlog_reason" IS NOT NULL
        AND ("scheduled_job_statuses"."backlog_detail" IS NULL OR length("scheduled_job_statuses"."backlog_detail") BETWEEN 1 AND 500)
      ) OR (
        "scheduled_job_statuses"."backlog_count_precision" IN ('exact', 'at-least')
        AND "scheduled_job_statuses"."backlog_pending_count" IS NOT NULL
        AND (("scheduled_job_statuses"."backlog_pending_count" = 0 AND "scheduled_job_statuses"."backlog_oldest_pending_at" IS NULL)
          OR ("scheduled_job_statuses"."backlog_pending_count" > 0 AND "scheduled_job_statuses"."backlog_oldest_pending_at" IS NOT NULL))
        AND "scheduled_job_statuses"."backlog_reason" IS NULL
        AND "scheduled_job_statuses"."backlog_detail" IS NULL
      )),
	CONSTRAINT "scheduled_job_statuses_state_valid" CHECK((
        "scheduled_job_statuses"."status" = 'running'
        AND "scheduled_job_statuses"."finished_at" IS NULL
        AND "scheduled_job_statuses"."duration_ms" IS NULL
        AND "scheduled_job_statuses"."processed" IS NULL
        AND "scheduled_job_statuses"."batches" IS NULL
        AND "scheduled_job_statuses"."has_more" IS NULL
        AND "scheduled_job_statuses"."backlog_count_precision" IS NULL
        AND "scheduled_job_statuses"."error_summary" IS NULL
      ) OR (
        "scheduled_job_statuses"."status" = 'completed'
        AND "scheduled_job_statuses"."finished_at" IS NOT NULL
        AND "scheduled_job_statuses"."duration_ms" IS NOT NULL
        AND "scheduled_job_statuses"."processed" IS NOT NULL
        AND "scheduled_job_statuses"."batches" IS NOT NULL
        AND "scheduled_job_statuses"."has_more" IS NOT NULL
        AND "scheduled_job_statuses"."backlog_count_precision" IS NOT NULL
        AND "scheduled_job_statuses"."error_summary" IS NULL
      ) OR (
        "scheduled_job_statuses"."status" = 'lease-held'
        AND "scheduled_job_statuses"."finished_at" IS NOT NULL
        AND "scheduled_job_statuses"."duration_ms" IS NOT NULL
        AND "scheduled_job_statuses"."processed" = 0
        AND "scheduled_job_statuses"."batches" = 0
        AND "scheduled_job_statuses"."has_more" = 1
        AND "scheduled_job_statuses"."backlog_count_precision" = 'unknown'
        AND "scheduled_job_statuses"."backlog_reason" = 'lease-held'
        AND "scheduled_job_statuses"."error_summary" IS NULL
      ) OR (
        "scheduled_job_statuses"."status" = 'failed'
        AND "scheduled_job_statuses"."finished_at" IS NOT NULL
        AND "scheduled_job_statuses"."duration_ms" IS NOT NULL
        AND "scheduled_job_statuses"."processed" IS NULL
        AND "scheduled_job_statuses"."batches" IS NULL
        AND "scheduled_job_statuses"."has_more" IS NULL
        AND "scheduled_job_statuses"."backlog_count_precision" = 'unknown'
        AND "scheduled_job_statuses"."backlog_reason" = 'job-failed'
        AND length("scheduled_job_statuses"."error_summary") BETWEEN 1 AND 500
      ))
);
--> statement-breakpoint

CREATE TABLE `sessions` (
	`token_digest` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL, `scope` text NOT NULL DEFAULT 'normal' CONSTRAINT "sessions_scope_valid" CHECK (`scope` IN ('normal', 'password_change')), `auth_revision` integer NOT NULL DEFAULT 1,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `site_config` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`site_name` text NOT NULL,
	`site_logo_media_id` text,
	`default_site_logo_url` text NOT NULL,
	`feature_announcements` integer NOT NULL,
	`feature_events` integer NOT NULL,
	`feature_guild_war` integer NOT NULL,
	`feature_gallery` integer NOT NULL,
	`feature_wiki` integer NOT NULL,
	`feature_tools` integer NOT NULL,
	`feature_storage` integer NOT NULL,
	`max_site_logo_bytes` integer NOT NULL,
	`max_class_icon_bytes` integer NOT NULL,
	`max_profile_image_bytes` integer NOT NULL,
	`max_profile_audio_bytes` integer NOT NULL,
	`max_announcement_image_bytes` integer NOT NULL,
	`max_wiki_image_bytes` integer NOT NULL,
	`max_event_image_bytes` integer NOT NULL,
	`max_gallery_image_bytes` integer NOT NULL,
	`max_storage_image_bytes` integer NOT NULL,
	`quota_profile` integer NOT NULL,
	`quota_announcement` integer NOT NULL,
	`quota_gallery` integer NOT NULL,
	`quota_wiki` integer NOT NULL,
	`storage_images_per_item` integer NOT NULL,
	`absence_max_span_days` integer NOT NULL,
	`absence_max_entries_per_user` integer NOT NULL,
	`analytics_reference_duration_minutes` real NOT NULL,
	`analytics_weight_kills` real NOT NULL,
	`analytics_weight_towers` real NOT NULL,
	`analytics_weight_base_hp` real NOT NULL,
	`analytics_weight_credits` real NOT NULL,
	`analytics_weight_distance` real NOT NULL,
	`revision_token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`site_description` text DEFAULT 'Guild Management Portal — roster, events, wiki, and tools for your guild.' NOT NULL, `oauth_google_enabled` integer NOT NULL DEFAULT 0 CONSTRAINT "site_config_oauth_google_boolean" CHECK (`oauth_google_enabled` IN (0, 1)), `oauth_discord_enabled` integer NOT NULL DEFAULT 0 CONSTRAINT "site_config_oauth_discord_boolean" CHECK (`oauth_discord_enabled` IN (0, 1)), `oauth_kook_enabled` integer NOT NULL DEFAULT 0 CONSTRAINT "site_config_oauth_kook_boolean" CHECK (`oauth_kook_enabled` IN (0, 1)), `oauth_wechat_enabled` integer NOT NULL DEFAULT 0 CONSTRAINT "site_config_oauth_wechat_boolean" CHECK (`oauth_wechat_enabled` IN (0, 1)), `max_announcement_attachment_bytes` integer NOT NULL DEFAULT 10485760 CONSTRAINT "site_config_announcement_attachment_bytes_bounded" CHECK (`max_announcement_attachment_bytes` BETWEEN 1 AND 32505856), `quota_announcement_attachments` integer NOT NULL DEFAULT 5 CONSTRAINT "site_config_announcement_attachments_quota_bounded" CHECK (`quota_announcement_attachments` BETWEEN 1 AND 100),
	CONSTRAINT "site_config_singleton" CHECK("site_config"."singleton" = 1),
	CONSTRAINT "site_config_name_bounded" CHECK(length(trim("site_config"."site_name")) BETWEEN 1 AND 100),
	CONSTRAINT "site_config_description_bounded" CHECK(length(trim("site_config"."site_description")) BETWEEN 1 AND 300),
	CONSTRAINT "site_config_logo_url_present" CHECK(length(trim("site_config"."default_site_logo_url")) >= 1),
	CONSTRAINT "site_config_features_boolean" CHECK(
      "site_config"."feature_announcements" IN (0, 1) AND "site_config"."feature_events" IN (0, 1)
      AND "site_config"."feature_guild_war" IN (0, 1) AND "site_config"."feature_gallery" IN (0, 1)
      AND "site_config"."feature_wiki" IN (0, 1) AND "site_config"."feature_tools" IN (0, 1)
      AND "site_config"."feature_storage" IN (0, 1)),
	CONSTRAINT "site_config_limits_positive" CHECK(
      "site_config"."max_site_logo_bytes" > 0 AND "site_config"."max_class_icon_bytes" > 0
      AND "site_config"."max_profile_image_bytes" > 0 AND "site_config"."max_profile_audio_bytes" > 0
      AND "site_config"."max_announcement_image_bytes" > 0 AND "site_config"."max_wiki_image_bytes" > 0
      AND "site_config"."max_event_image_bytes" > 0 AND "site_config"."max_gallery_image_bytes" > 0
      AND "site_config"."max_storage_image_bytes" > 0 AND "site_config"."quota_profile" > 0
      AND "site_config"."quota_announcement" > 0 AND "site_config"."quota_gallery" > 0 AND "site_config"."quota_wiki" > 0
      AND "site_config"."storage_images_per_item" > 0 AND "site_config"."absence_max_span_days" > 0
      AND "site_config"."absence_max_entries_per_user" > 0),
	CONSTRAINT "site_config_limits_bounded" CHECK(
      "site_config"."max_site_logo_bytes" <= 16252928
      AND "site_config"."max_class_icon_bytes" <= 16252928
      AND "site_config"."max_profile_image_bytes" <= 16252928
      AND "site_config"."max_profile_audio_bytes" <= 32505856
      AND "site_config"."max_announcement_image_bytes" <= 16252928
      AND "site_config"."max_wiki_image_bytes" <= 16252928
      AND "site_config"."max_event_image_bytes" <= 16252928
      AND "site_config"."max_gallery_image_bytes" <= 16252928
      AND "site_config"."max_storage_image_bytes" <= 16252928
      AND "site_config"."quota_profile" <= 100
      AND "site_config"."quota_announcement" <= 100
      AND "site_config"."quota_gallery" <= 100
      AND "site_config"."quota_wiki" <= 100
      AND "site_config"."storage_images_per_item" <= 5
      AND "site_config"."absence_max_span_days" <= 366
      AND "site_config"."absence_max_entries_per_user" <= 20),
	CONSTRAINT "site_config_analytics_finite" CHECK(
      typeof("site_config"."analytics_reference_duration_minutes") IN ('integer', 'real')
      AND "site_config"."analytics_reference_duration_minutes" > 0
      AND "site_config"."analytics_reference_duration_minutes" <= 10080
      AND "site_config"."analytics_reference_duration_minutes" = "site_config"."analytics_reference_duration_minutes"
      AND "site_config"."analytics_weight_kills" BETWEEN 0 AND 1000000
      AND "site_config"."analytics_weight_kills" = "site_config"."analytics_weight_kills"
      AND "site_config"."analytics_weight_towers" BETWEEN 0 AND 1000000
      AND "site_config"."analytics_weight_towers" = "site_config"."analytics_weight_towers"
      AND "site_config"."analytics_weight_base_hp" BETWEEN 0 AND 1000000
      AND "site_config"."analytics_weight_base_hp" = "site_config"."analytics_weight_base_hp"
      AND "site_config"."analytics_weight_credits" BETWEEN 0 AND 1000000
      AND "site_config"."analytics_weight_credits" = "site_config"."analytics_weight_credits"
      AND "site_config"."analytics_weight_distance" BETWEEN 0 AND 1000000
      AND "site_config"."analytics_weight_distance" = "site_config"."analytics_weight_distance"
      AND ("site_config"."analytics_weight_kills" + "site_config"."analytics_weight_towers" + "site_config"."analytics_weight_base_hp"
        + "site_config"."analytics_weight_credits" + "site_config"."analytics_weight_distance") > 0),
	CONSTRAINT "site_config_revision_present" CHECK(length("site_config"."revision_token") >= 16)
);
--> statement-breakpoint

CREATE TABLE `storage_balances` (
	`item_id` text PRIMARY KEY NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `storage_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "storage_balances_quantity_valid" CHECK(typeof("storage_balances"."quantity") IN ('integer', 'real') AND "storage_balances"."quantity" >= 0 AND abs("storage_balances"."quantity") < 1e308)
);
--> statement-breakpoint

CREATE TABLE `storage_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`idempotency_key` text,
	`access_mode` text NOT NULL,
	`transaction_type` text NOT NULL,
	`recipient_user_id` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL, `request_fingerprint` text
  CONSTRAINT "storage_batches_request_fingerprint_valid" CHECK(
    `request_fingerprint` IS NULL OR (
      length(`request_fingerprint`) = 64
      AND `request_fingerprint` NOT GLOB '*[^0-9a-f]*'
    )
  ),
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "storage_batches_access_mode_valid" CHECK("storage_batches"."access_mode" IN ('stock_admin', 'member_self')),
	CONSTRAINT "storage_batches_transaction_type_valid" CHECK("storage_batches"."transaction_type" IN ('intake', 'distribute', 'adjust')),
	CONSTRAINT "storage_batches_recipient_valid" CHECK("storage_batches"."transaction_type" <> 'adjust' OR "storage_batches"."recipient_user_id" IS NULL),
	CONSTRAINT "storage_batches_member_self_valid" CHECK("storage_batches"."access_mode" = 'stock_admin'
      OR ("storage_batches"."transaction_type" IN ('intake', 'distribute') AND "storage_batches"."recipient_user_id" = "storage_batches"."actor_id")),
	CONSTRAINT "storage_batches_note_valid" CHECK("storage_batches"."note" IS NULL OR length("storage_batches"."note") <= 200),
	CONSTRAINT "storage_batches_idempotency_key_valid" CHECK("storage_batches"."idempotency_key" IS NULL OR (
      length("storage_batches"."idempotency_key") BETWEEN 16 AND 64
      AND substr("storage_batches"."idempotency_key", 1, 1) GLOB '[A-Za-z0-9]'
      AND "storage_batches"."idempotency_key" NOT GLOB '*[^-A-Za-z0-9._:]*'
    ))
);
--> statement-breakpoint

CREATE TABLE `storage_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`storage_id`) REFERENCES `storages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "storage_categories_name_valid" CHECK(length(trim("storage_categories"."name")) BETWEEN 1 AND 50)
);
--> statement-breakpoint

CREATE TABLE `storage_items` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_id` text NOT NULL,
	`category_id` text,
	`name` text NOT NULL,
	`description` text,
	`allow_member_deposit` integer DEFAULT false NOT NULL,
	`allow_member_withdraw` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL, `rarity` text DEFAULT 'common' NOT NULL
  CONSTRAINT "storage_items_rarity_valid" CHECK(`rarity` IN ('common', 'uncommon', 'rare', 'epic', 'legendary')), `unit` text
  CONSTRAINT "storage_items_unit_valid" CHECK(`unit` IS NULL OR length(trim(`unit`)) BETWEEN 1 AND 30),
	FOREIGN KEY (`storage_id`) REFERENCES `storages`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`storage_id`,`category_id`) REFERENCES `storage_categories`(`storage_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "storage_items_name_valid" CHECK(length(trim("storage_items"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "storage_items_description_valid" CHECK("storage_items"."description" IS NULL OR length("storage_items"."description") <= 2000),
	CONSTRAINT "storage_items_self_service_flags_valid" CHECK("storage_items"."allow_member_deposit" IN (0, 1) AND "storage_items"."allow_member_withdraw" IN (0, 1))
);
--> statement-breakpoint

CREATE TABLE `storage_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`batch_position` integer NOT NULL,
	`type` text NOT NULL,
	`quantity_delta` real NOT NULL,
	`recipient_user_id` text,
	`note` text,
	`actor_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `storage_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `storage_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "storage_ledger_type_valid" CHECK("storage_ledger_entries"."type" IN ('intake', 'distribute', 'adjust')),
	CONSTRAINT "storage_ledger_quantity_valid" CHECK(typeof("storage_ledger_entries"."quantity_delta") IN ('integer', 'real')
      AND "storage_ledger_entries"."quantity_delta" <> 0
      AND abs("storage_ledger_entries"."quantity_delta") <= 1000000
      AND abs("storage_ledger_entries"."quantity_delta") < 1e308),
	CONSTRAINT "storage_ledger_quantity_sign_valid" CHECK(("storage_ledger_entries"."type" = 'intake' AND "storage_ledger_entries"."quantity_delta" > 0)
      OR ("storage_ledger_entries"."type" = 'distribute' AND "storage_ledger_entries"."quantity_delta" < 0)
      OR ("storage_ledger_entries"."type" = 'adjust' AND "storage_ledger_entries"."quantity_delta" <> 0)),
	CONSTRAINT "storage_ledger_batch_position_valid" CHECK("storage_ledger_entries"."batch_position" BETWEEN 0 AND 19),
	CONSTRAINT "storage_ledger_note_valid" CHECK("storage_ledger_entries"."note" IS NULL OR length("storage_ledger_entries"."note") <= 200)
);
--> statement-breakpoint

CREATE TABLE `storages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL, `structure_revision` integer DEFAULT 0 NOT NULL
  CONSTRAINT "storages_structure_revision_nonnegative" CHECK(`structure_revision` >= 0),
	CONSTRAINT "storages_name_valid" CHECK(length(trim("storages"."name")) BETWEEN 1 AND 50),
	CONSTRAINT "storages_description_valid" CHECK("storages"."description" IS NULL OR length("storages"."description") <= 500)
);
--> statement-breakpoint

CREATE TABLE `system_test_artifacts` (
	`run_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`artifact_key` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`run_id`, `artifact_type`, `artifact_key`),
	FOREIGN KEY (`run_id`) REFERENCES `system_test_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "system_test_artifacts_type_valid" CHECK("system_test_artifacts"."artifact_type" IN ('guild_war', 'event', 'recurring_template', 'storage_batch', 'storage_item', 'storage_category', 'storage', 'wiki_article', 'wiki_category', 'announcement', 'gallery_item', 'badge', 'invite_link', 'member_absence', 'user', 'role', 'class_tag', 'class_catalog', 'media_asset', 'error_log', 'audit_log')),
	CONSTRAINT "system_test_artifacts_key_present" CHECK(length(trim("system_test_artifacts"."artifact_key")) BETWEEN 1 AND 500),
	CONSTRAINT "system_test_artifacts_request_present" CHECK(length(trim("system_test_artifacts"."request_id")) BETWEEN 1 AND 200)
);
--> statement-breakpoint

CREATE TABLE `system_test_before_images` (
	`run_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`before_sort_order` integer NOT NULL,
	`before_updated_at` text NOT NULL,
	`expected_sort_order` integer NOT NULL,
	`expected_updated_at` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`run_id`, `target_type`, `target_id`),
	FOREIGN KEY (`run_id`) REFERENCES `system_test_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "system_test_before_images_type_valid" CHECK("system_test_before_images"."target_type" IN ('class_catalog', 'class_tag', 'badge')),
	CONSTRAINT "system_test_before_images_target_present" CHECK(length(trim("system_test_before_images"."target_id")) BETWEEN 1 AND 200),
	CONSTRAINT "system_test_before_images_request_present" CHECK(length(trim("system_test_before_images"."request_id")) BETWEEN 1 AND 200),
	CONSTRAINT "system_test_before_images_sort_nonnegative" CHECK("system_test_before_images"."before_sort_order" >= 0 AND "system_test_before_images"."expected_sort_order" >= 0)
);
--> statement-breakpoint

CREATE TABLE `system_test_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`actor_user_id` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `system_test_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "system_test_requests_id_present" CHECK(length(trim("system_test_requests"."request_id")) BETWEEN 1 AND 200)
);
--> statement-breakpoint

CREATE TABLE `system_test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`cleanup_attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "system_test_runs_status_valid" CHECK("system_test_runs"."status" IN ('running', 'cleaning', 'cleanup_failed', 'completed')),
	CONSTRAINT "system_test_runs_attempts_nonnegative" CHECK("system_test_runs"."cleanup_attempts" >= 0),
	CONSTRAINT "system_test_runs_interval_valid" CHECK("system_test_runs"."created_at" < "system_test_runs"."expires_at"),
	CONSTRAINT "system_test_runs_error_bounded" CHECK("system_test_runs"."last_error" IS NULL OR length("system_test_runs"."last_error") BETWEEN 1 AND 1000),
	CONSTRAINT "system_test_runs_completion_consistent" CHECK(("system_test_runs"."status" = 'completed' AND "system_test_runs"."completed_at" IS NOT NULL) OR ("system_test_runs"."status" <> 'completed' AND "system_test_runs"."completed_at" IS NULL))
);
--> statement-breakpoint

CREATE TABLE "user_credentials" (
  `user_id` text PRIMARY KEY NOT NULL,
  `login_name` text NOT NULL,
  `password_hash` text NOT NULL,
  `temporary_password_expires_at` text,
  `temporary_password_used_at` text,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL, `auth_revision` integer NOT NULL DEFAULT 1,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `user_emails` (
  `user_id` text PRIMARY KEY NOT NULL,
  `normalized_email` text NOT NULL,
  `verified_at` text NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	`role_id` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`deleted_at` text,
	`revision_token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_login_at` text,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "users_active_boolean" CHECK("users"."is_active" IN (0, 1)),
	CONSTRAINT "users_revision_present" CHECK(length("users"."revision_token") >= 16)
);
--> statement-breakpoint

CREATE TABLE `war_members` (
	`id` text PRIMARY KEY NOT NULL,
	`war_id` text NOT NULL,
	`team_id` text,
	`user_id` text NOT NULL,
	`role_tag` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`kills` real,
	`deaths` real,
	`assists` real,
	`damage` real,
	`healing` real,
	`building_damage` real,
	`credits` real,
	`damage_taken` real,
	`note` text,
	FOREIGN KEY (`war_id`) REFERENCES `guild_wars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `war_teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "war_members_sort_nonnegative" CHECK("war_members"."sort_order" >= 0),
	CONSTRAINT "war_members_stats_nonnegative" CHECK(("war_members"."kills" IS NULL OR "war_members"."kills" >= 0)
        AND ("war_members"."deaths" IS NULL OR "war_members"."deaths" >= 0)
        AND ("war_members"."assists" IS NULL OR "war_members"."assists" >= 0)
        AND ("war_members"."damage" IS NULL OR "war_members"."damage" >= 0)
        AND ("war_members"."healing" IS NULL OR "war_members"."healing" >= 0)
        AND ("war_members"."building_damage" IS NULL OR "war_members"."building_damage" >= 0)
        AND ("war_members"."credits" IS NULL OR "war_members"."credits" >= 0)
        AND ("war_members"."damage_taken" IS NULL OR "war_members"."damage_taken" >= 0))
);
--> statement-breakpoint

CREATE TABLE `war_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`war_id` text NOT NULL,
	`team_name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`notes` text,
	`is_locked` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`war_id`) REFERENCES `guild_wars`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "war_teams_sort_nonnegative" CHECK("war_teams"."sort_order" >= 0),
	CONSTRAINT "war_teams_locked_boolean" CHECK("war_teams"."is_locked" IN (0, 1))
);
--> statement-breakpoint

CREATE TABLE `wiki_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`category_id` text NOT NULL,
	`body_json` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`deleted_at` text,
	`created_by` text NOT NULL,
	`updated_by` text,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`revision_token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`search_text` text DEFAULT '' NOT NULL, `view_count` integer DEFAULT 0 NOT NULL
  CONSTRAINT "wiki_articles_view_count_valid" CHECK(`view_count` >= 0),
	FOREIGN KEY (`category_id`) REFERENCES `wiki_categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "wiki_articles_title_bounded" CHECK(length(trim("wiki_articles"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "wiki_articles_body_bounded" CHECK(length("wiki_articles"."body_json") BETWEEN 1 AND 500000),
	CONSTRAINT "wiki_articles_pinned_boolean" CHECK("wiki_articles"."pinned" IN (0, 1)),
	CONSTRAINT "wiki_articles_delete_is_archived" CHECK("wiki_articles"."deleted_at" IS NULL OR "wiki_articles"."archived_at" IS NOT NULL),
	CONSTRAINT "wiki_articles_revision_positive" CHECK("wiki_articles"."current_revision" >= 1),
	CONSTRAINT "wiki_articles_revision_present" CHECK(length("wiki_articles"."revision_token") >= 16)
);
--> statement-breakpoint

CREATE TABLE `wiki_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`parent_id` text,
	`revision_token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `wiki_categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "wiki_categories_name_bounded" CHECK(length(trim("wiki_categories"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "wiki_categories_slug_bounded" CHECK(length("wiki_categories"."slug") BETWEEN 1 AND 120),
	CONSTRAINT "wiki_categories_not_self_parent" CHECK("wiki_categories"."parent_id" IS NULL OR "wiki_categories"."parent_id" <> "wiki_categories"."id"),
	CONSTRAINT "wiki_categories_revision_present" CHECK(length("wiki_categories"."revision_token") >= 16)
);
--> statement-breakpoint

CREATE TABLE `wiki_category_state` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`revision_token` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "wiki_category_state_singleton" CHECK("wiki_category_state"."singleton" = 1),
	CONSTRAINT "wiki_category_state_revision_present" CHECK(length("wiki_category_state"."revision_token") >= 16)
);
--> statement-breakpoint

CREATE TABLE `wiki_revision_media` (
	`revision_id` text NOT NULL,
	`media_id` text NOT NULL,
	`audience` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`revision_id`, `media_id`),
	FOREIGN KEY (`revision_id`) REFERENCES `wiki_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "wiki_revision_media_audience_valid" CHECK("wiki_revision_media"."audience" IN ('public', 'authenticated', 'private')),
	CONSTRAINT "wiki_revision_media_sort_nonnegative" CHECK("wiki_revision_media"."sort_order" >= 0)
);
--> statement-breakpoint

CREATE TABLE `wiki_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`category_id` text NOT NULL,
	`body_json` text NOT NULL,
	`sort_order` integer NOT NULL,
	`pinned` integer NOT NULL,
	`archived_at` text,
	`deleted_at` text,
	`edited_by` text NOT NULL,
	`restored_from` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `wiki_articles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`edited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "wiki_revisions_revision_positive" CHECK("wiki_revisions"."revision" >= 1),
	CONSTRAINT "wiki_revisions_title_bounded" CHECK(length(trim("wiki_revisions"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "wiki_revisions_body_bounded" CHECK(length("wiki_revisions"."body_json") BETWEEN 1 AND 500000),
	CONSTRAINT "wiki_revisions_slug_bounded" CHECK(length("wiki_revisions"."slug") BETWEEN 1 AND 120),
	CONSTRAINT "wiki_revisions_pinned_boolean" CHECK("wiki_revisions"."pinned" IN (0, 1)),
	CONSTRAINT "wiki_revisions_delete_is_archived" CHECK("wiki_revisions"."deleted_at" IS NULL OR "wiki_revisions"."archived_at" IS NOT NULL),
	CONSTRAINT "wiki_revisions_restore_positive" CHECK("wiki_revisions"."restored_from" IS NULL OR "wiki_revisions"."restored_from" >= 1)
);
--> statement-breakpoint

CREATE UNIQUE INDEX `app_migrations_ordinal_unique` ON `app_migrations` (`ordinal`);
--> statement-breakpoint

CREATE UNIQUE INDEX `event_raffle_draws_mutation_token_unique` ON `event_raffle_draws` (`mutation_token`);
--> statement-breakpoint

CREATE INDEX `idx_announcements_category_manage` ON `announcements` (`category`,`pinned`,`updated_at`,`id`,`archived_at`,`status`);
--> statement-breakpoint

CREATE INDEX `idx_announcements_category_public` ON `announcements` (`category`,`status`,`pinned`,`updated_at`,`id`,`publish_at`,`expires_at`);
--> statement-breakpoint

CREATE INDEX `idx_announcements_expiry` ON `announcements` (`status`,`expires_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_announcements_manage` ON `announcements` (`pinned`,`updated_at`,`id`,`archived_at`,`status`);
--> statement-breakpoint

CREATE INDEX `idx_announcements_public` ON `announcements` (`status`,`pinned`,`updated_at`,`id`,`publish_at`,`expires_at`);
--> statement-breakpoint

CREATE INDEX `idx_announcements_schedule` ON `announcements` (`status`,`publish_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_audit_archives_month_ready` ON `audit_archives` (`month`,`status`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX idx_audit_archives_retention ON audit_archives (status, completed_at, id);
--> statement-breakpoint

CREATE INDEX idx_audit_log_actor_occurred ON audit_log (actor_id, occurred_at, id);
--> statement-breakpoint

CREATE INDEX idx_audit_log_occurred ON audit_log (occurred_at, id);
--> statement-breakpoint

CREATE INDEX idx_audit_log_request ON audit_log (request_id);
--> statement-breakpoint

CREATE INDEX idx_audit_log_subject_occurred ON audit_log (subject_type, occurred_at, id);
--> statement-breakpoint

CREATE INDEX idx_audit_log_target_occurred ON audit_log (subject_type, subject_id, occurred_at, id);
--> statement-breakpoint

CREATE INDEX `idx_class_catalog_sort` ON `class_catalog` (`sort_order`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_class_tag_members_class` ON `class_tag_members` (`class_id`,`tag_id`);
--> statement-breakpoint

CREATE INDEX `idx_class_tags_owner` ON `class_tags` (`owner_kind`,`owner_id`);
--> statement-breakpoint

CREATE INDEX `idx_class_tags_sort` ON `class_tags` (`owner_kind`,`sort_order`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_email_verification_challenges_user` ON `email_verification_challenges` (`user_id`,`expires_at`);
--> statement-breakpoint

CREATE INDEX `idx_email_verification_challenges_user_last_sent` ON `email_verification_challenges` (`user_id`,`last_sent_at`);
--> statement-breakpoint

CREATE INDEX `idx_email_verification_cleanup_consumed` ON `email_verification_challenges` (`consumed_at`,`token_digest`) WHERE "email_verification_challenges"."consumed_at" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX `idx_email_verification_cleanup_expiry` ON `email_verification_challenges` (`expires_at`,`token_digest`);
--> statement-breakpoint

CREATE INDEX `idx_error_log_created` ON `error_log` (`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_error_log_request` ON `error_log` (`request_id`);
--> statement-breakpoint

CREATE INDEX `idx_error_log_source_created` ON `error_log` (`source`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_event_class_quotas_tag` ON `event_class_quotas` (`tag_id`,`event_id`);
--> statement-breakpoint

CREATE INDEX `idx_event_participants_event_joined` ON `event_participants` (`event_id`,`joined_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_event_participants_user_event` ON `event_participants` (`user_id`,`event_id`);
--> statement-breakpoint

CREATE INDEX `idx_event_poll_votes_event_user` ON `event_poll_votes` (`event_id`,`user_id`,`option_id`);
--> statement-breakpoint

CREATE INDEX `idx_event_poll_votes_user` ON `event_poll_votes` (`user_id`,`event_id`);
--> statement-breakpoint

CREATE INDEX `idx_event_raffle_draws_drawn` ON `event_raffle_draws` (`drawn_at`,`event_id`);
--> statement-breakpoint

CREATE INDEX `idx_event_raffle_winners_event` ON `event_raffle_winners` (`event_id`,`drawn_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_event_raffle_winners_user` ON `event_raffle_winners` (`user_id`,`event_id`);
--> statement-breakpoint

CREATE INDEX `idx_events_auto_archive_end_due` ON `events` (`auto_archive`,`auto_archived`,`archived_at`,`end_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_events_auto_archive_start_due` ON `events` (`auto_archive`,`auto_archived`,`archived_at`,`end_at`,`start_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_events_list_start` ON `events` (`start_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_events_locked_start` ON `events` (`signup_locked`,`start_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_events_pinned_start` ON `events` (`pinned`,`start_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_events_public_start` ON `events` (`archived_at`,`visible_at`,`start_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_events_raffle_due` ON `events` (`type`,`archived_at`,`end_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_events_type_start` ON `events` (`type`,`start_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_external_identities_user` ON `external_identities` (`user_id`,`provider`);
--> statement-breakpoint

CREATE INDEX `idx_gallery_items_created` ON `gallery_items` (`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_gallery_items_owner_created` ON `gallery_items` (`uploaded_by`,`type`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_gallery_items_type_created` ON `gallery_items` (`type`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_gallery_likes_user_created` ON `gallery_likes` (`user_id`,`created_at`,`item_id`);
--> statement-breakpoint

CREATE INDEX `idx_guild_wars_active_event` ON `guild_wars` (`status`,`event_id`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_guild_wars_history_created` ON `guild_wars` (`status`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_important_notice_audience_role` ON `important_notice_audience_roles` (`role_id`,`notice_id`);
--> statement-breakpoint

CREATE INDEX `idx_important_notice_receipt_user` ON `important_notice_receipts` (`user_id`,`notice_id`);
--> statement-breakpoint

CREATE INDEX `idx_important_notices_active` ON `important_notices` (`status`,`publish_at`,`expires_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_important_notices_admin` ON `important_notices` (`status`,`updated_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_invite_links_created` ON `invite_links` (`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_invite_links_role` ON `invite_links` (`role_id`);
--> statement-breakpoint

CREATE INDEX `idx_invite_links_status` ON `invite_links` (`revoked_at`,`expires_at`,`used_count`,`max_uses`);
--> statement-breakpoint

CREATE INDEX `idx_media_assets_delete_claim` ON `media_assets` (`delete_claim_token`) WHERE "media_assets"."delete_claim_token" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX `idx_media_assets_gc` ON `media_assets` (`state`,`expires_at`,`delete_claim_until`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_media_assets_gc_deleting` ON `media_assets` (`state`,`delete_claim_until`,`updated_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_media_assets_owner_purpose_state` ON `media_assets` (`owner_user_id`,`purpose`,`state`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_media_links_asset` ON `media_links` (`media_id`);
--> statement-breakpoint

CREATE INDEX `idx_member_absences_user_start` ON `member_absences` (`user_id`,`start_date`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_member_absences_window` ON `member_absences` (`end_date`,`start_date`,`user_id`);
--> statement-breakpoint

CREATE INDEX `idx_member_availability_lookup` ON `member_availability_windows` (`weekday`,`start_minute`,`end_minute`,`user_id`);
--> statement-breakpoint

CREATE INDEX `idx_member_badge_assignments_actor` ON `member_badge_assignments` (`assigned_by`);
--> statement-breakpoint

CREATE INDEX `idx_member_badge_assignments_user` ON `member_badge_assignments` (`user_id`,`badge_id`);
--> statement-breakpoint

CREATE INDEX `idx_member_badges_sort` ON `member_badges` (`sort_order`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_member_profile_classes_class` ON `member_profile_classes` (`class_id`,`user_id`);
--> statement-breakpoint

CREATE INDEX idx_notification_inbox_retention ON notification_inbox (occurred_at, id);
--> statement-breakpoint

CREATE INDEX idx_notification_inbox_user_occurred ON notification_inbox (user_id, occurred_at, id);
--> statement-breakpoint

CREATE INDEX idx_notification_inbox_user_unread ON notification_inbox (user_id, read_at, occurred_at, id);
--> statement-breakpoint

CREATE INDEX `idx_oauth_challenges_cleanup_consumed` ON `oauth_challenges` (`consumed_at`,`state_digest`) WHERE "oauth_challenges"."consumed_at" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX `idx_oauth_challenges_cleanup_expiry` ON `oauth_challenges` (`expires_at`,`state_digest`);
--> statement-breakpoint

CREATE INDEX `idx_recurring_template_class_quotas_tag` ON `recurring_template_class_quotas` (`tag_id`,`template_id`);
--> statement-breakpoint

CREATE INDEX `idx_recurring_template_weekdays_weekday` ON `recurring_template_weekdays` (`weekday`,`template_id`);
--> statement-breakpoint

CREATE INDEX `idx_recurring_templates_active` ON `recurring_templates` (`paused`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_recurring_templates_created_by` ON `recurring_templates` (`created_by`,`created_at`);
--> statement-breakpoint

CREATE INDEX idx_role_permissions_permission ON role_permissions (permission, role_id);
--> statement-breakpoint

CREATE INDEX `idx_roles_level` ON `roles` (`level`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_sessions_created` ON `sessions` (`created_at`,`token_digest`);
--> statement-breakpoint

CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`,`token_digest`);
--> statement-breakpoint

CREATE INDEX `idx_sessions_user_created` ON `sessions` (`user_id`,`created_at`,`token_digest`);
--> statement-breakpoint

CREATE INDEX `idx_storage_balances_quantity_item` ON `storage_balances` (`quantity`,`item_id`);
--> statement-breakpoint

CREATE INDEX `idx_storage_batches_actor_created_id` ON `storage_batches` (`actor_id`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_storage_batches_recipient_created_id` ON `storage_batches` (`recipient_user_id`,`created_at`,`id`) WHERE "storage_batches"."recipient_user_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX `idx_storage_categories_storage_name_id` ON `storage_categories` (`storage_id`,`name`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_storage_items_category_name_id` ON `storage_items` (`category_id`,`name`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_storage_items_member_deposit` ON `storage_items` (`storage_id`,`name`,`id`) WHERE "storage_items"."allow_member_deposit" = 1;
--> statement-breakpoint

CREATE INDEX `idx_storage_items_member_withdraw` ON `storage_items` (`storage_id`,`name`,`id`) WHERE "storage_items"."allow_member_withdraw" = 1;
--> statement-breakpoint

CREATE INDEX `idx_storage_items_storage_category_name_id` ON `storage_items` (`storage_id`,`category_id`,`name`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_storage_items_storage_name_id` ON `storage_items` (`storage_id`,`name`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_storage_ledger_actor_created_id` ON `storage_ledger_entries` (`actor_id`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_storage_ledger_created_id` ON `storage_ledger_entries` (`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_storage_ledger_item_created_id` ON `storage_ledger_entries` (`item_id`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_storage_ledger_recipient_created_id` ON `storage_ledger_entries` (`recipient_user_id`,`created_at`,`id`) WHERE "storage_ledger_entries"."recipient_user_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX `idx_storages_name_id` ON `storages` (`name`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_system_test_artifacts_cleanup` ON `system_test_artifacts` (`run_id`,`artifact_type`,`artifact_key`);
--> statement-breakpoint

CREATE INDEX `idx_system_test_before_images_cleanup` ON `system_test_before_images` (`run_id`,`target_type`,`target_id`);
--> statement-breakpoint

CREATE INDEX `idx_system_test_requests_run` ON `system_test_requests` (`run_id`,`started_at`,`request_id`);
--> statement-breakpoint

CREATE INDEX `idx_system_test_runs_actor` ON `system_test_runs` (`actor_user_id`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_system_test_runs_expiry` ON `system_test_runs` (`status`,`expires_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_users_role` ON `users` (`role_id`,`deleted_at`,`is_active`);
--> statement-breakpoint

CREATE INDEX `idx_users_roster` ON `users` (`deleted_at`,`is_active`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_users_roster_all` ON `users` (`deleted_at`,`created_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_war_members_team_sort` ON `war_members` (`team_id`,`sort_order`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_war_members_user_war` ON `war_members` (`user_id`,`war_id`);
--> statement-breakpoint

CREATE INDEX `idx_war_members_war_pool_sort` ON `war_members` (`war_id`,`team_id`,`sort_order`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_war_teams_war_sort` ON `war_teams` (`war_id`,`sort_order`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_wiki_articles_admin_curated` ON `wiki_articles` (`deleted_at`,"pinned" DESC,`sort_order`,`title`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_wiki_articles_admin_updated` ON `wiki_articles` (`deleted_at`,`updated_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_wiki_articles_category_curated` ON `wiki_articles` (`category_id`,`archived_at`,`pinned`,`sort_order`,`title`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_wiki_articles_deleted` ON `wiki_articles` (`deleted_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_wiki_articles_public_curated` ON `wiki_articles` (`deleted_at`,`archived_at`,"pinned" DESC,`sort_order`,`title`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_wiki_articles_visibility_updated` ON `wiki_articles` (`archived_at`,`updated_at`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_wiki_categories_tree_order` ON `wiki_categories` (`parent_id`,`sort_order`,`name`,`id`);
--> statement-breakpoint

CREATE INDEX `idx_wiki_revision_media_asset` ON `wiki_revision_media` (`media_id`,`revision_id`);
--> statement-breakpoint

CREATE UNIQUE INDEX ux_audit_archive_items_audit ON audit_archive_items (audit_id);
--> statement-breakpoint

CREATE UNIQUE INDEX ux_audit_archive_items_position ON audit_archive_items (archive_id, position);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_audit_archives_object_key` ON `audit_archives` (`object_key`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_audit_archives_one_pending` ON `audit_archives` (`status`) WHERE "audit_archives"."status" = 'pending';
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_class_catalog_label_nocase` ON `class_catalog` ("label" COLLATE NOCASE);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_class_tags_catalog_label_nocase` ON `class_tags` ("label" COLLATE NOCASE) WHERE "class_tags"."owner_kind" IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_event_participants_event_user` ON `event_participants` (`event_id`,`user_id`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_event_poll_options_event_sort` ON `event_poll_options` (`event_id`,`sort_order`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_event_raffle_winners_event_user` ON `event_raffle_winners` (`event_id`,`user_id`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_events_series_instance` ON `events` (`series_id`,`instance_date`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_external_identities_provider_subject` ON `external_identities` (`provider`,`provider_subject`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_external_identities_user_provider` ON `external_identities` (`user_id`,`provider`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_guild_wars_event` ON `guild_wars` (`event_id`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_guild_wars_mutation_token` ON `guild_wars` (`mutation_token`) WHERE "guild_wars"."mutation_token" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_invite_links_code_nocase` ON `invite_links` (`code` COLLATE NOCASE);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_media_links_target_order` ON `media_links` (`entity_type`,`entity_id`,`slot`,`sort_order`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_media_variants_identity` ON `media_variants` (`media_id`,`variant`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_media_variants_object_key` ON `media_variants` (`object_key`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_member_badges_name_nocase` ON `member_badges` ("name" COLLATE NOCASE);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_member_profile_classes_sort` ON `member_profile_classes` (`user_id`,`sort_order`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_member_profile_videos_sort` ON `member_profile_videos` (`user_id`,`sort_order`);
--> statement-breakpoint

CREATE UNIQUE INDEX ux_notification_inbox_user_source ON notification_inbox (user_id, source_key);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_roles_name_nocase` ON `roles` ("name" COLLATE NOCASE);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_storage_batches_actor_idempotency` ON `storage_batches` (`actor_id`,`idempotency_key`) WHERE "storage_batches"."idempotency_key" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_storage_categories_storage_id` ON `storage_categories` (`storage_id`,`id`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_storage_ledger_batch_item` ON `storage_ledger_entries` (`batch_id`,`item_id`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_storage_ledger_batch_position` ON `storage_ledger_entries` (`batch_id`,`batch_position`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_user_credentials_login_name_nocase` ON `user_credentials` (`login_name` COLLATE NOCASE);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_user_emails_normalized_nocase` ON `user_emails` (`normalized_email` COLLATE NOCASE);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_users_display_name_nocase` ON `users` (`display_name` COLLATE NOCASE);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_war_members_war_user` ON `war_members` (`war_id`,`user_id`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_war_teams_war_id_id` ON `war_teams` (`war_id`,`id`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_wiki_articles_slug` ON `wiki_articles` (`slug`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_wiki_categories_slug` ON `wiki_categories` (`slug`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_wiki_revision_media_order` ON `wiki_revision_media` (`revision_id`,`sort_order`);
--> statement-breakpoint

CREATE UNIQUE INDEX `ux_wiki_revisions_article_revision` ON `wiki_revisions` (`article_id`,`revision`);
--> statement-breakpoint

CREATE TRIGGER app_migrations_immutable_update
BEFORE UPDATE ON app_migrations
BEGIN
  SELECT RAISE(ABORT, 'application migration ledger is append-only');
END;
--> statement-breakpoint

CREATE TRIGGER app_migrations_immutable_delete
BEFORE DELETE ON app_migrations
BEGIN
  SELECT RAISE(ABORT, 'application migration ledger is append-only');
END;
--> statement-breakpoint

CREATE TRIGGER audit_archives_ready_immutable
BEFORE UPDATE ON audit_archives
WHEN OLD.status = 'ready'
BEGIN
  SELECT RAISE(ABORT, 'ready audit archives are immutable');
END;
--> statement-breakpoint

CREATE TRIGGER recurring_templates_catalog_limit
BEFORE INSERT ON recurring_templates
WHEN (SELECT count(*) FROM recurring_templates) >= 100
BEGIN
  SELECT RAISE(ABORT, 'recurring template catalog limit reached');
END;
--> statement-breakpoint

CREATE TRIGGER event_class_quota_tag_scope_insert
BEFORE INSERT ON event_class_quotas
WHEN NOT EXISTS (
  SELECT 1 FROM class_tags
  WHERE id = NEW.tag_id
    AND (owner_kind IS NULL OR (owner_kind = 'event' AND owner_id = NEW.event_id))
)
BEGIN
  SELECT RAISE(ABORT, 'event quota tag is outside event scope');
END;
--> statement-breakpoint

CREATE TRIGGER event_class_quota_tag_scope_update
BEFORE UPDATE OF event_id, tag_id ON event_class_quotas
WHEN NOT EXISTS (
  SELECT 1 FROM class_tags
  WHERE id = NEW.tag_id
    AND (owner_kind IS NULL OR (owner_kind = 'event' AND owner_id = NEW.event_id))
)
BEGIN
  SELECT RAISE(ABORT, 'event quota tag is outside event scope');
END;
--> statement-breakpoint

CREATE TRIGGER recurring_template_quota_tag_scope_insert
BEFORE INSERT ON recurring_template_class_quotas
WHEN NOT EXISTS (
  SELECT 1 FROM class_tags
  WHERE id = NEW.tag_id
    AND (owner_kind IS NULL OR (owner_kind = 'recurring_template' AND owner_id = NEW.template_id))
)
BEGIN
  SELECT RAISE(ABORT, 'template quota tag is outside template scope');
END;
--> statement-breakpoint

CREATE TRIGGER recurring_template_quota_tag_scope_update
BEFORE UPDATE OF template_id, tag_id ON recurring_template_class_quotas
WHEN NOT EXISTS (
  SELECT 1 FROM class_tags
  WHERE id = NEW.tag_id
    AND (owner_kind IS NULL OR (owner_kind = 'recurring_template' AND owner_id = NEW.template_id))
)
BEGIN
  SELECT RAISE(ABORT, 'template quota tag is outside template scope');
END;
--> statement-breakpoint

CREATE TRIGGER class_tag_scope_immutable
BEFORE UPDATE OF owner_kind, owner_id ON class_tags
WHEN OLD.owner_kind IS NOT NEW.owner_kind OR OLD.owner_id IS NOT NEW.owner_id
BEGIN
  SELECT RAISE(ABORT, 'class tag scope is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER event_poll_type_insert
BEFORE INSERT ON event_polls
WHEN NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND type = 'poll')
BEGIN
  SELECT RAISE(ABORT, 'poll settings require a poll event');
END;
--> statement-breakpoint

CREATE TRIGGER event_poll_type_update
BEFORE UPDATE OF event_id ON event_polls
WHEN NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND type = 'poll')
BEGIN
  SELECT RAISE(ABORT, 'poll settings require a poll event');
END;
--> statement-breakpoint

CREATE TRIGGER event_poll_parent_type_update
BEFORE UPDATE OF type ON events
WHEN NEW.type <> 'poll' AND EXISTS (SELECT 1 FROM event_polls WHERE event_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'poll settings require a poll event');
END;
--> statement-breakpoint

CREATE TRIGGER event_raffle_winner_type_insert
BEFORE INSERT ON event_raffle_winners
WHEN NOT EXISTS (
  SELECT 1
  FROM events
  JOIN event_participants
    ON event_participants.event_id = events.id
   AND event_participants.user_id = NEW.user_id
  WHERE events.id = NEW.event_id AND events.type = 'raffle'
)
BEGIN
  SELECT RAISE(ABORT, 'raffle winners must be event participants');
END;
--> statement-breakpoint

CREATE TRIGGER event_raffle_winner_type_update
BEFORE UPDATE OF event_id, user_id ON event_raffle_winners
WHEN NOT EXISTS (
  SELECT 1
  FROM events
  JOIN event_participants
    ON event_participants.event_id = events.id
   AND event_participants.user_id = NEW.user_id
  WHERE events.id = NEW.event_id AND events.type = 'raffle'
)
BEGIN
  SELECT RAISE(ABORT, 'raffle winners must be event participants');
END;
--> statement-breakpoint

CREATE TRIGGER event_raffle_draw_immutable
BEFORE UPDATE OF type, winner_count, signup_locked ON events
WHEN EXISTS (SELECT 1 FROM event_raffle_draws WHERE event_id = OLD.id)
  AND (
    NEW.type <> OLD.type
    OR NEW.winner_count IS NOT OLD.winner_count
    OR NEW.signup_locked <> 1
  )
BEGIN
  SELECT RAISE(ABORT, 'drawn raffle configuration is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER event_participant_insert_guard
BEFORE INSERT ON event_participants
WHEN NOT EXISTS (
    SELECT 1 FROM event_participants
    WHERE event_id = NEW.event_id AND user_id = NEW.user_id
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM events
      WHERE id = NEW.event_id
        AND type <> 'poll'
        AND archived_at IS NULL
        AND (end_at IS NULL OR end_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
    OR EXISTS (
      SELECT 1 FROM events
      WHERE id = NEW.event_id
        AND capacity IS NOT NULL
        AND (SELECT count(*) FROM event_participants WHERE event_id = NEW.event_id) >= capacity
    )
    OR (SELECT count(*) FROM event_participants WHERE event_id = NEW.event_id) >= 500
  )
BEGIN
  SELECT RAISE(ABORT, 'event signup is unavailable');
END;
--> statement-breakpoint

CREATE TRIGGER event_participant_identity_immutable
BEFORE UPDATE OF event_id, user_id ON event_participants
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.user_id IS NOT NEW.user_id
BEGIN
  SELECT RAISE(ABORT, 'event participant identity is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER event_delete_owned_class_tags
AFTER DELETE ON events
BEGIN
  DELETE FROM class_tags WHERE owner_kind = 'event' AND owner_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER recurring_template_delete_owned_class_tags
AFTER DELETE ON recurring_templates
BEGIN
  DELETE FROM class_tags WHERE owner_kind = 'recurring_template' AND owner_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER guild_wars_no_reopen
BEFORE UPDATE OF status ON guild_wars
WHEN OLD.status = 'concluded' AND NEW.status <> 'concluded'
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war cannot be reopened');
END;
--> statement-breakpoint

CREATE TRIGGER war_team_active_insert
BEFORE INSERT ON war_teams
WHEN NOT EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER war_team_active_update
BEFORE UPDATE ON war_teams
WHEN OLD.war_id IS NOT NEW.war_id
  OR NOT EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER war_team_active_delete
BEFORE DELETE ON war_teams
WHEN EXISTS (SELECT 1 FROM guild_wars WHERE id = OLD.war_id AND status = 'concluded')
  AND EXISTS (SELECT 1 FROM guild_wars WHERE id = OLD.war_id)
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER war_member_team_scope_insert
BEFORE INSERT ON war_members
WHEN NEW.team_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM war_teams WHERE id = NEW.team_id AND war_id = NEW.war_id)
BEGIN
  SELECT RAISE(ABORT, 'war member team is outside guild war');
END;
--> statement-breakpoint

CREATE TRIGGER war_member_team_scope_update
BEFORE UPDATE OF war_id, team_id ON war_members
WHEN NEW.team_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM war_teams WHERE id = NEW.team_id AND war_id = NEW.war_id)
BEGIN
  SELECT RAISE(ABORT, 'war member team is outside guild war');
END;
--> statement-breakpoint

CREATE TRIGGER war_member_active_insert
BEFORE INSERT ON war_members
WHEN NOT EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER war_member_participant_insert
BEFORE INSERT ON war_members
WHEN EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
  AND NOT EXISTS (
    SELECT 1
    FROM guild_wars
    JOIN event_participants
      ON event_participants.event_id = guild_wars.event_id
     AND event_participants.user_id = NEW.user_id
    WHERE guild_wars.id = NEW.war_id
  )
BEGIN
  SELECT RAISE(ABORT, 'active guild war members must be event participants');
END;
--> statement-breakpoint

CREATE TRIGGER war_member_participant_update
BEFORE UPDATE OF war_id, user_id ON war_members
WHEN EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
  AND NOT EXISTS (
    SELECT 1
    FROM guild_wars
    JOIN event_participants
      ON event_participants.event_id = guild_wars.event_id
     AND event_participants.user_id = NEW.user_id
    WHERE guild_wars.id = NEW.war_id
  )
BEGIN
  SELECT RAISE(ABORT, 'active guild war members must be event participants');
END;
--> statement-breakpoint

CREATE TRIGGER active_war_participant_delete
BEFORE DELETE ON event_participants
WHEN EXISTS (
  SELECT 1
  FROM guild_wars
  JOIN war_members ON war_members.war_id = guild_wars.id
  WHERE guild_wars.status = 'active'
    AND guild_wars.event_id = OLD.event_id
    AND war_members.user_id = OLD.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'active guild war roster member must remain an event participant');
END;
--> statement-breakpoint

CREATE TRIGGER war_member_active_roster_update
BEFORE UPDATE OF war_id, team_id, user_id, role_tag, sort_order ON war_members
WHEN OLD.war_id IS NOT NEW.war_id
  OR NOT EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER war_member_active_delete
BEFORE DELETE ON war_members
WHEN EXISTS (SELECT 1 FROM guild_wars WHERE id = OLD.war_id AND status = 'concluded')
  AND EXISTS (SELECT 1 FROM guild_wars WHERE id = OLD.war_id)
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER storage_items_initialize_balance
AFTER INSERT ON storage_items
BEGIN
  INSERT INTO storage_balances (item_id, quantity, updated_at)
  VALUES (NEW.id, 0, NEW.created_at);
END;
--> statement-breakpoint

CREATE TRIGGER storage_ledger_validate_insert
BEFORE INSERT ON storage_ledger_entries
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM storage_batches AS batch
    JOIN storage_items AS item ON item.id = NEW.item_id
    WHERE batch.id = NEW.batch_id
      AND batch.actor_id = NEW.actor_id
      AND batch.transaction_type = NEW.type
      AND batch.recipient_user_id IS NEW.recipient_user_id
      AND batch.note IS NEW.note
      AND batch.created_at = NEW.created_at
      AND (
        batch.access_mode = 'stock_admin'
        OR (
          batch.access_mode = 'member_self'
          AND batch.actor_id = batch.recipient_user_id
          AND (
            (NEW.type = 'intake' AND item.allow_member_deposit = 1)
            OR (NEW.type = 'distribute' AND item.allow_member_withdraw = 1)
          )
        )
      )
  ) THEN RAISE(ABORT, 'storage_ledger_authorization_invalid') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM storage_balances WHERE item_id = NEW.item_id
  ) THEN RAISE(ABORT, 'storage_balance_missing') END;

  SELECT CASE WHEN NEW.quantity_delta = 0
    THEN RAISE(ABORT, 'storage_balance_no_change')
  END;

  SELECT CASE WHEN (
    SELECT quantity + NEW.quantity_delta = quantity
    FROM storage_balances
    WHERE item_id = NEW.item_id
  ) THEN RAISE(ABORT, 'storage_balance_delta_too_small') END;

  SELECT CASE WHEN (
    SELECT quantity + NEW.quantity_delta
    FROM storage_balances
    WHERE item_id = NEW.item_id
  ) < 0 THEN RAISE(ABORT, 'storage_balance_negative') END;

  SELECT CASE WHEN abs((
    SELECT quantity + NEW.quantity_delta
    FROM storage_balances
    WHERE item_id = NEW.item_id
  )) >= 1e308 THEN RAISE(ABORT, 'storage_balance_non_finite') END;
END;
--> statement-breakpoint

CREATE TRIGGER storage_ledger_apply_balance
AFTER INSERT ON storage_ledger_entries
BEGIN
  UPDATE storage_balances
  SET quantity = quantity + NEW.quantity_delta,
      updated_at = NEW.created_at
  WHERE item_id = NEW.item_id;

  SELECT CASE WHEN changes() <> 1
    THEN RAISE(ABORT, 'storage_balance_update_failed')
  END;
END;
--> statement-breakpoint

CREATE TRIGGER storage_ledger_immutable_update
BEFORE UPDATE ON storage_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'storage_ledger_immutable');
END;
--> statement-breakpoint

CREATE TRIGGER storage_ledger_immutable_delete
BEFORE DELETE ON storage_ledger_entries
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_artifacts AS artifacts
  JOIN system_test_runs AS runs ON runs.id = artifacts.run_id
  WHERE runs.status = 'cleaning'
    AND (
      (artifacts.artifact_type = 'storage_batch' AND artifacts.artifact_key = OLD.batch_id)
      OR (artifacts.artifact_type = 'storage_item' AND artifacts.artifact_key = OLD.item_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'storage_ledger_immutable');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_runs_identity_immutable
BEFORE UPDATE OF id, actor_user_id, created_at, expires_at ON system_test_runs
WHEN OLD.id IS NOT NEW.id
  OR OLD.actor_user_id IS NOT NEW.actor_user_id
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.expires_at IS NOT NEW.expires_at
BEGIN
  SELECT RAISE(ABORT, 'system test run identity is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_runs_status_transition
BEFORE UPDATE OF status ON system_test_runs
WHEN OLD.status <> NEW.status AND NOT (
  (OLD.status = 'running' AND NEW.status = 'cleaning')
  OR (OLD.status = 'cleaning' AND NEW.status IN ('cleanup_failed', 'completed'))
  OR (OLD.status = 'cleanup_failed' AND NEW.status = 'cleaning')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid system test run status transition');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_requests_active_run_insert
BEFORE INSERT ON system_test_requests
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_runs AS runs
  WHERE runs.id = NEW.run_id
    AND runs.status = 'running'
    AND (
      NEW.actor_user_id IS NULL
      OR runs.actor_user_id = NEW.actor_user_id
      OR EXISTS (
        SELECT 1 FROM system_test_artifacts AS artifacts
        WHERE artifacts.run_id = runs.id
          AND artifacts.artifact_type = 'user'
          AND artifacts.artifact_key = NEW.actor_user_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'system test request is not bound to an active run actor');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_requests_immutable
BEFORE UPDATE ON system_test_requests
BEGIN
  SELECT RAISE(ABORT, 'system test requests are immutable');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_artifacts_active_request_insert
BEFORE INSERT ON system_test_artifacts
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_requests AS requests
  JOIN system_test_runs AS runs ON runs.id = requests.run_id
  WHERE requests.request_id = NEW.request_id
    AND requests.run_id = NEW.run_id
    AND runs.status = 'running'
)
BEGIN
  SELECT RAISE(ABORT, 'system test artifact requires its active request');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_artifacts_immutable
BEFORE UPDATE ON system_test_artifacts
BEGIN
  SELECT RAISE(ABORT, 'system test artifacts are immutable');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_artifacts_cleanup_delete_only
BEFORE DELETE ON system_test_artifacts
WHEN EXISTS (SELECT 1 FROM system_test_runs WHERE id = OLD.run_id)
  AND NOT EXISTS (
    SELECT 1 FROM system_test_runs
    WHERE id = OLD.run_id AND status = 'cleaning'
  )
BEGIN
  SELECT RAISE(ABORT, 'system test artifacts may only be deleted during cleanup');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_before_images_active_request_insert
BEFORE INSERT ON system_test_before_images
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_requests AS requests
  JOIN system_test_runs AS runs ON runs.id = requests.run_id
  WHERE requests.request_id = NEW.request_id
    AND requests.run_id = NEW.run_id
    AND runs.status = 'running'
)
OR EXISTS (
  SELECT 1 FROM system_test_artifacts AS artifacts
  WHERE artifacts.run_id = NEW.run_id
    AND artifacts.artifact_type = NEW.target_type
    AND artifacts.artifact_key = NEW.target_id
)
OR NOT (
  (NEW.target_type = 'class_catalog' AND EXISTS (
    SELECT 1 FROM class_catalog
    WHERE id = NEW.target_id
      AND sort_order = NEW.before_sort_order
      AND updated_at = NEW.before_updated_at
  ))
  OR (NEW.target_type = 'class_tag' AND EXISTS (
    SELECT 1 FROM class_tags
    WHERE id = NEW.target_id
      AND owner_kind IS NULL
      AND sort_order = NEW.before_sort_order
      AND updated_at = NEW.before_updated_at
  ))
  OR (NEW.target_type = 'badge' AND EXISTS (
    SELECT 1 FROM member_badges
    WHERE id = NEW.target_id
      AND sort_order = NEW.before_sort_order
      AND updated_at = NEW.before_updated_at
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'system test before-image requires an active request and exact existing target');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_before_images_guard_update
BEFORE UPDATE ON system_test_before_images
WHEN OLD.run_id IS NOT NEW.run_id
  OR OLD.target_type IS NOT NEW.target_type
  OR OLD.target_id IS NOT NEW.target_id
  OR OLD.before_sort_order IS NOT NEW.before_sort_order
  OR OLD.before_updated_at IS NOT NEW.before_updated_at
  OR OLD.created_at IS NOT NEW.created_at
  OR NOT EXISTS (
    SELECT 1
    FROM system_test_requests AS requests
    JOIN system_test_runs AS runs ON runs.id = requests.run_id
    WHERE requests.request_id = NEW.request_id
      AND requests.run_id = NEW.run_id
      AND runs.status = 'running'
  )
BEGIN
  SELECT RAISE(ABORT, 'system test before-image original state is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_before_images_cleanup_delete_only
BEFORE DELETE ON system_test_before_images
WHEN EXISTS (SELECT 1 FROM system_test_runs WHERE id = OLD.run_id)
  AND (
    NOT EXISTS (
      SELECT 1 FROM system_test_runs
      WHERE id = OLD.run_id AND status = 'cleaning'
    )
    OR NOT (
      (OLD.target_type = 'class_catalog' AND EXISTS (
        SELECT 1 FROM class_catalog
        WHERE id = OLD.target_id
          AND sort_order = OLD.before_sort_order
          AND updated_at = OLD.before_updated_at
      ))
      OR (OLD.target_type = 'class_tag' AND EXISTS (
        SELECT 1 FROM class_tags
        WHERE id = OLD.target_id
          AND owner_kind IS NULL
          AND sort_order = OLD.before_sort_order
          AND updated_at = OLD.before_updated_at
      ))
      OR (OLD.target_type = 'badge' AND EXISTS (
        SELECT 1 FROM member_badges
        WHERE id = OLD.target_id
          AND sort_order = OLD.before_sort_order
          AND updated_at = OLD.before_updated_at
      ))
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'system test before-image may only be deleted after exact cleanup restore');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_error_artifact_registry
AFTER INSERT ON error_log
WHEN NEW.request_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM system_test_requests
    WHERE request_id = NEW.request_id
  )
BEGIN
  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT run_id, 'error_log', NEW.id, NEW.request_id, NEW.created_at
  FROM system_test_requests
  WHERE request_id = NEW.request_id;
END;
--> statement-breakpoint

CREATE TRIGGER wiki_revisions_snapshot_matches_article
BEFORE INSERT ON wiki_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM wiki_articles
  WHERE id = NEW.article_id
    AND current_revision = NEW.revision
    AND title = NEW.title
    AND slug = NEW.slug
    AND category_id = NEW.category_id
    AND body_json = NEW.body_json
    AND sort_order = NEW.sort_order
    AND pinned = NEW.pinned
    AND archived_at IS NEW.archived_at
    AND deleted_at IS NEW.deleted_at
)
BEGIN
  SELECT RAISE(ABORT, 'wiki revision must snapshot the current article');
END;
--> statement-breakpoint

CREATE TRIGGER wiki_revisions_restore_source_valid
BEFORE INSERT ON wiki_revisions
WHEN NEW.restored_from IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM wiki_revisions
  WHERE article_id = NEW.article_id
    AND revision = NEW.restored_from
    AND revision < NEW.revision
)
BEGIN
  SELECT RAISE(ABORT, 'wiki restore source does not exist');
END;
--> statement-breakpoint

CREATE TRIGGER wiki_revisions_update_immutable
BEFORE UPDATE ON wiki_revisions
BEGIN
  SELECT RAISE(ABORT, 'wiki revisions are immutable');
END;
--> statement-breakpoint

CREATE TRIGGER wiki_revisions_delete_system_test_only
BEFORE DELETE ON wiki_revisions
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_artifacts AS artifacts
  JOIN system_test_runs AS runs ON runs.id = artifacts.run_id
  WHERE artifacts.artifact_type = 'wiki_article'
    AND artifacts.artifact_key = OLD.article_id
    AND runs.status = 'cleaning'
)
BEGIN
  SELECT RAISE(ABORT, 'wiki revisions are immutable');
END;
--> statement-breakpoint

CREATE TRIGGER wiki_articles_physical_delete_system_test_only
BEFORE DELETE ON wiki_articles
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_artifacts AS artifacts
  JOIN system_test_runs AS runs ON runs.id = artifacts.run_id
  WHERE artifacts.artifact_type = 'wiki_article'
    AND artifacts.artifact_key = OLD.id
    AND runs.status = 'cleaning'
)
BEGIN
  SELECT RAISE(ABORT, 'wiki articles use tombstone deletion');
END;
--> statement-breakpoint

CREATE TRIGGER auth_role_permission_identity_immutable
BEFORE UPDATE OF role_id, permission ON role_permissions
WHEN OLD.role_id IS NOT NEW.role_id OR OLD.permission IS NOT NEW.permission
BEGIN
  SELECT RAISE(ABORT, 'role permission identity is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER auth_keep_last_role_manager_on_permission_delete
BEFORE DELETE ON role_permissions
WHEN OLD.permission = 'admin.roles.manage'
 AND EXISTS (
   SELECT 1
   FROM users u
   WHERE u.role_id = OLD.role_id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
 )
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.role_id <> OLD.role_id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND rp.permission = 'admin.roles.manage'
 )
BEGIN
  SELECT RAISE(ABORT, 'last role manager required');
END;
--> statement-breakpoint

CREATE TRIGGER auth_keep_last_role_manager_on_user_update
BEFORE UPDATE OF role_id, is_active, deleted_at ON users
WHEN OLD.is_active = 1
 AND OLD.deleted_at IS NULL
 AND EXISTS (
   SELECT 1 FROM role_permissions rp
   WHERE rp.role_id = OLD.role_id AND rp.permission = 'admin.roles.manage'
 )
 AND (
   NEW.is_active = 0
   OR NEW.deleted_at IS NOT NULL
   OR NOT EXISTS (
     SELECT 1 FROM role_permissions rp
     WHERE rp.role_id = NEW.role_id AND rp.permission = 'admin.roles.manage'
   )
 )
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.id <> OLD.id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND rp.permission = 'admin.roles.manage'
 )
BEGIN
  SELECT RAISE(ABORT, 'last role manager required');
END;
--> statement-breakpoint

CREATE TRIGGER auth_keep_last_role_manager_on_user_delete
BEFORE DELETE ON users
WHEN OLD.is_active = 1
 AND OLD.deleted_at IS NULL
 AND EXISTS (
   SELECT 1 FROM role_permissions rp
   WHERE rp.role_id = OLD.role_id AND rp.permission = 'admin.roles.manage'
 )
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.id <> OLD.id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND rp.permission = 'admin.roles.manage'
 )
BEGIN
  SELECT RAISE(ABORT, 'last role manager required');
END;
--> statement-breakpoint

CREATE TRIGGER media_links_before_insert
BEFORE INSERT ON media_links
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM media_assets
      WHERE id = NEW.media_id
        AND state IN ('staged', 'attached')
    ) THEN RAISE(ABORT, 'media asset is not attachable')
  END;
END;
--> statement-breakpoint

CREATE TRIGGER media_links_after_insert
AFTER INSERT ON media_links
BEGIN
  UPDATE media_assets
  SET state = 'attached',
      expires_at = NULL,
      delete_claim_token = NULL,
      delete_claim_until = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.media_id;
END;
--> statement-breakpoint

CREATE TRIGGER media_links_target_immutable
BEFORE UPDATE OF media_id, entity_type, entity_id, slot ON media_links
WHEN OLD.media_id <> NEW.media_id
  OR OLD.entity_type <> NEW.entity_type
  OR OLD.entity_id <> NEW.entity_id
  OR OLD.slot <> NEW.slot
BEGIN
  SELECT RAISE(ABORT, 'media link target is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER media_links_after_delete
AFTER DELETE ON media_links
BEGIN
  UPDATE media_assets
  SET state = 'deleting',
      expires_at = NULL,
      delete_claim_token = NULL,
      delete_claim_until = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.media_id
    AND state = 'attached'
    AND NOT EXISTS (SELECT 1 FROM media_links WHERE media_id = OLD.media_id)
    AND NOT EXISTS (SELECT 1 FROM wiki_revision_media WHERE media_id = OLD.media_id);
END;
--> statement-breakpoint

CREATE TRIGGER media_assets_identity_immutable
BEFORE UPDATE OF owner_user_id, purpose, media_type ON media_assets
WHEN OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.purpose <> NEW.purpose
  OR OLD.media_type <> NEW.media_type
BEGIN
  SELECT RAISE(ABORT, 'media asset identity is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER media_links_target_contract
BEFORE INSERT ON media_links
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM media_assets AS assets
    WHERE assets.id = NEW.media_id AND (
      (assets.purpose = 'member_avatar' AND NEW.entity_type = 'member_profile' AND NEW.slot = 'avatar')
      OR (assets.purpose = 'member_image' AND NEW.entity_type = 'member_profile' AND NEW.slot = 'image')
      OR (assets.purpose = 'member_audio' AND NEW.entity_type = 'member_profile' AND NEW.slot = 'audio')
      OR (assets.purpose = 'gallery_image' AND NEW.entity_type = 'gallery_item' AND NEW.slot = 'image')
      OR (assets.purpose = 'event_image' AND NEW.entity_type IN ('event', 'recurring_template') AND NEW.slot = 'attachment')
      OR (assets.purpose = 'announcement_image' AND NEW.entity_type = 'announcement' AND NEW.slot = 'body')
      OR (assets.purpose = 'announcement_attachment' AND NEW.entity_type = 'announcement' AND NEW.slot = 'attachment')
      OR (assets.purpose = 'wiki_image' AND NEW.entity_type = 'wiki_article' AND NEW.slot = 'body')
      OR (assets.purpose = 'storage_image' AND NEW.entity_type = 'storage_item' AND NEW.slot = 'image')
      OR (assets.purpose = 'class_icon' AND NEW.entity_type = 'class_catalog' AND NEW.slot = 'icon')
      OR (assets.purpose = 'site_logo' AND NEW.entity_type = 'site_config' AND NEW.slot = 'logo')
    )
  ) THEN RAISE(ABORT, 'media purpose does not support target') END;

  SELECT CASE WHEN
    (NEW.entity_type = 'member_profile' AND NOT EXISTS (SELECT 1 FROM member_profiles WHERE user_id = NEW.entity_id))
    OR (NEW.entity_type = 'gallery_item' AND NOT EXISTS (SELECT 1 FROM gallery_items WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'recurring_template' AND NOT EXISTS (SELECT 1 FROM recurring_templates WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'announcement' AND NOT EXISTS (SELECT 1 FROM announcements WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'wiki_article' AND NOT EXISTS (SELECT 1 FROM wiki_articles WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'storage_item' AND NOT EXISTS (SELECT 1 FROM storage_items WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'class_catalog' AND NOT EXISTS (SELECT 1 FROM class_catalog WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'site_config' AND (NEW.entity_id <> 'site' OR NOT EXISTS (SELECT 1 FROM site_config WHERE singleton = 1)))
  THEN RAISE(ABORT, 'media target does not exist') END;
END;
--> statement-breakpoint

CREATE TRIGGER member_profiles_media_cleanup AFTER DELETE ON member_profiles
BEGIN
  DELETE FROM media_links WHERE entity_type = 'member_profile' AND entity_id = OLD.user_id;
END;
--> statement-breakpoint

CREATE TRIGGER gallery_items_media_cleanup AFTER DELETE ON gallery_items
BEGIN
  DELETE FROM media_links WHERE entity_type = 'gallery_item' AND entity_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER events_media_cleanup AFTER DELETE ON events
BEGIN
  DELETE FROM media_links WHERE entity_type = 'event' AND entity_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER recurring_templates_media_cleanup AFTER DELETE ON recurring_templates
BEGIN
  DELETE FROM media_links WHERE entity_type = 'recurring_template' AND entity_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER announcements_media_cleanup AFTER DELETE ON announcements
BEGIN
  DELETE FROM media_links WHERE entity_type = 'announcement' AND entity_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER wiki_articles_media_cleanup AFTER DELETE ON wiki_articles
BEGIN
  DELETE FROM media_links WHERE entity_type = 'wiki_article' AND entity_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER storage_items_media_cleanup AFTER DELETE ON storage_items
BEGIN
  DELETE FROM media_links WHERE entity_type = 'storage_item' AND entity_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER class_catalog_media_cleanup AFTER DELETE ON class_catalog
BEGIN
  DELETE FROM media_links WHERE entity_type = 'class_catalog' AND entity_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER wiki_revision_media_insert_valid
BEFORE INSERT ON wiki_revision_media
WHEN NOT EXISTS (
  SELECT 1
  FROM wiki_revisions AS revisions
  JOIN media_assets AS assets ON assets.id = NEW.media_id
  WHERE revisions.id = NEW.revision_id
    AND assets.purpose = 'wiki_image'
    AND assets.state IN ('staged', 'attached')
    AND NEW.audience = 'private'
)
BEGIN
  SELECT RAISE(ABORT, 'wiki revision media is not attachable');
END;
--> statement-breakpoint

CREATE TRIGGER wiki_revision_media_after_insert
AFTER INSERT ON wiki_revision_media
BEGIN
  UPDATE media_assets
  SET state = 'attached',
      expires_at = NULL,
      delete_claim_token = NULL,
      delete_claim_until = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.media_id;
END;
--> statement-breakpoint

CREATE TRIGGER wiki_revision_media_update_immutable
BEFORE UPDATE ON wiki_revision_media
BEGIN
  SELECT RAISE(ABORT, 'wiki revision media is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER wiki_revision_media_delete_system_test_only
BEFORE DELETE ON wiki_revision_media
WHEN NOT EXISTS (
  SELECT 1
  FROM wiki_revisions AS revisions
  JOIN system_test_artifacts AS artifacts
    ON artifacts.artifact_type = 'wiki_article'
   AND artifacts.artifact_key = revisions.article_id
  JOIN system_test_runs AS runs
    ON runs.id = artifacts.run_id
   AND runs.status = 'cleaning'
  WHERE revisions.id = OLD.revision_id
)
BEGIN
  SELECT RAISE(ABORT, 'wiki revision media is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER wiki_revision_media_after_delete
AFTER DELETE ON wiki_revision_media
BEGIN
  UPDATE media_assets
  SET state = 'deleting',
      expires_at = NULL,
      delete_claim_token = NULL,
      delete_claim_until = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.media_id
    AND state = 'attached'
    AND NOT EXISTS (SELECT 1 FROM media_links WHERE media_id = OLD.media_id)
    AND NOT EXISTS (SELECT 1 FROM wiki_revision_media WHERE media_id = OLD.media_id);
END;
--> statement-breakpoint

CREATE TRIGGER wiki_categories_parent_depth_insert
BEFORE INSERT ON wiki_categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'wiki categories are flat');
END;
--> statement-breakpoint

CREATE TRIGGER wiki_categories_parent_depth_update
BEFORE UPDATE OF parent_id ON wiki_categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'wiki categories are flat');
END;
--> statement-breakpoint

CREATE TRIGGER notification_inbox_member_joined
AFTER INSERT ON users
WHEN NEW.is_active = 1 AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'member_joined', 'member', NEW.id,
    'member_joined:' || NEW.id, json_object('display_name', NEW.display_name), NEW.created_at, NULL
  FROM users AS recipients
  LEFT JOIN notification_preferences AS preferences ON preferences.user_id = recipients.id
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL AND recipients.id <> NEW.id
    AND coalesce(preferences.member_joined, 1) = 1
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
--> statement-breakpoint

CREATE TRIGGER notification_inbox_announcement_published_insert
AFTER INSERT ON announcements
WHEN NEW.status = 'published' AND NEW.publish_at IS NOT NULL
  AND NEW.publish_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'announcement_published', 'announcement', NEW.id,
    'announcement_published:' || NEW.id, json_object('title', NEW.title), NEW.publish_at, NULL
  FROM users AS recipients
  LEFT JOIN notification_preferences AS preferences ON preferences.user_id = recipients.id
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
    AND coalesce(preferences.announcement_published, 1) = 1
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
--> statement-breakpoint

CREATE TRIGGER notification_inbox_announcement_published_update
AFTER UPDATE OF status ON announcements
WHEN OLD.status <> 'published' AND NEW.status = 'published' AND NEW.publish_at IS NOT NULL
  AND NEW.publish_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'announcement_published', 'announcement', NEW.id,
    'announcement_published:' || NEW.id, json_object('title', NEW.title), NEW.publish_at, NULL
  FROM users AS recipients
  LEFT JOIN notification_preferences AS preferences ON preferences.user_id = recipients.id
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
    AND coalesce(preferences.announcement_published, 1) = 1
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
--> statement-breakpoint

CREATE TRIGGER notification_inbox_event_created
AFTER INSERT ON events
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'event_created', 'event', NEW.id,
    'event_created:' || NEW.id, json_object('title', NEW.title, 'start_at', NEW.start_at), NEW.created_at, NULL
  FROM users AS recipients
  LEFT JOIN notification_preferences AS preferences ON preferences.user_id = recipients.id
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
    AND coalesce(preferences.event_created, 1) = 1
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
--> statement-breakpoint

CREATE TRIGGER notification_inbox_wiki_article_created
AFTER INSERT ON wiki_articles
WHEN NEW.archived_at IS NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'wiki_article_created', 'wiki_article', NEW.id,
    'wiki_article_created:' || NEW.id, json_object('title', NEW.title, 'slug', NEW.slug), NEW.created_at, NULL
  FROM users AS recipients
  LEFT JOIN notification_preferences AS preferences ON preferences.user_id = recipients.id
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
    AND coalesce(preferences.wiki_article_created, 1) = 1
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
--> statement-breakpoint

CREATE TRIGGER storage_ledger_advance_item_revision
AFTER INSERT ON storage_ledger_entries
BEGIN
  UPDATE storage_items
  SET updated_at = CASE
    WHEN julianday(updated_at) IS NOT NULL
      AND julianday(updated_at) >= julianday(NEW.created_at)
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', julianday(updated_at) + 0.001 / 86400.0)
    ELSE NEW.created_at
  END
  WHERE id = NEW.item_id;

  SELECT CASE WHEN changes() <> 1
    THEN RAISE(ABORT, 'storage_item_revision_update_failed')
  END;
END;
--> statement-breakpoint

CREATE TRIGGER media_variants_identity_immutable
BEFORE UPDATE ON media_variants
BEGIN
  SELECT RAISE(ABORT, 'media variant metadata is immutable');
END;
--> statement-breakpoint

CREATE TRIGGER audit_log_immutable
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit rows are immutable');
END;
--> statement-breakpoint

CREATE TRIGGER audit_archive_items_pending_only
BEFORE INSERT ON audit_archive_items
WHEN NOT EXISTS (
  SELECT 1 FROM audit_archives
  WHERE id = NEW.archive_id AND status = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'audit archive is not pending');
END;
--> statement-breakpoint

CREATE TRIGGER audit_archive_items_immutable
BEFORE UPDATE ON audit_archive_items
BEGIN
  SELECT RAISE(ABORT, 'audit archive items are immutable');
END;
--> statement-breakpoint

CREATE TRIGGER audit_log_delete_only_ready_archive
BEFORE DELETE ON audit_log
WHEN NOT EXISTS (
  SELECT 1
  FROM audit_archive_items AS items
  JOIN audit_archives AS archives ON archives.id = items.archive_id
  WHERE items.audit_id = OLD.id AND archives.status = 'ready'
)
AND NOT EXISTS (
  SELECT 1
  FROM system_test_artifacts AS artifacts
  JOIN system_test_runs AS runs ON runs.id = artifacts.run_id
  WHERE artifacts.artifact_type = 'audit_log'
    AND artifacts.artifact_key = OLD.id
    AND runs.status = 'cleaning'
)
BEGIN
  SELECT RAISE(ABORT, 'audit rows may only be deleted after archive finalization');
END;
--> statement-breakpoint

CREATE TRIGGER audit_archives_finalize_consistent
BEFORE UPDATE OF status ON audit_archives
WHEN OLD.status = 'pending' AND NEW.status = 'ready'
  AND (
    NEW.row_count < 1
    OR NEW.row_count <> (SELECT COUNT(*) FROM audit_archive_items WHERE archive_id = OLD.id)
  )
BEGIN
  SELECT RAISE(ABORT, 'audit archive item count mismatch');
END;
--> statement-breakpoint

CREATE TRIGGER system_test_audit_artifact_registry
AFTER INSERT ON audit_log
WHEN EXISTS (
  SELECT 1 FROM system_test_requests
  WHERE request_id = NEW.request_id
)
BEGIN
  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT run_id, 'audit_log', NEW.id, NEW.request_id, NEW.occurred_at
  FROM system_test_requests
  WHERE request_id = NEW.request_id;

  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT requests.run_id,
    CASE
      WHEN NEW.subject_type = 'user' AND NEW.action IN ('create', 'register', 'admin_create_member') THEN 'user'
      WHEN NEW.subject_type = 'invite_link' AND NEW.action = 'create' THEN 'invite_link'
      WHEN NEW.subject_type = 'role' AND NEW.action = 'create' THEN 'role'
      WHEN NEW.subject_type = 'event' AND NEW.action = 'create' THEN 'event'
      WHEN NEW.subject_type = 'recurring_template' AND NEW.action = 'create' THEN 'recurring_template'
      WHEN NEW.subject_type = 'announcement' AND NEW.action = 'create' THEN 'announcement'
      WHEN NEW.subject_type = 'gallery_item' AND NEW.action = 'create_video' THEN 'gallery_item'
      WHEN NEW.subject_type = 'guild_war_history' AND NEW.action IN ('create', 'conclude') THEN 'guild_war'
      WHEN NEW.subject_type = 'wiki_category' AND NEW.action = 'create' THEN 'wiki_category'
      WHEN NEW.subject_type = 'wiki_article' AND NEW.action = 'create' THEN 'wiki_article'
      WHEN NEW.subject_type IN ('badge', 'member_badge') AND NEW.action = 'create' THEN 'badge'
      WHEN NEW.subject_type = 'storage' AND NEW.action = 'create' THEN 'storage'
      WHEN NEW.subject_type = 'storage_category' AND NEW.action = 'create' THEN 'storage_category'
      WHEN NEW.subject_type = 'storage_item' AND NEW.action = 'create' THEN 'storage_item'
      WHEN NEW.subject_type = 'storage_transaction' AND NEW.action IN ('intake', 'distribute', 'adjust') THEN 'storage_batch'
      WHEN NEW.subject_type = 'media_asset' AND NEW.action = 'upload' THEN 'media_asset'
      WHEN NEW.subject_type = 'class_catalog' AND NEW.action = 'create' THEN 'class_catalog'
      WHEN NEW.subject_type = 'class_tag' AND NEW.action = 'create' THEN 'class_tag'
      WHEN NEW.subject_type = 'member_absence' AND NEW.action = 'create' THEN 'member_absence'
    END,
    NEW.subject_id,
    NEW.request_id,
    NEW.occurred_at
  FROM system_test_requests AS requests
  WHERE requests.request_id = NEW.request_id
    AND (
      (NEW.subject_type = 'user' AND NEW.action IN ('create', 'register', 'admin_create_member'))
      OR (NEW.subject_type = 'invite_link' AND NEW.action = 'create')
      OR (NEW.subject_type = 'role' AND NEW.action = 'create')
      OR (NEW.subject_type = 'event' AND NEW.action = 'create')
      OR (NEW.subject_type = 'recurring_template' AND NEW.action = 'create')
      OR (NEW.subject_type = 'announcement' AND NEW.action = 'create')
      OR (NEW.subject_type = 'gallery_item' AND NEW.action = 'create_video')
      OR (NEW.subject_type = 'guild_war_history' AND NEW.action IN ('create', 'conclude'))
      OR (NEW.subject_type = 'wiki_category' AND NEW.action = 'create')
      OR (NEW.subject_type = 'wiki_article' AND NEW.action = 'create')
      OR (NEW.subject_type IN ('badge', 'member_badge') AND NEW.action = 'create')
      OR (NEW.subject_type = 'storage' AND NEW.action = 'create')
      OR (NEW.subject_type = 'storage_category' AND NEW.action = 'create')
      OR (NEW.subject_type = 'storage_item' AND NEW.action = 'create')
      OR (NEW.subject_type = 'storage_transaction' AND NEW.action IN ('intake', 'distribute', 'adjust'))
      OR (NEW.subject_type = 'media_asset' AND NEW.action = 'upload')
      OR (NEW.subject_type = 'class_catalog' AND NEW.action = 'create')
      OR (NEW.subject_type = 'class_tag' AND NEW.action = 'create')
      OR (NEW.subject_type = 'member_absence' AND NEW.action = 'create')
    );

  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT requests.run_id, 'gallery_item', items.id, NEW.request_id, NEW.occurred_at
  FROM system_test_requests AS requests
  JOIN json_each(CASE
    WHEN NEW.subject_type = 'gallery_item' AND NEW.action = 'upload_images'
      THEN '["' || replace(NEW.subject_id, ',', '","') || '"]'
    ELSE '[]'
  END) AS ids
  JOIN gallery_items AS items ON items.id = ids.value
  WHERE requests.request_id = NEW.request_id
    AND NEW.subject_type = 'gallery_item'
    AND NEW.action = 'upload_images';

  INSERT OR IGNORE INTO system_test_artifacts
    (run_id, artifact_type, artifact_key, request_id, created_at)
  SELECT requests.run_id, 'guild_war', wars.id, NEW.request_id, NEW.occurred_at
  FROM system_test_requests AS requests
  JOIN guild_wars AS wars ON wars.event_id = NEW.subject_id
  WHERE requests.request_id = NEW.request_id
    AND NEW.subject_type = 'guild_war'
    AND NEW.action = 'init';
END;
--> statement-breakpoint

INSERT INTO "roles" ("id", "name", "level", "color", "revision_token") VALUES ('admin', 'Admin', 1000, 'red', 'seed-role-admin-0001');
--> statement-breakpoint

INSERT INTO "roles" ("id", "name", "level", "color", "revision_token") VALUES ('member', 'Member', 100, 'gray', 'seed-role-member-0001');
--> statement-breakpoint

INSERT INTO "roles" ("id", "name", "level", "color", "revision_token") VALUES ('moderator', 'Moderator', 500, '#756047', 'seed-role-moderator-0001');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.analytics.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.analytics.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.audit.export');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.audit.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.badges.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.classes.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.importantNotices.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.invite.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.invite.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.roles.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.roles.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.siteConfig.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.status.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.storage.items');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.storage.stock');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.storage.structure');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.users.activate');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.users.delete');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.users.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.users.password');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.users.role');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'admin.users.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'announcements.archive');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'announcements.create');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'announcements.delete');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'announcements.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'events.archive');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'events.create');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'events.delete');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'events.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'events.templates');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'gallery.delete');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'gallery.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'gallery.upload');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'guildwar.history.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'guildwar.teams.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'wiki.articles.archive');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'wiki.articles.create');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'wiki.articles.delete');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'wiki.articles.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('admin', 'wiki.categories.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('member', 'gallery.upload');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'admin.analytics.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'admin.audit.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'admin.invite.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'admin.roles.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'admin.status.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'admin.users.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'admin.users.view');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'announcements.archive');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'announcements.create');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'announcements.delete');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'announcements.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'events.archive');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'events.create');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'events.delete');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'events.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'events.templates');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'gallery.delete');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'gallery.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'gallery.upload');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'guildwar.history.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'guildwar.teams.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'wiki.articles.archive');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'wiki.articles.create');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'wiki.articles.delete');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'wiki.articles.edit');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('moderator', 'wiki.categories.manage');
--> statement-breakpoint

INSERT INTO "site_config" ("singleton", "site_name", "site_logo_media_id", "default_site_logo_url", "feature_announcements", "feature_events", "feature_guild_war", "feature_gallery", "feature_wiki", "feature_tools", "feature_storage", "max_site_logo_bytes", "max_class_icon_bytes", "max_profile_image_bytes", "max_profile_audio_bytes", "max_announcement_image_bytes", "max_wiki_image_bytes", "max_event_image_bytes", "max_gallery_image_bytes", "max_storage_image_bytes", "quota_profile", "quota_announcement", "quota_gallery", "quota_wiki", "storage_images_per_item", "absence_max_span_days", "absence_max_entries_per_user", "analytics_reference_duration_minutes", "analytics_weight_kills", "analytics_weight_towers", "analytics_weight_base_hp", "analytics_weight_credits", "analytics_weight_distance", "revision_token") VALUES (1, 'Infini Guild', NULL, '/guild-logo.svg', 1, 1, 1, 1, 1, 1, 1, 2097152, 524288, 5242880, 20971520, 5242880, 5242880, 5242880, 10485760, 5242880, 10, 10, 20, 10, 5, 366, 20, 30, 0.3, 0.1, 0.15, 0.3, 0.15, 'seed-site-config-0001');
--> statement-breakpoint

INSERT INTO "wiki_category_state" ("singleton", "revision_token") VALUES (1, 'seed-wiki-state-0001');
--> statement-breakpoint
-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0000_core', 0, '72d9c2ac8175e78034f22cfef732ef841482fc92e300db2090c828d0b16cacb4');
