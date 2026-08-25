-- Rebuild the media foreign-key graph without disabling foreign-key enforcement.
DROP TRIGGER IF EXISTS media_links_before_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS media_links_after_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS media_links_target_immutable;--> statement-breakpoint
DROP TRIGGER IF EXISTS media_links_after_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS media_assets_identity_immutable;--> statement-breakpoint
DROP TRIGGER IF EXISTS media_variants_identity_immutable;--> statement-breakpoint
DROP TRIGGER IF EXISTS media_links_target_contract;--> statement-breakpoint
DROP TRIGGER IF EXISTS member_profiles_media_cleanup;--> statement-breakpoint
DROP TRIGGER IF EXISTS gallery_items_media_cleanup;--> statement-breakpoint
DROP TRIGGER IF EXISTS events_media_cleanup;--> statement-breakpoint
DROP TRIGGER IF EXISTS recurring_templates_media_cleanup;--> statement-breakpoint
DROP TRIGGER IF EXISTS announcements_media_cleanup;--> statement-breakpoint
DROP TRIGGER IF EXISTS wiki_articles_media_cleanup;--> statement-breakpoint
DROP TRIGGER IF EXISTS storage_items_media_cleanup;--> statement-breakpoint
DROP TRIGGER IF EXISTS class_catalog_media_cleanup;--> statement-breakpoint
DROP TRIGGER IF EXISTS wiki_revision_media_insert_valid;--> statement-breakpoint
DROP TRIGGER IF EXISTS wiki_revision_media_after_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS wiki_revision_media_update_immutable;--> statement-breakpoint
DROP TRIGGER IF EXISTS wiki_revision_media_delete_system_test_only;--> statement-breakpoint
DROP TRIGGER IF EXISTS wiki_revision_media_after_delete;--> statement-breakpoint

DROP INDEX `idx_media_assets_gc`;--> statement-breakpoint
DROP INDEX `idx_media_assets_owner_purpose_state`;--> statement-breakpoint
DROP INDEX `idx_media_assets_delete_claim`;--> statement-breakpoint
DROP INDEX `ux_media_variants_identity`;--> statement-breakpoint
DROP INDEX `ux_media_variants_object_key`;--> statement-breakpoint
DROP INDEX `ux_media_links_target_order`;--> statement-breakpoint
DROP INDEX `idx_media_links_asset`;--> statement-breakpoint
DROP INDEX `ux_wiki_revision_media_order`;--> statement-breakpoint
DROP INDEX `idx_wiki_revision_media_asset`;--> statement-breakpoint

ALTER TABLE `media_links` RENAME TO `__old_media_links`;--> statement-breakpoint
ALTER TABLE `wiki_revision_media` RENAME TO `__old_wiki_revision_media`;--> statement-breakpoint
ALTER TABLE `media_variants` RENAME TO `__old_media_variants`;--> statement-breakpoint
ALTER TABLE `media_assets` RENAME TO `__old_media_assets`;--> statement-breakpoint

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
);--> statement-breakpoint
CREATE INDEX `idx_media_assets_gc` ON `media_assets` (`state`,`expires_at`,`delete_claim_until`,`id`);--> statement-breakpoint
CREATE INDEX `idx_media_assets_owner_purpose_state` ON `media_assets` (`owner_user_id`,`purpose`,`state`,`id`);--> statement-breakpoint
CREATE INDEX `idx_media_assets_delete_claim` ON `media_assets` (`delete_claim_token`) WHERE "media_assets"."delete_claim_token" IS NOT NULL;--> statement-breakpoint
INSERT INTO `media_assets` (`id`, `owner_user_id`, `purpose`, `media_type`, `state`, `original_name`, `expires_at`, `delete_claim_token`, `delete_claim_until`, `created_at`, `updated_at`)
  SELECT `id`, `owner_user_id`, `purpose`, `media_type`, `state`, `original_name`, `expires_at`, `delete_claim_token`, `delete_claim_until`, `created_at`, `updated_at`
  FROM `__old_media_assets`;--> statement-breakpoint

CREATE TABLE `media_variants` (
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
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ) AND "media_variants"."width" IS NULL AND "media_variants"."height" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_media_variants_identity` ON `media_variants` (`media_id`,`variant`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_media_variants_object_key` ON `media_variants` (`object_key`);--> statement-breakpoint
INSERT INTO `media_variants` (`media_id`, `variant`, `object_key`, `content_type`, `byte_size`, `sha256`, `width`, `height`)
  SELECT `media_id`, `variant`, `object_key`, `content_type`, `byte_size`, `sha256`, `width`, `height`
  FROM `__old_media_variants`;--> statement-breakpoint

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
);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_media_links_target_order` ON `media_links` (`entity_type`,`entity_id`,`slot`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_media_links_asset` ON `media_links` (`media_id`);--> statement-breakpoint
INSERT INTO `media_links` (`media_id`, `entity_type`, `entity_id`, `slot`, `audience`, `sort_order`, `attached_at`)
  SELECT `media_id`, `entity_type`, `entity_id`, `slot`, `audience`, `sort_order`, `attached_at`
  FROM `__old_media_links`;--> statement-breakpoint

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
);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_wiki_revision_media_order` ON `wiki_revision_media` (`revision_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_wiki_revision_media_asset` ON `wiki_revision_media` (`media_id`,`revision_id`);--> statement-breakpoint
INSERT INTO `wiki_revision_media` (`revision_id`, `media_id`, `audience`, `sort_order`)
  SELECT `revision_id`, `media_id`, `audience`, `sort_order`
  FROM `__old_wiki_revision_media`;--> statement-breakpoint

DROP TABLE `__old_media_links`;--> statement-breakpoint
DROP TABLE `__old_wiki_revision_media`;--> statement-breakpoint
DROP TABLE `__old_media_variants`;--> statement-breakpoint
DROP TABLE `__old_media_assets`;--> statement-breakpoint

ALTER TABLE `site_config` ADD COLUMN `max_announcement_attachment_bytes` integer NOT NULL DEFAULT 10485760 CONSTRAINT "site_config_announcement_attachment_bytes_bounded" CHECK (`max_announcement_attachment_bytes` BETWEEN 1 AND 32505856);--> statement-breakpoint
ALTER TABLE `site_config` ADD COLUMN `quota_announcement_attachments` integer NOT NULL DEFAULT 5 CONSTRAINT "site_config_announcement_attachments_quota_bounded" CHECK (`quota_announcement_attachments` BETWEEN 1 AND 100);--> statement-breakpoint

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
END;--> statement-breakpoint

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
END;--> statement-breakpoint

CREATE TRIGGER media_links_target_immutable
BEFORE UPDATE OF media_id, entity_type, entity_id, slot ON media_links
WHEN OLD.media_id <> NEW.media_id
  OR OLD.entity_type <> NEW.entity_type
  OR OLD.entity_id <> NEW.entity_id
  OR OLD.slot <> NEW.slot
BEGIN
  SELECT RAISE(ABORT, 'media link target is immutable');
END;--> statement-breakpoint

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
END;--> statement-breakpoint

CREATE TRIGGER media_assets_identity_immutable
BEFORE UPDATE OF owner_user_id, purpose, media_type ON media_assets
WHEN OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.purpose <> NEW.purpose
  OR OLD.media_type <> NEW.media_type
BEGIN
  SELECT RAISE(ABORT, 'media asset identity is immutable');
END;--> statement-breakpoint

CREATE TRIGGER media_variants_identity_immutable
BEFORE UPDATE ON media_variants
BEGIN
  SELECT RAISE(ABORT, 'media variant metadata is immutable');
END;--> statement-breakpoint

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
END;--> statement-breakpoint

CREATE TRIGGER member_profiles_media_cleanup AFTER DELETE ON member_profiles
BEGIN
  DELETE FROM media_links WHERE entity_type = 'member_profile' AND entity_id = OLD.user_id;
END;--> statement-breakpoint

CREATE TRIGGER gallery_items_media_cleanup AFTER DELETE ON gallery_items
BEGIN
  DELETE FROM media_links WHERE entity_type = 'gallery_item' AND entity_id = OLD.id;
END;--> statement-breakpoint

CREATE TRIGGER events_media_cleanup AFTER DELETE ON events
BEGIN
  DELETE FROM media_links WHERE entity_type = 'event' AND entity_id = OLD.id;
END;--> statement-breakpoint

CREATE TRIGGER recurring_templates_media_cleanup AFTER DELETE ON recurring_templates
BEGIN
  DELETE FROM media_links WHERE entity_type = 'recurring_template' AND entity_id = OLD.id;
END;--> statement-breakpoint

CREATE TRIGGER announcements_media_cleanup AFTER DELETE ON announcements
BEGIN
  DELETE FROM media_links WHERE entity_type = 'announcement' AND entity_id = OLD.id;
END;--> statement-breakpoint

CREATE TRIGGER wiki_articles_media_cleanup AFTER DELETE ON wiki_articles
BEGIN
  DELETE FROM media_links WHERE entity_type = 'wiki_article' AND entity_id = OLD.id;
END;--> statement-breakpoint

CREATE TRIGGER storage_items_media_cleanup AFTER DELETE ON storage_items
BEGIN
  DELETE FROM media_links WHERE entity_type = 'storage_item' AND entity_id = OLD.id;
END;--> statement-breakpoint

CREATE TRIGGER class_catalog_media_cleanup AFTER DELETE ON class_catalog
BEGIN
  DELETE FROM media_links WHERE entity_type = 'class_catalog' AND entity_id = OLD.id;
END;--> statement-breakpoint

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
END;--> statement-breakpoint

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
END;--> statement-breakpoint

CREATE TRIGGER wiki_revision_media_update_immutable
BEFORE UPDATE ON wiki_revision_media
BEGIN
  SELECT RAISE(ABORT, 'wiki revision media is immutable');
END;--> statement-breakpoint

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
END;--> statement-breakpoint

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
END;--> statement-breakpoint

-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0007_announcement_attachments', 7, '3550da438d0fc008d7a943f221d86eae95ba9e87f7a494b8dccc4f958faa6eca');
