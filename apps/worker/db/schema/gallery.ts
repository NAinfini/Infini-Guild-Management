// Domain: Gallery
// Tables: gallery_items, gallery_likes, gallery_comments
// Dependencies: auth.users
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const galleryItems = sqliteTable(
  "gallery_items",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["image", "video"] }).notNull(),
    url: text("url").notNull(),
    caption: text("caption"),
    uploadedBy: text("uploaded_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxCreated: index("idx_gallery_items_created").on(table.createdAt, table.id),
    idxUploadedBy: index("idx_gallery_items_uploaded_by").on(table.uploadedBy, table.createdAt, table.id),
    idxTypeCreated: index("idx_gallery_items_type_created").on(table.type, table.createdAt, table.id),
  }),
);

export const galleryLikes = sqliteTable(
  "gallery_likes",
  {
    id: text("id").primaryKey(),
    galleryItemId: text("gallery_item_id").notNull().references(() => galleryItems.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    uxItemUser: uniqueIndex("ux_gallery_likes_item_user").on(table.galleryItemId, table.userId),
  }),
);

export const galleryComments = sqliteTable(
  "gallery_comments",
  {
    id: text("id").primaryKey(),
    galleryItemId: text("gallery_item_id").notNull().references(() => galleryItems.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxItemCreated: index("idx_gallery_comments_item_created").on(table.galleryItemId, table.createdAt, table.id),
    idxUserId: index("idx_gallery_comments_user_id").on(table.userId),
  }),
);
