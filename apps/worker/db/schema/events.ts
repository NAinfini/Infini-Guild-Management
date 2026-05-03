// Domain: Events & Signups
// Tables: events, event_participants
// Dependencies: auth.users
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["weekly_mission", "guild_war", "social", "other"] }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startAt: text("start_at").notNull(),
    endAt: text("end_at"),
    capacity: integer("capacity"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    signupLocked: integer("signup_locked", { mode: "boolean" }).notNull().default(false),
    visibleAt: text("visible_at"),
    archivedAt: text("archived_at"),
    createdBy: text("created_by").notNull().references(() => users.id),
    recurrenceRule: text("recurrence_rule"),
    attachments: text("attachments").notNull().default("[]"),
    seriesId: text("series_id"),
    isSeriesParent: integer("is_series_parent", { mode: "boolean" }).notNull().default(false),
    instanceDate: text("instance_date"),
    lastGeneratedDate: text("last_generated_date"),
    generationCount: integer("generation_count").notNull().default(0),
    visibilityOffsetMinutes: integer("visibility_offset_minutes"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxSeriesParentArchived: index("idx_events_series_parent_archived").on(table.isSeriesParent, table.archivedAt, table.startAt, table.id),
    idxSeriesInstance: index("idx_events_series_instance").on(table.seriesId, table.instanceDate),
    idxCreatedBy: index("idx_events_created_by").on(table.createdBy),
  }),
);

export const eventParticipants = sqliteTable(
  "event_participants",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    joinedAt: text("joined_at").notNull().default(nowUtc),
  },
  (table) => ({
    uxEventUser: uniqueIndex("ux_event_participants_event_user").on(table.eventId, table.userId),
    idxEventJoined: index("idx_event_participants_event_joined").on(table.eventId, table.joinedAt, table.id),
    idxUserEvent: index("idx_event_participants_user_event").on(table.userId, table.eventId),
  }),
);
