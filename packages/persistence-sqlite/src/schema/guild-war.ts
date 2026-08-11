import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { WAR_RESULTS } from "@guild/shared/constants/guild-war";
import type { WarResult } from "@guild/shared/constants/guild-war";
import { users } from "./auth";
import { events } from "./events";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const warResults = [...WAR_RESULTS] as [WarResult, ...WarResult[]];

export const guildWars = sqliteTable(
  "guild_wars",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").references(() => events.id, { onDelete: "set null" }),
    status: text("status", { enum: ["active", "concluded"] }).notNull(),
    warName: text("war_name").notNull(),
    enemyName: text("enemy_name"),
    result: text("result", { enum: warResults }),
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
    rosterVersion: integer("roster_version").notNull().default(0),
    mutationToken: text("mutation_token"),
    concludedAt: text("concluded_at"),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_guild_wars_event").on(table.eventId),
    index("idx_guild_wars_active_event").on(table.status, table.eventId, table.id),
    index("idx_guild_wars_history_created").on(table.status, table.createdAt, table.id),
    uniqueIndex("ux_guild_wars_mutation_token")
      .on(table.mutationToken)
      .where(sql`${table.mutationToken} IS NOT NULL`),
    check("guild_wars_status_valid", sql`${table.status} IN ('active', 'concluded')`),
    check("guild_wars_result_valid", sql`${table.result} IS NULL OR ${table.result} IN ('win', 'loss', 'draw')`),
    check("guild_wars_duration_positive", sql`${table.durationMinutes} IS NULL OR ${table.durationMinutes} > 0`),
    check("guild_wars_roster_version_nonnegative", sql`${table.rosterVersion} >= 0`),
    check(
      "guild_wars_status_shape",
      sql`(${table.status} = 'active' AND ${table.eventId} IS NOT NULL AND ${table.concludedAt} IS NULL AND ${table.result} IS NULL)
        OR (${table.status} = 'concluded' AND ${table.concludedAt} IS NOT NULL AND ${table.result} IN ('win', 'loss', 'draw'))`,
    ),
    check(
      "guild_wars_team_stats_nonnegative",
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
    warId: text("war_id").notNull().references(() => guildWars.id, { onDelete: "cascade" }),
    teamName: text("team_name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    notes: text("notes"),
    isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("ux_war_teams_war_id_id").on(table.warId, table.id),
    index("idx_war_teams_war_sort").on(table.warId, table.sortOrder, table.id),
    check("war_teams_sort_nonnegative", sql`${table.sortOrder} >= 0`),
    check("war_teams_locked_boolean", sql`${table.isLocked} IN (0, 1)`),
  ],
);

export const warMembers = sqliteTable(
  "war_members",
  {
    id: text("id").primaryKey(),
    warId: text("war_id").notNull().references(() => guildWars.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => warTeams.id, { onDelete: "cascade" }),
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
    uniqueIndex("ux_war_members_war_user").on(table.warId, table.userId),
    index("idx_war_members_team_sort").on(table.teamId, table.sortOrder, table.id),
    index("idx_war_members_war_pool_sort").on(table.warId, table.teamId, table.sortOrder, table.id),
    index("idx_war_members_user_war").on(table.userId, table.warId),
    check("war_members_sort_nonnegative", sql`${table.sortOrder} >= 0`),
    check(
      "war_members_stats_nonnegative",
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
