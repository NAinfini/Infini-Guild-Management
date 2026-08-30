DROP TRIGGER IF EXISTS media_variants_identity_immutable;--> statement-breakpoint

CREATE TABLE `__new_media_variants` (
	`media_id` text NOT NULL,
	`variant` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`width` integer,
	`height` integer,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "media_variants_variant_valid" CHECK("__new_media_variants"."variant" IN ('full', 'view')),
	CONSTRAINT "media_variants_size_positive" CHECK("__new_media_variants"."byte_size" > 0),
	CONSTRAINT "media_variants_sha256_valid" CHECK(length("__new_media_variants"."sha256") = 64 AND "__new_media_variants"."sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "media_variants_dimensions_consistent" CHECK(("__new_media_variants"."content_type" = 'image/webp' AND "__new_media_variants"."width" > 0 AND "__new_media_variants"."height" > 0)
        OR ("__new_media_variants"."content_type" IN (
          'audio/ogg',
          'application/octet-stream',
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ) AND "__new_media_variants"."width" IS NULL AND "__new_media_variants"."height" IS NULL))
);--> statement-breakpoint

INSERT INTO `__new_media_variants` (`media_id`, `variant`, `object_key`, `content_type`, `byte_size`, `sha256`, `width`, `height`)
SELECT `media_id`, `variant`, `object_key`, `content_type`, `byte_size`, `sha256`, `width`, `height`
FROM `media_variants`;--> statement-breakpoint

DROP TABLE `media_variants`;--> statement-breakpoint

ALTER TABLE `__new_media_variants` RENAME TO `media_variants`;--> statement-breakpoint

CREATE UNIQUE INDEX `ux_media_variants_identity` ON `media_variants` (`media_id`,`variant`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_media_variants_object_key` ON `media_variants` (`object_key`);--> statement-breakpoint

CREATE TRIGGER media_variants_identity_immutable
BEFORE UPDATE ON media_variants
BEGIN
  SELECT RAISE(ABORT, 'media variant metadata is immutable');
END;--> statement-breakpoint

-- app-migration-ledger
INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0012_generic_announcement_attachments', 12, '1e9ac10c32f58b9cd7d6723f9e0e46103ca4b7bd3694c926ae7ec56a6d26ab2a');
