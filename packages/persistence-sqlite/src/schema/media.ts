import { MEDIA_ENTITY_TYPES, MEDIA_PURPOSES, MEDIA_SLOTS, MEDIA_TYPES, MEDIA_VARIANTS } from "@guild/shared";
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const values = (items: readonly string[]) => sql.raw(items.map((item) => `'${item}'`).join(", "));

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    purpose: text("purpose", { enum: MEDIA_PURPOSES }).notNull(),
    mediaType: text("media_type", { enum: MEDIA_TYPES }).notNull(),
    state: text("state", { enum: ["uploading", "staged", "attached", "deleting"] }).notNull(),
    originalName: text("original_name"),
    expiresAt: text("expires_at"),
    deleteClaimToken: text("delete_claim_token"),
    deleteClaimUntil: text("delete_claim_until"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_media_assets_gc").on(table.state, table.expiresAt, table.deleteClaimUntil, table.id),
    index("idx_media_assets_owner_purpose_state").on(table.ownerUserId, table.purpose, table.state, table.id),
    index("idx_media_assets_delete_claim")
      .on(table.deleteClaimToken)
      .where(sql`${table.deleteClaimToken} IS NOT NULL`),
    check("media_assets_id_nanoid", sql`length(${table.id}) = 21 AND ${table.id} NOT GLOB '*[^A-Za-z0-9_-]*'`),
    check("media_assets_purpose_valid", sql`${table.purpose} IN (${values(MEDIA_PURPOSES)})`),
    check("media_assets_type_valid", sql`${table.mediaType} IN (${values(MEDIA_TYPES)})`),
    check("media_assets_state_valid", sql`${table.state} IN ('uploading', 'staged', 'attached', 'deleting')`),
    check(
      "media_assets_purpose_type_consistent",
      sql`(${table.purpose} = 'member_audio' AND ${table.mediaType} = 'audio') OR (${table.purpose} <> 'member_audio' AND ${table.mediaType} = 'image')`,
    ),
    check(
      "media_assets_name_consistent",
      sql`(${table.mediaType} = 'audio' AND length(trim(${table.originalName})) BETWEEN 1 AND 255) OR (${table.mediaType} = 'image' AND ${table.originalName} IS NULL)`,
    ),
    check(
      "media_assets_expiry_consistent",
      sql`(${table.state} IN ('uploading', 'staged') AND ${table.expiresAt} IS NOT NULL) OR (${table.state} IN ('attached', 'deleting'))`,
    ),
    check(
      "media_assets_claim_consistent",
      sql`(${table.deleteClaimToken} IS NULL AND ${table.deleteClaimUntil} IS NULL) OR (${table.state} = 'deleting' AND ${table.deleteClaimToken} IS NOT NULL AND ${table.deleteClaimUntil} IS NOT NULL)`,
    ),
  ],
);

export const mediaVariants = sqliteTable(
  "media_variants",
  {
    mediaId: text("media_id").notNull().references(() => mediaAssets.id, { onDelete: "cascade" }),
    variant: text("variant", { enum: MEDIA_VARIANTS }).notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width"),
    height: integer("height"),
  },
  (table) => [
    uniqueIndex("ux_media_variants_identity").on(table.mediaId, table.variant),
    uniqueIndex("ux_media_variants_object_key").on(table.objectKey),
    check("media_variants_variant_valid", sql`${table.variant} IN (${values(MEDIA_VARIANTS)})`),
    check("media_variants_size_positive", sql`${table.byteSize} > 0`),
    check("media_variants_sha256_valid", sql`length(${table.sha256}) = 64 AND ${table.sha256} NOT GLOB '*[^0-9a-f]*'`),
    check(
      "media_variants_dimensions_consistent",
      sql`(${table.contentType} = 'image/webp' AND ${table.width} > 0 AND ${table.height} > 0) OR (${table.contentType} = 'audio/ogg' AND ${table.width} IS NULL AND ${table.height} IS NULL)`,
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
    audience: text("audience", { enum: ["public", "authenticated", "private"] }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    attachedAt: text("attached_at").notNull().default(nowUtc),
  },
  (table) => [
    primaryKey({
      name: "pk_media_links_target_asset",
      columns: [table.entityType, table.entityId, table.slot, table.mediaId],
    }),
    uniqueIndex("ux_media_links_target_order").on(table.entityType, table.entityId, table.slot, table.sortOrder),
    index("idx_media_links_asset").on(table.mediaId),
    check("media_links_entity_valid", sql`${table.entityType} IN (${values(MEDIA_ENTITY_TYPES)})`),
    check("media_links_slot_valid", sql`${table.slot} IN (${values(MEDIA_SLOTS)})`),
    check("media_links_audience_valid", sql`${table.audience} IN ('public', 'authenticated', 'private')`),
    check("media_links_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);
