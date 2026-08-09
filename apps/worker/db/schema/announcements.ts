// Domain: Announcements
// Tables: announcements
// Dependencies: auth.users
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { canonicalUtcDateTime, nowUtc } from "./shared";

export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    bodyJson: text("body_json").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["draft", "scheduled", "published", "archived"] }).notNull().default("draft"),
    publishAt: text("publish_at"),
    expiresAt: text("expires_at"),
    archivedAt: text("archived_at"),
    createdBy: text("created_by").notNull().references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_announcements_status_pinned_created").on(
      table.status,
      table.pinned,
      table.createdAt,
      table.id,
    ),
    index("idx_announcements_schedule").on(table.status, table.publishAt),
    index("idx_announcements_expiry").on(table.status, table.expiresAt),
    index("idx_announcements_created_by").on(table.createdBy),
    index("idx_announcements_updated_by").on(table.updatedBy),
    check("announcements_status_valid", sql`${table.status} IN ('draft', 'scheduled', 'published', 'archived')`),
    check("announcements_pinned_boolean", sql`${table.pinned} IN (0, 1)`),
    check(
      "announcements_times_valid",
      sql`(${table.publishAt} IS NULL OR (${canonicalUtcDateTime(table.publishAt)})) AND (${table.expiresAt} IS NULL OR (${canonicalUtcDateTime(table.expiresAt)})) AND (${table.archivedAt} IS NULL OR (${canonicalUtcDateTime(table.archivedAt)}))`,
    ),
    check("announcements_body_json_object", sql`json_valid(${table.bodyJson}) AND json_type(${table.bodyJson}) = 'object'`),
  ],
);
