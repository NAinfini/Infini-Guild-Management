import { ANNOUNCEMENT_STATUSES } from "@guild/shared/constants/announcements";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    bodyJson: text("body_json").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ANNOUNCEMENT_STATUSES }).notNull().default("draft"),
    publishAt: text("publish_at"),
    expiresAt: text("expires_at"),
    archivedAt: text("archived_at"),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    revisionToken: text("revision_token").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_announcements_public").on(table.status, table.pinned, table.updatedAt, table.id, table.publishAt, table.expiresAt),
    index("idx_announcements_manage").on(table.pinned, table.updatedAt, table.id, table.archivedAt, table.status),
    index("idx_announcements_schedule").on(table.status, table.publishAt, table.id),
    index("idx_announcements_expiry").on(table.status, table.expiresAt, table.id),
    check("announcements_title_present", sql`length(trim(${table.title})) BETWEEN 1 AND 200`),
    check("announcements_body_object", sql`json_valid(${table.bodyJson}) AND json_type(${table.bodyJson}) = 'object'`),
    check("announcements_pinned_boolean", sql`${table.pinned} IN (0, 1)`),
    check("announcements_status_valid", sql`${table.status} IN ('draft', 'scheduled', 'published', 'archived')`),
    check(
      "announcements_state_consistent",
      sql`(${table.status} = 'draft' AND ${table.archivedAt} IS NULL)
        OR (${table.status} = 'scheduled' AND ${table.publishAt} IS NOT NULL AND ${table.archivedAt} IS NULL)
        OR (${table.status} = 'published' AND ${table.publishAt} IS NOT NULL AND ${table.archivedAt} IS NULL)
        OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL)`,
    ),
    check(
      "announcements_expiry_after_publish",
      sql`${table.expiresAt} IS NULL OR ${table.publishAt} IS NULL OR ${table.expiresAt} > ${table.publishAt}`,
    ),
    check("announcements_revision_present", sql`length(${table.revisionToken}) >= 16`),
  ],
);
