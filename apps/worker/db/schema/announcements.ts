// Domain: Announcements
// Tables: announcements
// Dependencies: auth.users
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    bodyJson: text("body_json").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    pinnedAt: text("pinned_at"),
    status: text("status", { enum: ["draft", "scheduled", "published", "archived"] }).notNull().default("draft"),
    publishAt: text("publish_at"),
    expiresAt: text("expires_at"),
    archivedAt: text("archived_at"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxFeed: index("idx_announcements_feed").on(
      table.archivedAt,
      table.pinned,
      table.pinnedAt,
      table.createdAt,
      table.id,
    ),
    idxSchedule: index("idx_announcements_schedule").on(table.status, table.publishAt, table.expiresAt),
  }),
);
