// Domain: Guild War
// Tables: warHistory, warTeams, warTeamMembers, warPoolMembers
// Dependencies: auth.users, events.events
import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { WAR_RESULTS } from "@guild/shared/constants/guild-war";
import { users } from "./auth";
import { events } from "./events";
import { nowUtc } from "./shared";

const WAR_RESULT_OPTIONS = WAR_RESULTS as unknown as [string, ...string[]];
export const warHistory = sqliteTable(
  "war_history",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").references(() => events.id),
    warName: text("war_name").notNull(),
    enemyName: text("enemy_name"),
    result: text("result", { enum: WAR_RESULT_OPTIONS }),
    ownStats: text("own_stats", { mode: "json" }).$type<Record<string, number | null>>(),
    enemyStats: text("enemy_stats", { mode: "json" }).$type<Record<string, number | null>>(),
    durationMinutes: real("duration_minutes"),
    notes: text("notes"),
    createdBy: text("created_by").notNull().references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_war_history_event_id").on(table.eventId),
    index("idx_war_history_created").on(table.createdAt, table.id),
    check("war_history_result_valid", sql`${table.result} IS NULL OR ${table.result} IN ('win', 'loss', 'draw')`),
    check("war_history_duration_positive", sql`${table.durationMinutes} IS NULL OR ${table.durationMinutes} > 0`),
    check("war_history_own_stats_json_object", sql`${table.ownStats} IS NULL OR (json_valid(${table.ownStats}) AND json_type(${table.ownStats}) = 'object')`),
    check("war_history_enemy_stats_json_object", sql`${table.enemyStats} IS NULL OR (json_valid(${table.enemyStats}) AND json_type(${table.enemyStats}) = 'object')`),
  ],
);

export const warTeams = sqliteTable(
  "war_teams",
  {
    id: text("id").primaryKey(),
    warHistoryId: text("war_history_id").references(() => warHistory.id, { onDelete: "cascade" }),
    eventId: text("event_id").references(() => events.id, { onDelete: "cascade" }),
    teamName: text("team_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    index("idx_war_teams_history_sort").on(table.warHistoryId, table.sortOrder, table.id),
    index("idx_war_teams_event_sort").on(table.eventId, table.sortOrder, table.id),
    check(
      "war_teams_exactly_one_parent",
      sql`(${table.eventId} IS NULL) <> (${table.warHistoryId} IS NULL)`,
    ),
  ],
);

export const warTeamMembers = sqliteTable(
  "war_team_members",
  {
    id: text("id").primaryKey(),
    warTeamId: text("war_team_id").notNull().references(() => warTeams.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleTag: text("role_tag"),
    sortOrder: integer("sort_order").notNull().default(0),
    stats: text("stats", { mode: "json" }).$type<Record<string, number | null>>(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("ux_war_team_members_team_user").on(table.warTeamId, table.userId),
    index("idx_war_team_members_team_sort").on(table.warTeamId, table.sortOrder, table.id),
    index("idx_war_team_members_user").on(table.userId),
    check("war_team_members_stats_json_object", sql`${table.stats} IS NULL OR (json_valid(${table.stats}) AND json_type(${table.stats}) = 'object')`),
  ],
);

export const warPoolMembers = sqliteTable(
  "war_pool_members",
  {
    id: text("id").primaryKey(),
    warHistoryId: text("war_history_id").references(() => warHistory.id, { onDelete: "cascade" }),
    eventId: text("event_id").references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("ux_war_pool_members_history_user").on(table.warHistoryId, table.userId),
    uniqueIndex("ux_war_pool_members_event_user").on(table.eventId, table.userId),
    index("idx_war_pool_members_event").on(table.eventId),
    check(
      "war_pool_members_exactly_one_parent",
      sql`(${table.eventId} IS NULL) <> (${table.warHistoryId} IS NULL)`,
    ),
  ],
);
