// Domain: Member Badges
// Tables: member_badges, member_badge_assignments
// Dependencies: auth.users
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const memberBadges = sqliteTable(
  "member_badges",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    labelHtml: text("label_html").notNull(),
    color: text("color").notNull().default("#3b82f6"),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxSort: index("idx_member_badges_sort").on(table.sortOrder, table.id),
  }),
);

export const memberBadgeAssignments = sqliteTable(
  "member_badge_assignments",
  {
    badgeId: text("badge_id").notNull().references(() => memberBadges.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    assignedBy: text("assigned_by").notNull().references(() => users.id),
    assignedAt: text("assigned_at").notNull().default(nowUtc),
  },
  (table) => ({
    uxBadgeUser: uniqueIndex("ux_member_badge_assignments_badge_user").on(table.badgeId, table.userId),
    idxUser: index("idx_member_badge_assignments_user").on(table.userId),
  }),
);
