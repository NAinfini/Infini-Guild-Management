// Domain: Guild War
// Tables: warHistory, warTeams, warTeamMembers, warPoolMembers, warTemplates
// Dependencies: auth.users, events.events
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { activeGame } from "@guild/shared/games";
import { users } from "./auth";
import { events } from "./events";
import { nowUtc } from "./shared";

const WAR_RESULT_OPTIONS = activeGame.war.resultOptions as unknown as [string, ...string[]];

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
  (table) => ({
    idxEventId: index("idx_war_history_event_id").on(table.eventId),
    idxCreated: index("idx_war_history_created").on(table.createdAt, table.id),
  }),
);

export const warTeams = sqliteTable(
  "war_teams",
  {
    id: text("id").primaryKey(),
    warHistoryId: text("war_history_id").notNull().references(() => warHistory.id, { onDelete: "cascade" }),
    teamName: text("team_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
  },
  (table) => ({
    idxHistorySort: index("idx_war_teams_history_sort").on(table.warHistoryId, table.sortOrder, table.id),
  }),
);

export const warTeamMembers = sqliteTable(
  "war_team_members",
  {
    id: text("id").primaryKey(),
    warTeamId: text("war_team_id").notNull().references(() => warTeams.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    roleTag: text("role_tag"),
    sortOrder: integer("sort_order").notNull().default(0),
    stats: text("stats", { mode: "json" }).$type<Record<string, number | null>>(),
    note: text("note"),
  },
  (table) => ({
    uxTeamUser: uniqueIndex("ux_war_team_members_team_user").on(table.warTeamId, table.userId),
    idxTeamSort: index("idx_war_team_members_team_sort").on(table.warTeamId, table.sortOrder, table.id),
    idxUser: index("idx_war_team_members_user").on(table.userId),
  }),
);

export const warPoolMembers = sqliteTable(
  "war_pool_members",
  {
    id: text("id").primaryKey(),
    warHistoryId: text("war_history_id").notNull().references(() => warHistory.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
  },
  (table) => ({
    uxHistoryUser: uniqueIndex("ux_war_pool_members_history_user").on(table.warHistoryId, table.userId),
  }),
);

export const warTemplates = sqliteTable(
  "war_templates",
  {
    id: text("id").primaryKey(),
    templateName: text("template_name").notNull(),
    description: text("description"),
    templateType: text("template_type").notNull().default("structure"),
    sourceEventId: text("source_event_id").references(() => events.id),
    payloadJson: text("payload_json").notNull(),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxSourceEvent: index("idx_war_templates_source_event").on(table.sourceEventId),
    idxUpdatedAt: index("idx_war_templates_updated_at").on(table.updatedAt),
  }),
);
