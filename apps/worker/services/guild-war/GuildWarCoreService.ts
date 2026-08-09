import {
  createWarHistorySchema,
  DEFAULT_GAME_RULES,
  saveTeamsPayloadSchema,
  updateWarHistorySchema,
  warHistorySchema,
  warTeamMemberSchema,
  warTeamSchema,
  type GameRules,
  type WarMemberStatKey,
  type WarTeamObjectiveKey,
} from "@guild/shared";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { asc, desc, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { z } from "zod";
import {
  users,
  warHistory,
  warPoolMembers,
  warTeamMembers,
  warTeams,
} from "../../db/schema";
import type { WriteAuditLogInput } from "../audit";

export type DrizzleDb = DrizzleD1Database<Record<string, never>>;

export type TeamStatsInput = Partial<Record<WarTeamObjectiveKey, number | null>>;
export type MemberStatsInput = Partial<Record<WarMemberStatKey, number | null>>;
export type WarHistoryRow = typeof warHistory.$inferSelect;
export type WarTeamRow = typeof warTeams.$inferSelect;
export type WarTeamMemberRow = typeof warTeamMembers.$inferSelect;

export const WAR_HISTORY_FIELDS = {
  id: warHistory.id,
  eventId: warHistory.eventId,
  warName: warHistory.warName,
  enemyName: warHistory.enemyName,
  result: warHistory.result,
  ownKills: warHistory.ownKills,
  ownTowers: warHistory.ownTowers,
  ownBaseHp: warHistory.ownBaseHp,
  ownCredits: warHistory.ownCredits,
  ownDistance: warHistory.ownDistance,
  enemyKills: warHistory.enemyKills,
  enemyTowers: warHistory.enemyTowers,
  enemyBaseHp: warHistory.enemyBaseHp,
  enemyCredits: warHistory.enemyCredits,
  enemyDistance: warHistory.enemyDistance,
  durationMinutes: warHistory.durationMinutes,
  notes: warHistory.notes,
  createdBy: warHistory.createdBy,
  updatedBy: warHistory.updatedBy,
  createdAt: warHistory.createdAt,
  updatedAt: warHistory.updatedAt,
};

export const WAR_TEAM_MEMBER_STAT_FIELDS = {
  kills: warTeamMembers.kills,
  deaths: warTeamMembers.deaths,
  assists: warTeamMembers.assists,
  damage: warTeamMembers.damage,
  healing: warTeamMembers.healing,
  buildingDamage: warTeamMembers.buildingDamage,
  credits: warTeamMembers.credits,
  damageTaken: warTeamMembers.damageTaken,
};

export const WAR_TEAM_MEMBER_FIELDS = {
  id: warTeamMembers.id,
  warTeamId: warTeamMembers.warTeamId,
  userId: warTeamMembers.userId,
  roleTag: warTeamMembers.roleTag,
  sortOrder: warTeamMembers.sortOrder,
  ...WAR_TEAM_MEMBER_STAT_FIELDS,
  note: warTeamMembers.note,
};

export type WarTemplateSnapshot = {
  teams: Array<{
    id?: string;
    team_name: string;
    sort_order: number;
    notes?: string;
    is_locked?: boolean;
    members: Array<{ user_id: string; role_tag?: string; sort_order: number }>;
  }>;
  pool_members: Array<{ user_id: string }>;
};

type AuditLogInput = WriteAuditLogInput;
export type SaveTeamsInput = z.infer<typeof saveTeamsPayloadSchema>;
export type MoveMembersInput = Array<{ user_id: string; to: string }>;
export type RoleTagUpdatesInput = Array<{ user_id: string; role_tag: string | null }>;
export type CreateWarHistoryInput = z.infer<typeof createWarHistorySchema>;
export type UpdateWarHistoryInput = z.infer<typeof updateWarHistorySchema>;

export type GuildWarServiceDeps = {
  media: { get(key: string): Promise<{ text(): Promise<string> } | null> };
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (input: { entityType: PushEntityType; entityId: string; hint: PushHint }) => Promise<void>;
  rawDb: D1Database;
  getGameRules?: () => Promise<GameRules>;
};

// --- Pure helpers ---

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function statsOrNull(stats: Record<string, number | null>): Record<string, number | null> | null {
  const recorded = Object.entries(stats).filter(([, value]) => value !== null);
  return recorded.length > 0 ? Object.fromEntries(recorded) : null;
}

export function toTeamStats(row: WarHistoryRow, side: "own" | "enemy"): Record<string, number | null> | null {
  return side === "own"
    ? statsOrNull({
        kills: toNum(row.ownKills),
        towers: toNum(row.ownTowers),
        base_hp: toNum(row.ownBaseHp),
        credits: toNum(row.ownCredits),
        distance: toNum(row.ownDistance),
      })
    : statsOrNull({
        kills: toNum(row.enemyKills),
        towers: toNum(row.enemyTowers),
        base_hp: toNum(row.enemyBaseHp),
        credits: toNum(row.enemyCredits),
        distance: toNum(row.enemyDistance),
      });
}

export function toMemberStats(
  row: Pick<WarTeamMemberRow, "kills" | "deaths" | "assists" | "damage" | "healing" | "buildingDamage" | "credits" | "damageTaken">,
): Record<string, number | null> | null {
  return statsOrNull({
    kills: toNum(row.kills),
    deaths: toNum(row.deaths),
    assists: toNum(row.assists),
    damage: toNum(row.damage),
    healing: toNum(row.healing),
    building_damage: toNum(row.buildingDamage),
    credits: toNum(row.credits),
    damage_taken: toNum(row.damageTaken),
  });
}

export function toOwnStatsColumns(stats: TeamStatsInput | null | undefined) {
  return {
    ownKills: stats?.kills ?? null,
    ownTowers: stats?.towers ?? null,
    ownBaseHp: stats?.base_hp ?? null,
    ownCredits: stats?.credits ?? null,
    ownDistance: stats?.distance ?? null,
  };
}

export function toEnemyStatsColumns(stats: TeamStatsInput | null | undefined) {
  return {
    enemyKills: stats?.kills ?? null,
    enemyTowers: stats?.towers ?? null,
    enemyBaseHp: stats?.base_hp ?? null,
    enemyCredits: stats?.credits ?? null,
    enemyDistance: stats?.distance ?? null,
  };
}

export function toMemberStatsColumns(stats: MemberStatsInput | null | undefined) {
  return {
    kills: stats?.kills ?? null,
    deaths: stats?.deaths ?? null,
    assists: stats?.assists ?? null,
    damage: stats?.damage ?? null,
    healing: stats?.healing ?? null,
    buildingDamage: stats?.building_damage ?? null,
    credits: stats?.credits ?? null,
    damageTaken: stats?.damage_taken ?? null,
  };
}

export function toWarHistoryPayload(row: WarHistoryRow) {
  return warHistorySchema.parse({
    id: row.id, event_id: row.eventId, war_name: row.warName, enemy_name: row.enemyName, result: row.result,
    own_stats: toTeamStats(row, "own"),
    enemy_stats: toTeamStats(row, "enemy"),
    duration_minutes: toNum(row.durationMinutes), notes: row.notes,
    created_by: row.createdBy, updated_by: row.updatedBy ?? null, created_at: row.createdAt, updated_at: row.updatedAt,
  });
}

export function toTeamPayload(row: WarTeamRow) {
  return warTeamSchema.parse({
    id: row.id, war_history_id: row.warHistoryId ?? null, event_id: row.eventId ?? null, team_name: row.teamName,
    sort_order: toNum(row.sortOrder) ?? 0, notes: row.notes, is_locked: row.isLocked,
  });
}

export function toMemberPayload(row: WarTeamMemberRow) {
  return warTeamMemberSchema.parse({
    id: row.id, war_team_id: row.warTeamId, user_id: row.userId, role_tag: row.roleTag,
    sort_order: toNum(row.sortOrder) ?? 0, stats: toMemberStats(row), note: row.note,
  });
}

export function buildWarEtag(warId: string, updatedAt: string): string {
  return `"war-${warId}-${updatedAt}"`;
}

/**
 * djb2-style hash of a string: fast, deterministic, no dependencies.
 * Produces a 32-bit unsigned integer as a hex string.
 */
function djb2Hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = (((h << 5) + h) ^ value.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

export function buildActiveEtag(eventId: string, teams: WarTeamRow[], members: WarTeamMemberRow[]): string {
  // Incorporate a deterministic digest of the actual roster composition so that
  // member swaps that leave counts unchanged still produce a new ETag (fix for
  // stale 304 responses when only roster membership changed).
  // Sorted by memberId:teamId:sortOrder to make the hash order-independent.
  const rosterParts = members
    .map((m) => `${m.id}:${m.warTeamId}:${m.sortOrder}`)
    .sort();
  const digest = djb2Hash(rosterParts.join("|"));
  return `"active-${eventId}-${teams.length}-${members.length}-${digest}"`;
}

// --- Service class ---

export class GuildWarCoreService {
  protected db: DrizzleDb;
  protected deps: GuildWarServiceDeps;

  constructor(db: DrizzleDb, deps: GuildWarServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  protected getGameRules(): Promise<GameRules> {
    return this.deps.getGameRules?.() ?? Promise.resolve(DEFAULT_GAME_RULES);
  }

  // --- DB query methods ---

  async getWarHistoryById(warId: string): Promise<WarHistoryRow | null> {
    const row = (await this.db.select(WAR_HISTORY_FIELDS).from(warHistory).where(eq(warHistory.id, warId)).limit(1))[0];
    return row ?? null;
  }

  async getLatestWarHistory(eventId?: string): Promise<WarHistoryRow | null> {
    const rows = await this.db.select(WAR_HISTORY_FIELDS).from(warHistory).where(eventId ? eq(warHistory.eventId, eventId) : undefined).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(1);
    return rows[0] ?? null;
  }

  async getTeamsForHistory(warHistoryId: string): Promise<WarTeamRow[]> {
    return await this.db.select({ id: warTeams.id, warHistoryId: warTeams.warHistoryId, eventId: warTeams.eventId, teamName: warTeams.teamName, sortOrder: warTeams.sortOrder, notes: warTeams.notes, isLocked: warTeams.isLocked }).from(warTeams).where(eq(warTeams.warHistoryId, warHistoryId)).orderBy(asc(warTeams.sortOrder), asc(warTeams.id));
  }

  async getTeamsForEvent(eventId: string): Promise<WarTeamRow[]> {
    return await this.db.select({ id: warTeams.id, warHistoryId: warTeams.warHistoryId, eventId: warTeams.eventId, teamName: warTeams.teamName, sortOrder: warTeams.sortOrder, notes: warTeams.notes, isLocked: warTeams.isLocked }).from(warTeams).where(eq(warTeams.eventId, eventId)).orderBy(asc(warTeams.sortOrder), asc(warTeams.id));
  }

  async getMembersForTeams(teamIds: string[]): Promise<WarTeamMemberRow[]> {
    if (teamIds.length === 0) return [];
    return await this.db.select(WAR_TEAM_MEMBER_FIELDS).from(warTeamMembers).where(inArray(warTeamMembers.warTeamId, teamIds)).orderBy(asc(warTeamMembers.sortOrder), asc(warTeamMembers.id));
  }

  async getPoolMembers(warHistoryId: string): Promise<Array<{ id: string; warHistoryId: string | null; eventId: string | null; userId: string }>> {
    return await this.db.select({ id: warPoolMembers.id, warHistoryId: warPoolMembers.warHistoryId, eventId: warPoolMembers.eventId, userId: warPoolMembers.userId }).from(warPoolMembers).where(eq(warPoolMembers.warHistoryId, warHistoryId));
  }

  async getPoolMembersForEvent(eventId: string): Promise<Array<{ id: string; warHistoryId: string | null; eventId: string | null; userId: string }>> {
    return await this.db.select({ id: warPoolMembers.id, warHistoryId: warPoolMembers.warHistoryId, eventId: warPoolMembers.eventId, userId: warPoolMembers.userId }).from(warPoolMembers).where(eq(warPoolMembers.eventId, eventId));
  }

  async getUsernameMap(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds));
    return new Map(rows.map((r) => [r.id, r.username]));
  }

}
