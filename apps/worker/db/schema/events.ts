// Domain: Events, Signups & Recurring Templates
// Tables: events, recurring_templates, event_class_quotas, recurring_template_class_quotas, event_participants, event_polls, event_poll_options, event_poll_votes, event_raffle_winners
// Dependencies: auth.users, class-catalog.class_catalog
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { activeGame } from "@guild/shared/games";
import { users } from "./auth";
import { classCatalog } from "./class-catalog";
import { nowUtc } from "./shared";

const EVENT_TYPE_IDS = activeGame.eventTypes.map((e) => e.id) as [string, ...string[]];

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: EVENT_TYPE_IDS }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startAt: text("start_at").notNull(),
    endAt: text("end_at"),
    capacity: integer("capacity"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    signupLocked: integer("signup_locked", { mode: "boolean" }).notNull().default(false),
    visibleAt: text("visible_at"),
    archivedAt: text("archived_at"),
    autoArchive: integer("auto_archive", { mode: "boolean" }).notNull().default(false),
    autoArchived: integer("auto_archived", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").notNull().references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
    attachments: text("attachments").notNull().default("[]"),
    seriesId: text("series_id"),
    instanceDate: text("instance_date"),
    winnerCount: integer("winner_count"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxArchivedStart: index("idx_events_archived_start").on(table.archivedAt, table.startAt, table.id),
    idxAutoArchiveDue: index("idx_events_auto_archive_due").on(table.autoArchive, table.autoArchived, table.archivedAt, table.endAt, table.startAt),
    uxSeriesInstance: uniqueIndex("ux_events_series_instance").on(table.seriesId, table.instanceDate),
    idxCreatedBy: index("idx_events_created_by").on(table.createdBy),
  }),
);

export const recurringTemplates = sqliteTable(
  "recurring_templates",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: EVENT_TYPE_IDS }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // UTC wall-clock "HH:mm"; the portal converts local↔UTC. The DB also has a
    // legacy timezone_offset_minutes column (unused, kept for prod parity).
    startTime: text("start_time").notNull(),
    durationMinutes: integer("duration_minutes"),
    capacity: integer("capacity"),
    recurrenceRule: text("recurrence_rule").notNull(),
    visibilityOffsetMinutes: integer("visibility_offset_minutes").notNull().default(0),
    autoArchive: integer("auto_archive", { mode: "boolean" }).notNull().default(false),
    attachments: text("attachments").notNull().default("[]"),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").notNull().references(() => users.id),
    lastGeneratedDate: text("last_generated_date"),
    generationCount: integer("generation_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxActive: index("idx_recurring_templates_active").on(table.paused, table.createdAt, table.id),
  }),
);

/*
 * 每个活动／模板需要几个某职业。存成两张关联表而不是活动行上的一列 JSON：职业目录
 * 是可以删条目的，JSON 里的 id 删完就成了悬空引用，而外键能让它跟着一起走。
 * required 只是筹划期的信号，报名不受它限制——硬上限只有 events.capacity。
 */
export const eventClassQuotas = sqliteTable(
  "event_class_quotas",
  {
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    classId: text("class_id").notNull().references(() => classCatalog.id, { onDelete: "cascade" }),
    required: integer("required").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.classId] }),
    index("idx_event_class_quotas_class").on(table.classId),
    check("event_class_quotas_required_positive", sql`${table.required} > 0`),
  ],
);

export const recurringTemplateClassQuotas = sqliteTable(
  "recurring_template_class_quotas",
  {
    templateId: text("template_id").notNull().references(() => recurringTemplates.id, { onDelete: "cascade" }),
    classId: text("class_id").notNull().references(() => classCatalog.id, { onDelete: "cascade" }),
    required: integer("required").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.templateId, table.classId] }),
    index("idx_recurring_template_class_quotas_class").on(table.classId),
    check("recurring_template_class_quotas_required_positive", sql`${table.required} > 0`),
  ],
);

export const eventParticipants = sqliteTable(
  "event_participants",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    joinedAt: text("joined_at").notNull().default(nowUtc),
  },
  (table) => ({
    uxEventUser: uniqueIndex("ux_event_participants_event_user").on(table.eventId, table.userId),
    idxEventJoined: index("idx_event_participants_event_joined").on(table.eventId, table.joinedAt, table.id),
    idxUserEvent: index("idx_event_participants_user_event").on(table.userId, table.eventId),
  }),
);

export const eventPolls = sqliteTable(
  "event_polls",
  {
    eventId: text("event_id").primaryKey().references(() => events.id, { onDelete: "cascade" }),
    resultsVisibility: text("results_visibility", { enum: ["always", "after_vote", "after_close"] }).notNull().default("after_vote"),
    showVoterNames: integer("show_voter_names", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
);

export const eventPollOptions = sqliteTable(
  "event_poll_options",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxEventSort: index("idx_event_poll_options_event_sort").on(table.eventId, table.sortOrder, table.id),
  }),
);

export const eventPollVotes = sqliteTable(
  "event_poll_votes",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    optionId: text("option_id").notNull().references(() => eventPollOptions.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    uxEventOptionUser: uniqueIndex("ux_event_poll_votes_event_option_user").on(table.eventId, table.optionId, table.userId),
    idxEventUser: index("idx_event_poll_votes_event_user").on(table.eventId, table.userId),
    idxOption: index("idx_event_poll_votes_option").on(table.optionId),
  }),
);

export const eventRaffleWinners = sqliteTable(
  "event_raffle_winners",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    drawnAt: text("drawn_at").notNull().default(nowUtc),
  },
  (table) => ({
    uxEventUser: uniqueIndex("ux_event_raffle_winners_event_user").on(table.eventId, table.userId),
    idxEvent: index("idx_event_raffle_winners_event").on(table.eventId),
  }),
);
