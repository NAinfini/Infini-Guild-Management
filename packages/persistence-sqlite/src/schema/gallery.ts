import { sql } from "drizzle-orm";
import { check, index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const galleryItems = sqliteTable(
  "gallery_items",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["image", "video"] }).notNull(),
    url: text("url"),
    description: text("caption"),
    uploadedBy: text("uploaded_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    revisionToken: text("revision_token").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    title: text("title").notNull().default("Untitled"),
  },
  (table) => [
    index("idx_gallery_items_created").on(table.createdAt, table.id),
    index("idx_gallery_items_type_created").on(table.type, table.createdAt, table.id),
    index("idx_gallery_items_owner_created").on(table.uploadedBy, table.type, table.createdAt, table.id),
    check("gallery_items_type_valid", sql`${table.type} IN ('image', 'video')`),
    check(
      "gallery_items_source_consistent",
      sql`(${table.type} = 'image' AND ${table.url} IS NULL) OR (${table.type} = 'video' AND ${table.url} IS NOT NULL)`,
    ),
    check("gallery_items_title_bounded", sql`length(trim(${table.title})) BETWEEN 1 AND 100`),
    check("gallery_items_caption_bounded", sql`${table.description} IS NULL OR length(${table.description}) <= 200`),
    check("gallery_items_revision_present", sql`length(${table.revisionToken}) >= 16`),
  ],
);

export const galleryLikes = sqliteTable(
  "gallery_likes",
  {
    itemId: text("item_id").notNull().references(() => galleryItems.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.userId] }),
    index("idx_gallery_likes_user_created").on(table.userId, table.createdAt, table.itemId),
  ],
);
