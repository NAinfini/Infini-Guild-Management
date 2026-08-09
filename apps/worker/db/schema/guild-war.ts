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
    ownKills: real("own_kills"),
    ownTowers: real("own_towers"),
    ownBaseHp: real("own_base_hp"),
    ownCredits: real("own_credits"),
    ownDistance: real("own_distance"),
    enemyKills: real("enemy_kills"),
    enemyTowers: real("enemy_towers"),
    enemyBaseHp: real("enemy_base_hp"),
    enemyCredits: real("enemy_credits"),
    enemyDistance: real("enemy_distance"),
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
    index("idx_war_history_created_by").on(table.createdBy),
    index("idx_war_history_updated_by").on(table.updatedBy),
    check("war_history_result_valid", sql`${table.result} IS NULL OR ${table.result} IN ('win', 'loss', 'draw')`),
    check("war_history_duration_positive", sql`${table.durationMinutes} IS NULL OR ${table.durationMinutes} > 0`),
    check(
      "war_history_stats_nonnegative",
      sql`(${table.ownKills} IS NULL OR ${table.ownKills} >= 0)
        AND (${table.ownTowers} IS NULL OR ${table.ownTowers} >= 0)
        AND (${table.ownBaseHp} IS NULL OR ${table.ownBaseHp} >= 0)
        AND (${table.ownCredits} IS NULL OR ${table.ownCredits} >= 0)
        AND (${table.ownDistance} IS NULL OR ${table.ownDistance} >= 0)
        AND (${table.enemyKills} IS NULL OR ${table.enemyKills} >= 0)
        AND (${table.enemyTowers} IS NULL OR ${table.enemyTowers} >= 0)
        AND (${table.enemyBaseHp} IS NULL OR ${table.enemyBaseHp} >= 0)
        AND (${table.enemyCredits} IS NULL OR ${table.enemyCredits} >= 0)
        AND (${table.enemyDistance} IS NULL OR ${table.enemyDistance} >= 0)`,
    ),
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
    check("war_teams_sort_nonnegative", sql`${table.sortOrder} >= 0`),
    check("war_teams_is_locked_boolean", sql`${table.isLocked} IN (0, 1)`),
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
    kills: real("kills"),
    deaths: real("deaths"),
    assists: real("assists"),
    damage: real("damage"),
    healing: real("healing"),
    buildingDamage: real("building_damage"),
    credits: real("credits"),
    damageTaken: real("damage_taken"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("ux_war_team_members_team_user").on(table.warTeamId, table.userId),
    index("idx_war_team_members_team_sort").on(table.warTeamId, table.sortOrder, table.id),
    index("idx_war_team_members_user").on(table.userId),
    check("war_team_members_sort_nonnegative", sql`${table.sortOrder} >= 0`),
    check(
      "war_team_members_stats_nonnegative",
      sql`(${table.kills} IS NULL OR ${table.kills} >= 0)
        AND (${table.deaths} IS NULL OR ${table.deaths} >= 0)
        AND (${table.assists} IS NULL OR ${table.assists} >= 0)
        AND (${table.damage} IS NULL OR ${table.damage} >= 0)
        AND (${table.healing} IS NULL OR ${table.healing} >= 0)
        AND (${table.buildingDamage} IS NULL OR ${table.buildingDamage} >= 0)
        AND (${table.credits} IS NULL OR ${table.credits} >= 0)
        AND (${table.damageTaken} IS NULL OR ${table.damageTaken} >= 0)`,
    ),
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
    index("idx_war_pool_members_user").on(table.userId),
    check(
      "war_pool_members_exactly_one_parent",
      sql`(${table.eventId} IS NULL) <> (${table.warHistoryId} IS NULL)`,
    ),
  ],
);
