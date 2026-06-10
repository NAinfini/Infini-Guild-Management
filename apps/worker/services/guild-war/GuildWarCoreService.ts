import {
  createWarHistorySchema,
  saveTeamsPayloadSchema,
  updateWarHistorySchema,
  warHistorySchema,
  warTeamMemberSchema,
  warTeamSchema,
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

export type WarHistoryRow = {
  id: string;
  eventId: string | null;
  warName: string;
  enemyName: string | null;
  result: string | null;
  ownStats: Record<string, number | null> | null;
  enemyStats: Record<string, number | null> | null;
  durationMinutes: number | null;
  notes: string | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WarTeamRow = {
  id: string;
  warHistoryId: string | null;
  eventId: string | null;
  teamName: string;
  sortOrder: number;
  notes: string | null;
  isLocked: boolean;
};

export type WarTeamMemberRow = {
  id: string;
  warTeamId: string;
  userId: string;
  roleTag: string | null;
  sortOrder: number;
  stats: Record<string, number | null> | null;
  note: string | null;
};

export type WarTemplateSnapshot = {
  teams: Array<{
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
};

// --- Pure helpers ---

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toWarHistoryPayload(row: WarHistoryRow) {
  return warHistorySchema.parse({
    id: row.id, event_id: row.eventId, war_name: row.warName, enemy_name: row.enemyName, result: row.result,
    own_stats: row.ownStats ?? null,
    enemy_stats: row.enemyStats ?? null,
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
    sort_order: toNum(row.sortOrder) ?? 0, stats: row.stats ?? null, note: row.note,
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

  // --- DB query methods ---

  async getWarHistoryById(warId: string): Promise<WarHistoryRow | null> {
    const row = (await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, updatedBy: warHistory.updatedBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(eq(warHistory.id, warId)).limit(1))[0];
    return row ?? null;
  }

  async getLatestWarHistory(eventId?: string): Promise<WarHistoryRow | null> {
    const rows = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, updatedBy: warHistory.updatedBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(eventId ? eq(warHistory.eventId, eventId) : undefined).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(1);
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
    return await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, stats: warTeamMembers.stats, note: warTeamMembers.note }).from(warTeamMembers).where(inArray(warTeamMembers.warTeamId, teamIds)).orderBy(asc(warTeamMembers.sortOrder), asc(warTeamMembers.id));
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
