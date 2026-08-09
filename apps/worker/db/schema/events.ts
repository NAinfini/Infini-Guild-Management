// Domain: Events, Signups & Recurring Templates
// Tables: events, recurring_templates, recurring_template_weekdays, event_class_quotas, recurring_template_class_quotas, event_participants, event_polls, event_poll_options, event_poll_votes, event_raffle_winners
// Dependencies: auth.users, class-catalog.class_tags
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { EVENT_TYPES } from "@guild/shared/constants/event-types";
import { users } from "./auth";
import { classTags } from "./class-catalog";
import { canonicalUtcDate, canonicalUtcDateTime, nowUtc } from "./shared";

const EVENT_TYPE_IDS = EVENT_TYPES as unknown as [string, ...string[]];
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
    seriesId: text("series_id").references((): AnySQLiteColumn => recurringTemplates.id),
    instanceDate: text("instance_date"),
    winnerCount: integer("winner_count"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_events_archived_start").on(table.archivedAt, table.startAt, table.id),
    index("idx_events_auto_archive_due").on(table.autoArchive, table.autoArchived, table.archivedAt, table.endAt, table.startAt),
    uniqueIndex("ux_events_series_instance").on(table.seriesId, table.instanceDate),
    index("idx_events_created_by").on(table.createdBy),
    index("idx_events_updated_by").on(table.updatedBy),
    check("events_type_valid", sql`${table.type} IN ('weekly_mission', 'guild_war', 'social', 'poll', 'raffle', 'other')`),
    check("events_capacity_positive", sql`${table.capacity} IS NULL OR ${table.capacity} > 0`),
    check("events_winner_count_positive", sql`${table.winnerCount} IS NULL OR ${table.winnerCount} > 0`),
    check(
      "events_boolean_flags_valid",
      sql`${table.pinned} IN (0, 1) AND ${table.signupLocked} IN (0, 1) AND ${table.autoArchive} IN (0, 1) AND ${table.autoArchived} IN (0, 1)`,
    ),
    check(
      "events_series_instance_pair",
      sql`(${table.seriesId} IS NULL AND ${table.instanceDate} IS NULL) OR (${table.seriesId} IS NOT NULL AND ${table.instanceDate} IS NOT NULL)`,
    ),
    check(
      "events_times_valid",
      sql`(${canonicalUtcDateTime(table.startAt)}) AND (${table.endAt} IS NULL OR ((${canonicalUtcDateTime(table.endAt)}) AND ${table.endAt} > ${table.startAt})) AND (${table.visibleAt} IS NULL OR (${canonicalUtcDateTime(table.visibleAt)})) AND (${table.archivedAt} IS NULL OR (${canonicalUtcDateTime(table.archivedAt)}))`,
    ),
    check(
      "events_instance_date_valid",
      sql`${table.instanceDate} IS NULL OR (${canonicalUtcDate(table.instanceDate)})`,
    ),
  ],
);

export const recurringTemplates = sqliteTable(
  "recurring_templates",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: EVENT_TYPE_IDS }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // UTC wall-clock "HH:mm"; the portal converts local↔UTC.
    startTime: text("start_time").notNull(),
    durationMinutes: integer("duration_minutes"),
    capacity: integer("capacity"),
    recurrenceFrequency: text("recurrence_frequency", { enum: ["daily", "weekly", "monthly"] }).notNull(),
    recurrenceInterval: integer("recurrence_interval").notNull(),
    recurrenceDayOfMonth: integer("recurrence_day_of_month"),
    recurrenceEndAfter: integer("recurrence_end_after"),
    recurrenceEndAt: text("recurrence_end_at"),
    visibilityOffsetMinutes: integer("visibility_offset_minutes").notNull().default(0),
    autoArchive: integer("auto_archive", { mode: "boolean" }).notNull().default(false),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").notNull().references(() => users.id),
    lastGeneratedDate: text("last_generated_date"),
    generationCount: integer("generation_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_recurring_templates_active").on(table.paused, table.createdAt, table.id),
    index("idx_recurring_templates_created_by").on(table.createdBy),
    check("recurring_templates_type_valid", sql`${table.type} IN ('weekly_mission', 'guild_war', 'social', 'poll', 'raffle', 'other')`),
    check("recurring_templates_capacity_positive", sql`${table.capacity} IS NULL OR ${table.capacity} > 0`),
    check(
      "recurring_templates_start_time_valid",
      sql`length(${table.startTime}) = 5 AND ${table.startTime} GLOB '[0-9][0-9]:[0-9][0-9]' AND CAST(substr(${table.startTime}, 1, 2) AS INTEGER) BETWEEN 0 AND 23 AND CAST(substr(${table.startTime}, 4, 2) AS INTEGER) BETWEEN 0 AND 59`,
    ),
    check("recurring_templates_duration_nonnegative", sql`${table.durationMinutes} IS NULL OR ${table.durationMinutes} >= 0`),
    check("recurring_templates_visibility_offset_nonnegative", sql`${table.visibilityOffsetMinutes} >= 0`),
    check("recurring_templates_generation_count_nonnegative", sql`${table.generationCount} >= 0`),
    check(
      "recurring_templates_boolean_flags_valid",
      sql`${table.autoArchive} IN (0, 1) AND ${table.paused} IN (0, 1)`,
    ),
    check(
      "recurring_templates_recurrence_valid",
      sql`${table.recurrenceFrequency} IN ('daily', 'weekly', 'monthly') AND ${table.recurrenceInterval} > 0 AND ((${table.recurrenceFrequency} IN ('daily', 'weekly') AND ${table.recurrenceDayOfMonth} IS NULL) OR (${table.recurrenceFrequency} = 'monthly' AND ${table.recurrenceDayOfMonth} IS NOT NULL AND ${table.recurrenceDayOfMonth} BETWEEN 1 AND 31))`,
    ),
    check(
      "recurring_templates_recurrence_end_valid",
      sql`(${table.recurrenceEndAfter} IS NULL OR ${table.recurrenceEndAfter} > 0) AND (${table.recurrenceEndAt} IS NULL OR (${canonicalUtcDateTime(table.recurrenceEndAt)})) AND NOT (${table.recurrenceEndAfter} IS NOT NULL AND ${table.recurrenceEndAt} IS NOT NULL)`,
    ),
    check(
      "recurring_templates_last_generated_date_valid",
      sql`${table.lastGeneratedDate} IS NULL OR (${canonicalUtcDate(table.lastGeneratedDate)})`,
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
    index("idx_recurring_template_weekdays_weekday_template").on(table.weekday, table.templateId),
    check("recurring_template_weekdays_weekday_valid", sql`${table.weekday} BETWEEN 0 AND 6`),
  ],
);

/*
 * 每个活动／模板需要几个某类人。存成两张关联表而不是活动行上的一列 JSON：标签是可以
 * 删的，JSON 里的 id 删完就成了悬空引用，而外键能让它跟着一起走。
 *
 * 一格指向一个职业标签而不是单个职业，这样才写得出「要 2 个治疗，哪种都行」。只要一
 * 个职业的旧写法就是一个只装了它自己的标签。
 * required 只是筹划期的信号，报名不受它限制——硬上限只有 events.capacity。
 */
export const eventClassQuotas = sqliteTable(
  "event_class_quotas",
  {
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => classTags.id, { onDelete: "cascade" }),
    required: integer("required").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.tagId] }),
    index("idx_event_class_quotas_tag").on(table.tagId),
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
    index("idx_recurring_template_class_quotas_tag").on(table.tagId),
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
  (table) => ({
    resultsVisibilityValid: check(
      "event_polls_results_visibility_valid",
      sql`${table.resultsVisibility} IN ('always', 'after_vote', 'after_close')`,
    ),
    showVoterNamesBoolean: check(
      "event_polls_show_voter_names_boolean",
      sql`${table.showVoterNames} IN (0, 1)`,
    ),
  }),
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
    uxEventId: uniqueIndex("ux_event_poll_options_event_id").on(table.eventId, table.id),
    sortNonnegative: check("event_poll_options_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  }),
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
    index("idx_event_poll_votes_event_user").on(table.eventId, table.userId),
    index("idx_event_poll_votes_user").on(table.userId),
    foreignKey({
      columns: [table.eventId, table.optionId],
      foreignColumns: [eventPollOptions.eventId, eventPollOptions.id],
      name: "fk_event_poll_votes_event_option",
    }).onDelete("cascade"),
  ],
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
    idxUser: index("idx_event_raffle_winners_user").on(table.userId),
  }),
);
