import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { EVENT_TYPES } from "@guild/shared/constants/event-types";
import type { EventType } from "@guild/shared/constants/event-types";
import { LIMITS } from "@guild/shared/config/limits";
import { classTags } from "./members";
import { users } from "./auth";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const eventTypeIds = [...EVENT_TYPES] as [EventType, ...EventType[]];
const maxEventParticipants = sql.raw(String(LIMITS.content.eventParticipantsPerEvent.max));

export const recurringTemplates = sqliteTable(
  "recurring_templates",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: eventTypeIds }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startTime: text("start_time").notNull(),
    durationMinutes: integer("duration_minutes"),
    capacity: integer("capacity"),
    recurrenceFrequency: text("recurrence_frequency", {
      enum: ["daily", "weekly", "monthly"],
    }).notNull(),
    recurrenceInterval: integer("recurrence_interval").notNull(),
    recurrenceDayOfMonth: integer("recurrence_day_of_month"),
    recurrenceEndAfter: integer("recurrence_end_after"),
    recurrenceEndAt: text("recurrence_end_at"),
    visibilityOffsetMinutes: integer("visibility_offset_minutes").notNull().default(0),
    autoArchive: integer("auto_archive", { mode: "boolean" }).notNull().default(false),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    lastGeneratedDate: text("last_generated_date"),
    generationCount: integer("generation_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_recurring_templates_active").on(table.paused, table.id),
    index("idx_recurring_templates_created_by").on(table.createdBy, table.createdAt),
    check("recurring_templates_type_valid", sql`${table.type} IN ('weekly_mission', 'guild_war', 'social', 'poll', 'raffle', 'other')`),
    check("recurring_templates_capacity_bounded", sql`${table.capacity} IS NULL OR ${table.capacity} BETWEEN 1 AND ${maxEventParticipants}`),
    check("recurring_templates_duration_nonnegative", sql`${table.durationMinutes} IS NULL OR ${table.durationMinutes} >= 0`),
    check("recurring_templates_visibility_offset_nonnegative", sql`${table.visibilityOffsetMinutes} >= 0`),
    check("recurring_templates_generation_count_nonnegative", sql`${table.generationCount} >= 0`),
    check("recurring_templates_boolean_flags", sql`${table.autoArchive} IN (0, 1) AND ${table.paused} IN (0, 1)`),
    check(
      "recurring_templates_start_time_valid",
      sql`length(${table.startTime}) = 5
        AND ${table.startTime} GLOB '[0-9][0-9]:[0-9][0-9]'
        AND CAST(substr(${table.startTime}, 1, 2) AS INTEGER) BETWEEN 0 AND 23
        AND CAST(substr(${table.startTime}, 4, 2) AS INTEGER) BETWEEN 0 AND 59`,
    ),
    check(
      "recurring_templates_rule_valid",
      sql`${table.recurrenceInterval} > 0
        AND (
          (${table.recurrenceFrequency} IN ('daily', 'weekly') AND ${table.recurrenceDayOfMonth} IS NULL)
          OR (${table.recurrenceFrequency} = 'monthly' AND ${table.recurrenceDayOfMonth} BETWEEN 1 AND 31)
        )`,
    ),
    check(
      "recurring_templates_end_valid",
      sql`(${table.recurrenceEndAfter} IS NULL OR ${table.recurrenceEndAfter} > 0)
        AND NOT (${table.recurrenceEndAfter} IS NOT NULL AND ${table.recurrenceEndAt} IS NOT NULL)`,
    ),
  ],
);

export const recurringTemplateWeekdays = sqliteTable(
  "recurring_template_weekdays",
  {
    templateId: text("template_id").notNull().references(() => recurringTemplates.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.templateId, table.weekday] }),
    index("idx_recurring_template_weekdays_weekday").on(table.weekday, table.templateId),
    check("recurring_template_weekdays_valid", sql`${table.weekday} BETWEEN 0 AND 6`),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: eventTypeIds }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startAt: text("start_at").notNull(),
    endAt: text("end_at"),
    capacity: integer("capacity"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    signupLocked: integer("signup_locked", { mode: "boolean" }).notNull().default(false),
    autoArchive: integer("auto_archive", { mode: "boolean" }).notNull().default(false),
    autoArchived: integer("auto_archived", { mode: "boolean" }).notNull().default(false),
    visibleAt: text("visible_at"),
    archivedAt: text("archived_at"),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "restrict" }),
    seriesId: text("series_id").references(() => recurringTemplates.id, { onDelete: "set null" }),
    instanceDate: text("instance_date"),
    winnerCount: integer("winner_count"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_events_public_start").on(table.archivedAt, table.visibleAt, table.startAt, table.id),
    index("idx_events_list_start").on(table.startAt, table.id),
    index("idx_events_type_start").on(table.type, table.startAt, table.id),
    index("idx_events_pinned_start").on(table.pinned, table.startAt, table.id),
    index("idx_events_locked_start").on(table.signupLocked, table.startAt, table.id),
    index("idx_events_auto_archive_end_due").on(table.autoArchive, table.autoArchived, table.archivedAt, table.endAt, table.id),
    index("idx_events_auto_archive_start_due").on(table.autoArchive, table.autoArchived, table.archivedAt, table.endAt, table.startAt, table.id),
    index("idx_events_raffle_due").on(table.type, table.archivedAt, table.endAt, table.id),
    uniqueIndex("ux_events_series_instance").on(table.seriesId, table.instanceDate),
    check("events_type_valid", sql`${table.type} IN ('weekly_mission', 'guild_war', 'social', 'poll', 'raffle', 'other')`),
    check("events_capacity_bounded", sql`${table.capacity} IS NULL OR ${table.capacity} BETWEEN 1 AND ${maxEventParticipants}`),
    check("events_winner_count_bounded", sql`${table.winnerCount} IS NULL OR ${table.winnerCount} BETWEEN 1 AND ${maxEventParticipants}`),
    check("events_end_after_start", sql`${table.endAt} IS NULL OR ${table.endAt} > ${table.startAt}`),
    check("events_flags_valid", sql`${table.pinned} IN (0, 1) AND ${table.signupLocked} IN (0, 1) AND ${table.autoArchive} IN (0, 1) AND ${table.autoArchived} IN (0, 1)`),
    check(
      "events_series_instance_pair",
      sql`(${table.seriesId} IS NULL AND ${table.instanceDate} IS NULL)
        OR (${table.seriesId} IS NOT NULL AND ${table.instanceDate} IS NOT NULL)`,
    ),
    check(
      "events_behavior_columns",
      sql`(${table.type} = 'poll' AND ${table.endAt} IS NOT NULL AND ${table.capacity} IS NULL AND ${table.winnerCount} IS NULL)
        OR (${table.type} = 'raffle' AND ${table.endAt} IS NOT NULL AND ${table.winnerCount} > 0)
        OR (${table.type} NOT IN ('poll', 'raffle') AND ${table.winnerCount} IS NULL)`,
    ),
  ],
);

export const eventClassQuotas = sqliteTable(
  "event_class_quotas",
  {
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => classTags.id, { onDelete: "cascade" }),
    required: integer("required").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.tagId] }),
    index("idx_event_class_quotas_tag").on(table.tagId, table.eventId),
    check("event_class_quotas_required_positive", sql`${table.required} > 0`),
  ],
);

export const recurringTemplateClassQuotas = sqliteTable(
  "recurring_template_class_quotas",
  {
    templateId: text("template_id").notNull().references(() => recurringTemplates.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => classTags.id, { onDelete: "cascade" }),
    required: integer("required").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.templateId, table.tagId] }),
    index("idx_recurring_template_class_quotas_tag").on(table.tagId, table.templateId),
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
  (table) => [
    uniqueIndex("ux_event_participants_event_user").on(table.eventId, table.userId),
    index("idx_event_participants_event_joined").on(table.eventId, table.joinedAt, table.id),
    index("idx_event_participants_user_event").on(table.userId, table.eventId),
  ],
);

export const eventPolls = sqliteTable(
  "event_polls",
  {
    eventId: text("event_id").primaryKey().references(() => events.id, { onDelete: "cascade" }),
    resultsVisibility: text("results_visibility", {
      enum: ["always", "after_vote", "after_close"],
    }).notNull().default("after_vote"),
    showVoterNames: integer("show_voter_names", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    check("event_polls_visibility_valid", sql`${table.resultsVisibility} IN ('always', 'after_vote', 'after_close')`),
    check("event_polls_show_voters_valid", sql`${table.showVoterNames} IN (0, 1)`),
  ],
);

export const eventPollOptions = sqliteTable(
  "event_poll_options",
  {
    id: text("id").notNull(),
    eventId: text("event_id").notNull().references(() => eventPolls.eventId, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    uniqueIndex("ux_event_poll_options_event_sort").on(table.eventId, table.sortOrder),
    check("event_poll_options_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const eventPollVotes = sqliteTable(
  "event_poll_votes",
  {
    eventId: text("event_id").notNull(),
    optionId: text("option_id").notNull(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.optionId, table.userId] }),
    foreignKey({
      columns: [table.eventId, table.optionId],
      foreignColumns: [eventPollOptions.eventId, eventPollOptions.id],
      name: "fk_event_poll_votes_option",
    }).onDelete("cascade"),
    index("idx_event_poll_votes_event_user").on(table.eventId, table.userId, table.optionId),
    index("idx_event_poll_votes_user").on(table.userId, table.eventId),
  ],
);

export const eventRaffleDraws = sqliteTable(
  "event_raffle_draws",
  {
    eventId: text("event_id").primaryKey().references(() => events.id, { onDelete: "cascade" }),
    winnerCount: integer("winner_count").notNull(),
    drawnBy: text("drawn_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    drawnAt: text("drawn_at").notNull().default(nowUtc),
    mutationToken: text("mutation_token").notNull().unique(),
  },
  (table) => [
    index("idx_event_raffle_draws_drawn").on(table.drawnAt, table.eventId),
    check("event_raffle_draws_winner_count_positive", sql`${table.winnerCount} > 0`),
  ],
);

export const eventRaffleWinners = sqliteTable(
  "event_raffle_winners",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => eventRaffleDraws.eventId, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    drawnAt: text("drawn_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_event_raffle_winners_event_user").on(table.eventId, table.userId),
    index("idx_event_raffle_winners_event").on(table.eventId, table.drawnAt, table.id),
    index("idx_event_raffle_winners_user").on(table.userId, table.eventId),
  ],
);
