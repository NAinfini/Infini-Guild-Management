// Domain: Gallery
// Tables: gallery_items
// Dependencies: auth.users
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
