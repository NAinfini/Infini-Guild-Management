ALTER TABLE `gallery_items` ADD COLUMN `title` text DEFAULT 'Untitled' NOT NULL
  CONSTRAINT "gallery_items_title_bounded" CHECK(length(trim(`title`)) BETWEEN 1 AND 100);--> statement-breakpoint
UPDATE `gallery_items`
SET `title` = substr(trim(`caption`), 1, 100)
WHERE `caption` IS NOT NULL AND length(trim(`caption`)) > 0;--> statement-breakpoint

CREATE TABLE `gallery_likes` (
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`item_id`, `user_id`),
	FOREIGN KEY (`item_id`) REFERENCES `gallery_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_gallery_likes_user_created` ON `gallery_likes` (`user_id`,`created_at`,`item_id`);--> statement-breakpoint

ALTER TABLE `announcements` ADD COLUMN `category` text DEFAULT 'announcement' NOT NULL
  CONSTRAINT "announcements_category_valid" CHECK(`category` IN ('announcement', 'event', 'war', 'important'));--> statement-breakpoint
ALTER TABLE `announcements` ADD COLUMN `view_count` integer DEFAULT 0 NOT NULL
  CONSTRAINT "announcements_view_count_valid" CHECK(`view_count` >= 0);--> statement-breakpoint
CREATE INDEX `idx_announcements_category_public` ON `announcements` (`category`,`status`,`updated_at`,`id`);--> statement-breakpoint

ALTER TABLE `wiki_articles` ADD COLUMN `view_count` integer DEFAULT 0 NOT NULL
  CONSTRAINT "wiki_articles_view_count_valid" CHECK(`view_count` >= 0);--> statement-breakpoint
UPDATE `wiki_categories` SET `parent_id` = NULL WHERE `parent_id` IS NOT NULL;--> statement-breakpoint
DROP TRIGGER `wiki_categories_parent_depth_insert`;--> statement-breakpoint
DROP TRIGGER `wiki_categories_parent_depth_update`;--> statement-breakpoint
CREATE TRIGGER wiki_categories_parent_depth_insert
BEFORE INSERT ON wiki_categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'wiki categories are flat');
END;--> statement-breakpoint
CREATE TRIGGER wiki_categories_parent_depth_update
BEFORE UPDATE OF parent_id ON wiki_categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'wiki categories are flat');
END;--> statement-breakpoint

ALTER TABLE `storage_items` ADD COLUMN `rarity` text DEFAULT 'common' NOT NULL
  CONSTRAINT "storage_items_rarity_valid" CHECK(`rarity` IN ('common', 'uncommon', 'rare', 'epic', 'legendary'));--> statement-breakpoint
ALTER TABLE `storage_items` ADD COLUMN `unit` text
  CONSTRAINT "storage_items_unit_valid" CHECK(`unit` IS NULL OR length(trim(`unit`)) BETWEEN 1 AND 30);--> statement-breakpoint

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
);--> statement-breakpoint

DROP TRIGGER `notification_inbox_member_joined`;--> statement-breakpoint
DROP TRIGGER `notification_inbox_announcement_published_insert`;--> statement-breakpoint
DROP TRIGGER `notification_inbox_announcement_published_update`;--> statement-breakpoint
DROP TRIGGER `notification_inbox_event_created`;--> statement-breakpoint
DROP TRIGGER `notification_inbox_wiki_article_created`;--> statement-breakpoint

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
END;--> statement-breakpoint

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
END;--> statement-breakpoint

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
END;--> statement-breakpoint

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
END;--> statement-breakpoint

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
END;--> statement-breakpoint

-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0008_content_engagement', 8, '00438adf61d6c8bca73e63cf49c10729c667aa8b76c75d3f931f1a5ba8fd04f4');
