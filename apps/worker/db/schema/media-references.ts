// Domain: Media reference counting
// Tables: media_references — one row per (R2 key, referencing entity) pair.
// Maintained by write paths via services/media-references.ts; consumed by the
// media-orphan-cleanup cron to delete unreferenced R2 objects without scanning
// content tables.
import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
