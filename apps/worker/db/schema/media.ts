// Domain: Media and R2 objects
// Tables: media_assets, media_variants, media_links
// Dependencies: auth.users
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { MEDIA_ENTITY_TYPES, MEDIA_PURPOSES, MEDIA_SLOTS, MEDIA_VARIANTS } from "@guild/shared/constants/media";
import { users } from "./auth";
import { canonicalUtcDateTime, nowUtc } from "./shared";

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    purpose: text("purpose", { enum: MEDIA_PURPOSES }).notNull(),
    originalName: text("original_name"),
    mediaType: text("media_type", { enum: ["image", "audio"] }).notNull(),
    state: text("state", { enum: ["pending", "ready"] }).notNull().default("pending"),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_media_assets_expiry")
      .on(table.expiresAt, table.id)
      .where(sql`${table.expiresAt} IS NOT NULL`),
    index("idx_media_assets_owner_purpose_state_expiry")
      .on(table.ownerUserId, table.purpose, table.state, table.expiresAt, table.id),
    check(
      "media_assets_id_nanoid",
      sql`length(${table.id}) = 21 AND ${table.id} NOT GLOB '*[^A-Za-z0-9_-]*'`,
    ),
    check(
      "media_assets_purpose_valid",
      sql`${table.purpose} IN ('member_avatar', 'member_image', 'member_audio', 'gallery_image', 'event_image', 'announcement_image', 'wiki_image', 'storage_image', 'class_icon', 'site_logo')`,
    ),
    check("media_assets_media_type_valid", sql`${table.mediaType} IN ('image', 'audio')`),
    check("media_assets_state_valid", sql`${table.state} IN ('pending', 'ready')`),
    check(
      "media_assets_purpose_type_consistent",
      sql`(${table.purpose} = 'member_audio' AND ${table.mediaType} = 'audio') OR (${table.purpose} <> 'member_audio' AND ${table.mediaType} = 'image')`,
    ),
    check(
      "media_assets_pending_expiry_required",
      sql`${table.state} <> 'pending' OR ${table.expiresAt} IS NOT NULL`,
    ),
    check(
      "media_assets_expires_at_valid",
      sql`${table.expiresAt} IS NULL OR (${canonicalUtcDateTime(table.expiresAt)})`,
    ),
    check(
      "media_assets_original_name_contract",
      sql`(${table.mediaType} = 'image' AND ${table.originalName} IS NULL) OR (${table.mediaType} = 'audio' AND ${table.originalName} IS NOT NULL AND length(trim(${table.originalName})) BETWEEN 1 AND 255)`,
    ),
  ],
);

export const mediaVariants = sqliteTable(
  "media_variants",
  {
    mediaId: text("media_id").notNull().references(() => mediaAssets.id, { onDelete: "cascade" }),
    variant: text("variant", { enum: MEDIA_VARIANTS }).notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
  },
  (table) => [
    primaryKey({ columns: [table.mediaId, table.variant] }),
    check("media_variants_variant_valid", sql`${table.variant} IN ('full', 'view')`),
    check("media_variants_byte_size_positive", sql`${table.byteSize} > 0`),
    check(
      "media_variants_dimensions_consistent",
      sql`(${table.width} IS NULL AND ${table.height} IS NULL)
        OR (${table.width} IS NOT NULL AND ${table.height} IS NOT NULL AND ${table.width} > 0 AND ${table.height} > 0)`,
    ),
  ],
);

export const mediaLinks = sqliteTable(
  "media_links",
  {
    mediaId: text("media_id").notNull().references(() => mediaAssets.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: MEDIA_ENTITY_TYPES }).notNull(),
    entityId: text("entity_id").notNull(),
    slot: text("slot", { enum: MEDIA_SLOTS }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.mediaId, table.entityType, table.entityId, table.slot] }),
    uniqueIndex("ux_media_links_entity_slot_sort").on(
      table.entityType,
      table.entityId,
      table.slot,
      table.sortOrder,
    ),
    check(
      "media_links_entity_type_valid",
      sql`${table.entityType} IN ('member_profile', 'gallery_item', 'event', 'recurring_template', 'announcement', 'wiki_article', 'storage_item', 'class_catalog', 'site_config')`,
    ),
    check(
      "media_links_slot_valid",
      sql`${table.slot} IN ('avatar', 'image', 'audio', 'attachment', 'body', 'icon', 'logo')`,
    ),
    check("media_links_sort_nonnegative", sql`${table.sortOrder} >= 0`),
    check(
      "media_links_entity_slot_consistent",
      sql`(
        (${table.entityType} = 'member_profile' AND ${table.slot} IN ('avatar', 'image', 'audio')) OR
        (${table.entityType} = 'gallery_item' AND ${table.slot} = 'image') OR
        (${table.entityType} IN ('event', 'recurring_template') AND ${table.slot} = 'attachment') OR
        (${table.entityType} IN ('announcement', 'wiki_article') AND ${table.slot} = 'body') OR
        (${table.entityType} = 'storage_item' AND ${table.slot} = 'image') OR
        (${table.entityType} = 'class_catalog' AND ${table.slot} = 'icon') OR
        (${table.entityType} = 'site_config' AND ${table.slot} = 'logo')
      )`,
    ),
    check(
      "media_links_singular_sort_zero",
      sql`${table.slot} NOT IN ('avatar', 'audio', 'icon', 'logo') OR ${table.sortOrder} = 0`,
    ),
    check(
      "media_links_gallery_sort_zero",
      sql`${table.entityType} <> 'gallery_item' OR ${table.sortOrder} = 0`,
    ),
  ],
);
