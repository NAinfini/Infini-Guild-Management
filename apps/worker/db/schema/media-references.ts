// Domain: Media reference counting
// Tables: media_references, media_reference_backfills, media_upload_leases.
// Maintained by write paths via services/media-references.ts; consumed by the
// media-orphan-cleanup cron to delete unreferenced R2 objects without scanning
// content tables.
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const mediaReferences = sqliteTable(
  "media_references",
  {
    mediaKey: text("media_key").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.mediaKey, table.entityType, table.entityId] }),
    idxKey: index("idx_media_references_key").on(table.mediaKey),
    idxEntity: index("idx_media_references_entity").on(table.entityType, table.entityId),
  }),
);

/** Versioned, per-domain commit markers for resumable reference backfills. */
export const mediaReferenceBackfills = sqliteTable("media_reference_backfills", {
  domain: text("domain").primaryKey(),
  version: integer("version").notNull(),
  completedAt: text("completed_at").notNull().default(nowUtc),
});

/** Short-lived ownership proof for R2 uploads that are not content references yet. */
export const mediaUploadLeases = sqliteTable(
  "media_upload_leases",
  {
    mediaKey: text("media_key").primaryKey(),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxExpiry: index("idx_media_upload_leases_expiry").on(table.expiresAt, table.mediaKey),
  }),
);
