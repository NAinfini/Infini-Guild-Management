import {
  createWarHistorySchema,
  eventSchema,
  saveTeamsPayloadSchema,
  updateMemberStatsSchema,
  updateWarHistorySchema,
  warHistorySchema,
  warTeamMemberSchema,
  warTeamSchema,
} from "@guild/shared";
import { activeGame } from "@guild/shared/games";
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { z } from "zod";
import {
  eventParticipants,
  events,
  users,
  warHistory,
  warPoolMembers,
  warTeamMembers,
  warTeams,
} from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { type AnalyticsSettings, defaultAnalyticsSettings } from "./AdminService";
import { parseRecurrenceRule } from "./EventService";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;

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
  createdAt: string;
  updatedAt: string;
};

export type WarTeamRow = {
  id: string;
  warHistoryId: string;
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

type ModifierBreakdown = { factor: string; ratio: number; weight: number; contribution: number };

type AuditLogInput = { entityType: string; action: string; actorId: string; entityId: string; diffTitle?: string | null; detailText?: string | null };
type SaveTeamsInput = z.infer<typeof saveTeamsPayloadSchema>;
type MoveMembersInput = Array<{ user_id: string; to: string }>;
type RoleTagUpdatesInput = Array<{ user_id: string; role_tag: string | null }>;
type EventPayload = z.infer<typeof eventSchema> | null;
type CreateWarHistoryInput = z.infer<typeof createWarHistorySchema>;
type UpdateWarHistoryInput = z.infer<typeof updateWarHistorySchema>;

export type GuildWarServiceDeps = {
  media: { get(key: string): Promise<{ text(): Promise<string> } | null> };
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (input: { entityType: string; entityId: string; hint: string }) => Promise<void>;
  rawDb: D1Database;
};

// --- Constants ---

const ANALYTICS_SETTINGS_KEY = "config/analytics-settings.json";

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
    created_by: row.createdBy, created_at: row.createdAt, updated_at: row.updatedAt,
  });
}

export function toTeamPayload(row: WarTeamRow) {
  return warTeamSchema.parse({
    id: row.id, war_history_id: row.warHistoryId, team_name: row.teamName,
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

function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function buildWarHistoryCsv(rows: WarHistoryRow[], creatorMap: Map<string, string>): string {
  const objectives = activeGame.war.teamObjectives.filter((o) => o.hasBothSides);
  const statHeaders = objectives.flatMap((o) => [`own_${o.key}`, `enemy_${o.key}`]);
  const headers = ["id","event_id","war_name","enemy_name","result",...statHeaders,"duration_minutes","notes","created_by","created_by_username","created_at","updated_at"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const statCells = objectives.flatMap((o) => [toCsvCell(row.ownStats?.[o.key]), toCsvCell(row.enemyStats?.[o.key])]);
    lines.push([toCsvCell(row.id),toCsvCell(row.eventId),toCsvCell(row.warName),toCsvCell(row.enemyName),toCsvCell(row.result),...statCells,toCsvCell(row.durationMinutes),toCsvCell(row.notes),toCsvCell(row.createdBy),toCsvCell(creatorMap.get(row.createdBy ?? "") ?? row.createdBy),toCsvCell(row.createdAt),toCsvCell(row.updatedAt)].join(","));
  }
  return lines.join("\n");
}

function computeWarModifier(
  war: { ownStats: Record<string, number | null> | null; enemyStats: Record<string, number | null> | null },
  _ownTeamSize: number, settings: AnalyticsSettings,
): { value: number; breakdown: ModifierBreakdown[] } {
  const weights = settings.modifier_weights;
  const own = war.ownStats ?? {};
  const enemy = war.enemyStats ?? {};
  const factors: Array<{ key: string; weight: number; ownVal: number | null; enemyVal: number | null }> = [];
  for (const [key, weight] of Object.entries(weights)) {
    if (weight <= 0) continue;
    const objectiveKey = key === "basehp" ? "base_hp" : key === "kda" ? "kills" : key;
    factors.push({ key, weight, ownVal: own[objectiveKey] ?? null, enemyVal: enemy[objectiveKey] ?? null });
  }
  const valid: Array<{ key: string; weight: number; ratio: number }> = [];
  for (const f of factors) {
    if (f.ownVal === null || f.enemyVal === null) continue;
    valid.push({ key: f.key, weight: f.weight, ratio: f.enemyVal / Math.max(f.ownVal, 1) });
  }
  if (valid.length === 0) return { value: 1.0, breakdown: [] };
  const totalWeight = valid.reduce((s, f) => s + f.weight, 0);
  const breakdown: ModifierBreakdown[] = [];
  let modifier = 0;
  for (const f of valid) {
    const nw = f.weight / totalWeight;
    const contribution = nw * f.ratio;
    modifier += contribution;
    breakdown.push({ factor: f.key, ratio: Number(f.ratio.toFixed(4)), weight: Number(nw.toFixed(4)), contribution: Number(contribution.toFixed(4)) });
  }
  return { value: Number(modifier.toFixed(4)), breakdown };
}

// --- Service class ---

export class GuildWarService {
  private db: DrizzleDb;
  private deps: GuildWarServiceDeps;

  constructor(db: DrizzleDb, deps: GuildWarServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  private async readAnalyticsSettings(): Promise<AnalyticsSettings> {
    const object = await this.deps.media.get(ANALYTICS_SETTINGS_KEY);
    if (!object) return defaultAnalyticsSettings();
    try {
      const parsed = JSON.parse(await object.text()) as unknown;
      const defaults = defaultAnalyticsSettings();
      if (typeof parsed !== "object" || parsed === null) return defaults;
      const record = parsed as Record<string, unknown>;
      const rawWeights = record.modifier_weights;
      const modifier_weights: Record<string, number> = { ...defaults.modifier_weights };
      if (typeof rawWeights === "object" && rawWeights !== null) {
        for (const [key, val] of Object.entries(rawWeights as Record<string, unknown>)) {
          if (typeof val === "number") modifier_weights[key] = val;
        }
      }
      return {
        reference_duration_minutes: typeof record.reference_duration_minutes === "number" && record.reference_duration_minutes > 0 ? record.reference_duration_minutes : defaults.reference_duration_minutes,
        modifier_weights,
      };
    } catch { return defaultAnalyticsSettings(); }
  }

  // --- DB query methods ---

  async getWarHistoryById(warId: string): Promise<WarHistoryRow | null> {
    const row = (await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(eq(warHistory.id, warId)).limit(1))[0];
    return row ?? null;
  }

  async getLatestWarHistory(eventId?: string): Promise<WarHistoryRow | null> {
    const rows = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(eventId ? eq(warHistory.eventId, eventId) : undefined).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(1);
    return rows[0] ?? null;
  }

  async getTeamsForHistory(warHistoryId: string): Promise<WarTeamRow[]> {
    return await this.db.select({ id: warTeams.id, warHistoryId: warTeams.warHistoryId, teamName: warTeams.teamName, sortOrder: warTeams.sortOrder, notes: warTeams.notes, isLocked: warTeams.isLocked }).from(warTeams).where(eq(warTeams.warHistoryId, warHistoryId)).orderBy(asc(warTeams.sortOrder), asc(warTeams.id));
  }

  async getMembersForTeams(teamIds: string[]): Promise<WarTeamMemberRow[]> {
    if (teamIds.length === 0) return [];
    return await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, stats: warTeamMembers.stats, note: warTeamMembers.note }).from(warTeamMembers).where(inArray(warTeamMembers.warTeamId, teamIds)).orderBy(asc(warTeamMembers.sortOrder), asc(warTeamMembers.id));
  }

  async getPoolMembers(warHistoryId: string): Promise<Array<{ id: string; warHistoryId: string; userId: string }>> {
    return await this.db.select({ id: warPoolMembers.id, warHistoryId: warPoolMembers.warHistoryId, userId: warPoolMembers.userId }).from(warPoolMembers).where(eq(warPoolMembers.warHistoryId, warHistoryId));
  }

  private async getUsernameMap(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds));
    return new Map(rows.map((r) => [r.id, r.username]));
  }

  async ensureWarHistoryForEvent(eventId: string, actorId: string): Promise<WarHistoryRow | null> {
    const existing = await this.getLatestWarHistory(eventId);
    if (existing) return existing;
    const historyId = nanoid();
    await this.db.insert(warHistory).values({ id: historyId, eventId, warName: `Guild War ${new Date().toISOString().slice(0, 10)}`, createdBy: actorId });
    return await this.getWarHistoryById(historyId);
  }

  async replaceHistoryTeams(warHistoryId: string, snapshot: WarTemplateSnapshot): Promise<void> {
    const { rawDb } = this.deps;
    const existingTeams = await this.getTeamsForHistory(warHistoryId);
    const stmts: D1PreparedStatement[] = [];

    // 1. Delete existing members for each team
    for (const team of existingTeams) {
      stmts.push(rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id = ?1").bind(team.id));
    }
    // 2. Delete existing teams and pool members
    stmts.push(rawDb.prepare("DELETE FROM war_teams WHERE war_history_id = ?1").bind(warHistoryId));
    stmts.push(rawDb.prepare("DELETE FROM war_pool_members WHERE war_history_id = ?1").bind(warHistoryId));

    // 3. Insert new teams and members
    for (const team of snapshot.teams) {
      const teamId = nanoid();
      stmts.push(rawDb.prepare("INSERT INTO war_teams (id, war_history_id, team_name, sort_order, notes, is_locked) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(teamId, warHistoryId, team.team_name, team.sort_order, team.notes ?? null, team.is_locked ? 1 : 0));
      for (const member of team.members) {
        stmts.push(rawDb.prepare("INSERT INTO war_team_members (id, war_team_id, user_id, role_tag, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)").bind(nanoid(), teamId, member.user_id, member.role_tag ?? null, member.sort_order));
      }
    }

    // 4. Insert new pool members
    for (const poolMember of snapshot.pool_members) {
      stmts.push(rawDb.prepare("INSERT INTO war_pool_members (id, war_history_id, user_id) VALUES (?1, ?2, ?3)").bind(nanoid(), warHistoryId, poolMember.user_id));
    }

    // 5. Update timestamp
    stmts.push(rawDb.prepare("UPDATE war_history SET updated_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), warHistoryId));

    await rawDb.batch(stmts);
  }

  // --- Public: business logic methods ---

  private async getEventPayload(eventId: string): Promise<EventPayload> {
    const eventRow = (await this.db.select({ id: events.id, type: events.type, title: events.title, description: events.description, startAt: events.startAt, endAt: events.endAt, capacity: events.capacity, pinned: events.pinned, signupLocked: events.signupLocked, autoArchive: events.autoArchive, autoArchived: events.autoArchived, visibleAt: events.visibleAt, archivedAt: events.archivedAt, createdBy: events.createdBy, recurrenceRule: events.recurrenceRule, visibilityOffsetMinutes: events.visibilityOffsetMinutes, seriesId: events.seriesId, isSeriesParent: events.isSeriesParent, instanceDate: events.instanceDate, createdAt: events.createdAt, updatedAt: events.updatedAt }).from(events).where(eq(events.id, eventId)).limit(1))[0];
    if (!eventRow) return null;
    return eventSchema.parse({ id: eventRow.id, type: eventRow.type, title: eventRow.title, description: eventRow.description, start_at: eventRow.startAt, end_at: eventRow.endAt, capacity: eventRow.capacity, pinned: eventRow.pinned, signup_locked: eventRow.signupLocked, auto_archive: eventRow.autoArchive, auto_archived: eventRow.autoArchived, visible_at: eventRow.visibleAt, archived_at: eventRow.archivedAt, created_by: eventRow.createdBy, recurrence_rule: parseRecurrenceRule(eventRow.recurrenceRule), visibility_offset_minutes: eventRow.visibilityOffsetMinutes, series_id: eventRow.seriesId, is_series_parent: eventRow.isSeriesParent, instance_date: eventRow.instanceDate, created_at: eventRow.createdAt, updated_at: eventRow.updatedAt });
  }

  private async getEventParticipantUserIds(eventId: string): Promise<string[]> {
    const rows = await this.db.select({ userId: eventParticipants.userId }).from(eventParticipants).where(eq(eventParticipants.eventId, eventId));
    return rows.map((r) => r.userId);
  }

  async getActive(eventId?: string): Promise<ServiceResult<unknown>> {
    const activeWar = await this.getLatestWarHistory(eventId);

    // No war_history yet — return event + participants as virtual pool
    if (!activeWar) {
      if (!eventId) return ok({ war_history: null, event: null, teams: [], pool: [], participants: [], etag: null });
      const eventPayload = await this.getEventPayload(eventId);
      const participantUserIds = await this.getEventParticipantUserIds(eventId);
      const virtualPool = participantUserIds.map((userId) => ({ id: `virtual:${userId}`, warHistoryId: "pending", userId }));
      return ok({
        war_history: null, event: eventPayload, etag: null,
        teams: [], pool: virtualPool,
        participants: participantUserIds.map((uid) => ({ user_id: uid })),
      });
    }

    const teams = await this.getTeamsForHistory(activeWar.id);
    const teamIds = teams.map((t) => t.id);
    const members = await this.getMembersForTeams(teamIds);
    const dbPool = await this.getPoolMembers(activeWar.id);

    // Merge: event participants not already in teams or pool get added to pool
    const assignedUserIds = new Set([
      ...members.map((m) => m.userId),
      ...dbPool.map((p) => p.userId),
    ]);
    let participantUserIds: string[] = [];
    const resolvedEventId = eventId ?? activeWar.eventId;
    if (resolvedEventId) {
      participantUserIds = await this.getEventParticipantUserIds(resolvedEventId);
    }
    const virtualPoolAdditions = participantUserIds
      .filter((uid) => !assignedUserIds.has(uid))
      .map((uid) => ({ id: `virtual:${uid}`, warHistoryId: activeWar.id, userId: uid }));

    const eventPayload = resolvedEventId ? await this.getEventPayload(resolvedEventId) : null;
    const etag = buildWarEtag(activeWar.id, activeWar.updatedAt);

    return ok({
      war_history: toWarHistoryPayload(activeWar), event: eventPayload, etag,
      teams: teams.map((team) => ({ ...toTeamPayload(team), members: members.filter((m) => m.warTeamId === team.id).map(toMemberPayload) })),
      pool: [...dbPool.map((p) => ({ id: p.id, warHistoryId: p.warHistoryId, userId: p.userId })), ...virtualPoolAdditions],
      participants: participantUserIds.map((uid) => ({ user_id: uid })),
    });
  }

  async saveTeams(actorId: string, payload: SaveTeamsInput, conditionalEtag?: string): Promise<ServiceResult<WarHistoryRow>> {
    const activeHistory = await this.ensureWarHistoryForEvent(payload.event_id, actorId);
    if (!activeHistory) return err("SERVER_ERROR", "Failed to initialize war history");
    if (conditionalEtag) {
      const expectedEtag = buildWarEtag(activeHistory.id, activeHistory.updatedAt);
      if (conditionalEtag !== expectedEtag) return err("CONFLICT", "Guild war roster changed, refresh and retry", { expected_etag: expectedEtag });
    }
    const snapshot: WarTemplateSnapshot = { teams: payload.teams, pool_members: payload.pool_members };
    await this.replaceHistoryTeams(activeHistory.id, snapshot);
    const refreshed = await this.getWarHistoryById(activeHistory.id);
    if (!refreshed) return err("SERVER_ERROR", "Failed to refresh war history");
    const eventRow = payload.event_id ? (await this.db.select({ title: events.title }).from(events).where(eq(events.id, payload.event_id)).limit(1))[0] : null;
    await this.deps.writeAuditLog({ entityType: "guild_war", action: "save_teams", actorId, entityId: refreshed.id, diffTitle: eventRow?.title ?? null, detailText: JSON.stringify({ event_id: payload.event_id, event_name: eventRow?.title ?? null }) });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: refreshed.id, hint: "teams_saved" });
    return ok(refreshed);
  }

  async moveMembers(actorId: string, eventId: string, moves: MoveMembersInput, conditionalEtag?: string): Promise<ServiceResult<{ ok: true }>> {
    const activeHistory = await this.ensureWarHistoryForEvent(eventId, actorId);
    if (!activeHistory) return err("NOT_FOUND", "Active war history not found");
    if (moves.length === 0) return err("VALIDATION_ERROR", "At least one move is required");
    if (conditionalEtag) {
      const expectedEtag = buildWarEtag(activeHistory.id, activeHistory.updatedAt);
      if (conditionalEtag !== expectedEtag) return err("CONFLICT", "Guild war roster changed, refresh and retry", { expected_etag: expectedEtag });
    }
    const teams = await this.getTeamsForHistory(activeHistory.id);
    const teamIds = teams.map((t) => t.id);
    const teamById = new Map(teams.map((team) => [team.id, team]));
    const userIds = [...new Set(moves.map((move) => move.user_id))];
    const missingTeam = moves.find((move) => move.to !== "pool" && move.to !== "remove" && !teamById.has(move.to));
    if (missingTeam) return err("NOT_FOUND", "Target team not found");

    const nowIso = new Date().toISOString();
    const { rawDb } = this.deps;
    const stmts: D1PreparedStatement[] = [];

    if (userIds.length > 0) {
      const userPlaceholders = userIds.map((_, index) => `?${index + 2}`).join(", ");
      for (const teamId of teamIds) {
        stmts.push(rawDb.prepare(`DELETE FROM war_team_members WHERE war_team_id = ?1 AND user_id IN (${userPlaceholders})`).bind(teamId, ...userIds));
      }
      stmts.push(rawDb.prepare(`DELETE FROM war_pool_members WHERE war_history_id = ?1 AND user_id IN (${userPlaceholders})`).bind(activeHistory.id, ...userIds));
    }

    const removeUserIds = moves.filter((move) => move.to === "remove").map((move) => move.user_id);
    if (removeUserIds.length > 0) {
      const removePlaceholders = removeUserIds.map((_, index) => `?${index + 2}`).join(", ");
      stmts.push(rawDb.prepare(`DELETE FROM event_participants WHERE event_id = ?1 AND user_id IN (${removePlaceholders})`).bind(eventId, ...removeUserIds));
    }

    for (const move of moves) {
      if (move.to === "pool") {
        stmts.push(rawDb.prepare("INSERT INTO war_pool_members (id, war_history_id, user_id) VALUES (?1, ?2, ?3)").bind(nanoid(), activeHistory.id, move.user_id));
      }
    }

    const teamMoves = moves.filter((move) => move.to !== "pool" && move.to !== "remove");
    const movesByTeam = new Map<string, typeof teamMoves>();
    for (const move of teamMoves) {
      movesByTeam.set(move.to, [...(movesByTeam.get(move.to) ?? []), move]);
    }
    for (const [teamId, teamGroup] of movesByTeam) {
      const maxRow = (await this.db.select({ maxSort: sql<number>`coalesce(max(${warTeamMembers.sortOrder}), -1)` }).from(warTeamMembers).where(eq(warTeamMembers.warTeamId, teamId)))[0];
      let nextSort = Number(maxRow?.maxSort ?? -1) + 1;
      for (const move of teamGroup) {
        stmts.push(rawDb.prepare("INSERT INTO war_team_members (id, war_team_id, user_id, sort_order) VALUES (?1, ?2, ?3, ?4)").bind(nanoid(), teamId, move.user_id, nextSort));
        nextSort += 1;
      }
    }

    for (const move of moves) {
      if (move.to !== "remove") {
        stmts.push(rawDb.prepare("INSERT OR IGNORE INTO event_participants (id, event_id, user_id) VALUES (?1, ?2, ?3)").bind(nanoid(), eventId, move.user_id));
      }
    }

    stmts.push(rawDb.prepare("UPDATE war_history SET updated_at = ?1 WHERE id = ?2").bind(nowIso, activeHistory.id));
    await rawDb.batch(stmts);
    const targetUsers = userIds.length > 0
      ? await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds))
      : [];
    const usernamesById = new Map(targetUsers.map((user) => [user.id, user.username]));
    await this.deps.writeAuditLog({
      entityType: "guild_war",
      action: "move_member",
      actorId,
      entityId: activeHistory.id,
      diffTitle: targetUsers.map((user) => user.username).join(", ") || null,
      detailText: JSON.stringify({
        count: moves.length,
        moves: moves.map((move) => ({ ...move, username: usernamesById.get(move.user_id) ?? null })),
      }),
    });
    return ok({ ok: true });
  }

  async setRoleTag(actorId: string, eventId: string, userId: string, roleTag: string | null): Promise<ServiceResult<{ ok: true }>> {
    const result = await this.setRoleTags(actorId, eventId, [{ user_id: userId, role_tag: roleTag }]);
    if (!result.ok) return result;
    return ok({ ok: true });
  }

  async setRoleTags(actorId: string, eventId: string, updates: RoleTagUpdatesInput): Promise<ServiceResult<{ ok: true; updated: number }>> {
    const activeHistory = await this.getLatestWarHistory(eventId);
    if (!activeHistory) return err("NOT_FOUND", "Active war history not found");
    if (updates.length === 0) return err("VALIDATION_ERROR", "At least one role tag update is required");
    const userIds = [...new Set(updates.map((update) => update.user_id))];
    const memberRows = await this.db
      .select({ id: warTeamMembers.id, userId: warTeamMembers.userId })
      .from(warTeamMembers)
      .innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId))
      .where(and(eq(warTeams.warHistoryId, activeHistory.id), inArray(warTeamMembers.userId, userIds)));
    const memberByUserId = new Map(memberRows.map((row) => [row.userId, row.id]));
    const missingUserId = userIds.find((userId) => !memberByUserId.has(userId));
    if (missingUserId) return err("NOT_FOUND", "Member not found in active teams", { user_id: missingUserId });

    const nowIso = new Date().toISOString();
    const stmts: D1PreparedStatement[] = updates.map((update) => {
      const nextTag = typeof update.role_tag === "string" && update.role_tag.trim().length > 0 ? update.role_tag.trim() : null;
      return this.deps.rawDb
        .prepare("UPDATE war_team_members SET role_tag = ?1 WHERE id = ?2")
        .bind(nextTag, memberByUserId.get(update.user_id));
    });
    stmts.push(this.deps.rawDb.prepare("UPDATE war_history SET updated_at = ?1 WHERE id = ?2").bind(nowIso, activeHistory.id));
    await this.deps.rawDb.batch(stmts);

    const targetUsers = await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds));
    const usernamesById = new Map(targetUsers.map((user) => [user.id, user.username]));
    await this.deps.writeAuditLog({
      entityType: "guild_war",
      action: "set_role_tag",
      actorId,
      entityId: activeHistory.id,
      diffTitle: targetUsers.map((user) => user.username).join(", ") || null,
      detailText: JSON.stringify({
        count: updates.length,
        updates: updates.map((update) => ({
          user_id: update.user_id,
          username: usernamesById.get(update.user_id) ?? null,
          role_tag: typeof update.role_tag === "string" && update.role_tag.trim().length > 0 ? update.role_tag.trim() : null,
        })),
      }),
    });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: activeHistory.id, hint: "role_tags_updated" });
    return ok({ ok: true, updated: updates.length });
  }

  async exportHistory(format: "csv" | "json", filters: { dateFrom?: string; dateTo?: string; eventId?: string }): Promise<ServiceResult<{ content: string; contentType: string; filename: string }>> {
    const where: SQL<unknown>[] = [];
    if (filters.dateFrom) where.push(gte(warHistory.createdAt, filters.dateFrom));
    if (filters.dateTo) where.push(lte(warHistory.createdAt, filters.dateTo));
    if (filters.eventId) where.push(eq(warHistory.eventId, filters.eventId));
    const rows = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(where.length > 0 ? and(...where) : undefined).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(5000);
    const creatorIds = [...new Set(rows.map((r) => r.createdBy).filter(Boolean) as string[])];
    const creatorMap = await this.getUsernameMap(creatorIds);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `guild-war-history-${dateStamp}.${format}`;
    if (format === "json") {
      const warIds = rows.map((r) => r.id);
      const allTeams = warIds.length > 0 ? await this.db.select({ id: warTeams.id, warHistoryId: warTeams.warHistoryId, teamName: warTeams.teamName, sortOrder: warTeams.sortOrder, notes: warTeams.notes, isLocked: warTeams.isLocked }).from(warTeams).where(inArray(warTeams.warHistoryId, warIds)).orderBy(asc(warTeams.sortOrder), asc(warTeams.id)) : [];
      const teamIds = allTeams.map((t) => t.id);
      const allMembers = teamIds.length > 0 ? await this.getMembersForTeams(teamIds) : [];
      const memberUserIds = [...new Set(allMembers.map((m) => m.userId))];
      const memberUsernameMap = await this.getUsernameMap(memberUserIds);
      const augment = (payload: ReturnType<typeof toMemberPayload>) => ({ ...payload, username: memberUsernameMap.get(payload.user_id) ?? payload.user_id });
      const data = rows.map((h) => {
        const hTeams = allTeams.filter((t) => t.warHistoryId === h.id);
        const hTeamIds = new Set(hTeams.map((t) => t.id));
        return {
          ...toWarHistoryPayload(h),
          created_by_username: creatorMap.get(h.createdBy ?? "") ?? h.createdBy,
          teams: hTeams.map((team) => ({ ...toTeamPayload(team), members: allMembers.filter((m) => m.warTeamId === team.id).map(toMemberPayload).map(augment) })),
          member_stats: allMembers.filter((m) => hTeamIds.has(m.warTeamId)).map(toMemberPayload).map(augment),
        };
      });
      const payload = { exported_at: new Date().toISOString(), filters: { date_from: filters.dateFrom ?? null, date_to: filters.dateTo ?? null, event_id: filters.eventId ?? null }, total: rows.length, data };
      return ok({ content: JSON.stringify(payload, null, 2), contentType: "application/json; charset=utf-8", filename });
    }
    return ok({ content: buildWarHistoryCsv(rows, creatorMap), contentType: "text/csv; charset=utf-8", filename });
  }

  async listHistory(page: number, limit: number, filters: { dateFrom?: string; dateTo?: string }): Promise<ServiceResult<{ data: unknown[]; total: number; page: number; limit: number; total_pages: number }>> {
    const offset = (page - 1) * limit;
    const where: SQL<unknown>[] = [];
    if (filters.dateFrom) where.push(gte(warHistory.createdAt, filters.dateFrom));
    if (filters.dateTo) where.push(lte(warHistory.createdAt, filters.dateTo));
    const whereClause = where.length > 0 ? and(...where) : undefined;
    const rows = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt, _total: sql<number>`count(*) over()` }).from(warHistory).where(whereClause).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(limit).offset(offset);
    const total = Number((rows[0] as Record<string, unknown> | undefined)?._total ?? 0);
    return ok({ data: rows.map(toWarHistoryPayload), total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)) });
  }

  async batchHistory(ids: string[]): Promise<ServiceResult<{ data: unknown[] }>> {
    const histories = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(inArray(warHistory.id, ids));
    const allTeams = await this.db.select({ id: warTeams.id, warHistoryId: warTeams.warHistoryId, teamName: warTeams.teamName, sortOrder: warTeams.sortOrder, notes: warTeams.notes, isLocked: warTeams.isLocked }).from(warTeams).where(inArray(warTeams.warHistoryId, ids)).orderBy(asc(warTeams.sortOrder), asc(warTeams.id));
    const teamIds = allTeams.map((t) => t.id);
    const allMembers = teamIds.length > 0 ? await this.getMembersForTeams(teamIds) : [];
    const allPool = await this.db.select({ id: warPoolMembers.id, warHistoryId: warPoolMembers.warHistoryId, userId: warPoolMembers.userId }).from(warPoolMembers).where(inArray(warPoolMembers.warHistoryId, ids));
    const allUserIds = [...new Set([...allMembers.map((m) => m.userId), ...allPool.map((p) => p.userId)])];
    const usernameMap = await this.getUsernameMap(allUserIds);
    const augment = (payload: ReturnType<typeof toMemberPayload>) => ({ ...payload, username: usernameMap.get(payload.user_id) ?? payload.user_id });
    const data = histories.map((h) => {
      const hTeams = allTeams.filter((t) => t.warHistoryId === h.id);
      const hTeamIds = new Set(hTeams.map((t) => t.id));
      return {
        ...toWarHistoryPayload(h),
        teams: hTeams.map((team) => ({ ...toTeamPayload(team), members: allMembers.filter((m) => m.warTeamId === team.id).map(toMemberPayload).map(augment) })),
        pool: allPool.filter((p) => p.warHistoryId === h.id).map((p) => ({ ...p, username: usernameMap.get(p.userId) ?? p.userId })),
        member_stats: allMembers.filter((m) => hTeamIds.has(m.warTeamId)).map(toMemberPayload).map(augment),
      };
    });
    return ok({ data });
  }

  async getHistoryDetail(warId: string): Promise<ServiceResult<unknown>> {
    const history = await this.getWarHistoryById(warId);
    if (!history) return err("NOT_FOUND", "War history not found");
    const teams = await this.getTeamsForHistory(warId);
    const members = await this.getMembersForTeams(teams.map((t) => t.id));
    const pool = await this.getPoolMembers(warId);
    const allUserIds = [...new Set([...members.map((m) => m.userId), ...pool.map((p) => p.userId)])];
    const usernameMap = await this.getUsernameMap(allUserIds);
    const augment = (payload: ReturnType<typeof toMemberPayload>) => ({ ...payload, username: usernameMap.get(payload.user_id) ?? payload.user_id });
    return ok({
      ...toWarHistoryPayload(history),
      teams: teams.map((team) => ({ ...toTeamPayload(team), members: members.filter((m) => m.warTeamId === team.id).map(toMemberPayload).map(augment) })),
      pool: pool.map((p) => ({ ...p, username: usernameMap.get(p.userId) ?? p.userId })),
      member_stats: members.map(toMemberPayload).map(augment),
    });
  }

  async createHistory(actorId: string, input: CreateWarHistoryInput): Promise<ServiceResult<unknown>> {
    const historyId = nanoid();
    await this.db.insert(warHistory).values({ id: historyId, eventId: input.event_id ?? null, warName: input.war_name, enemyName: input.enemy_name ?? null, result: input.result ?? null, ownStats: input.own_stats ?? null, enemyStats: input.enemy_stats ?? null, notes: input.notes ?? null, createdBy: actorId });
    const created = await this.getWarHistoryById(historyId);
    if (!created) return err("SERVER_ERROR", "Failed to create war history");
    await this.deps.writeAuditLog({ entityType: "guild_war_history", action: "create", actorId, entityId: historyId, diffTitle: created.warName });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: historyId, hint: "history_created" });
    return ok(toWarHistoryPayload(created));
  }

  async updateHistory(actorId: string, warId: string, input: UpdateWarHistoryInput): Promise<ServiceResult<unknown>> {
    const existing = await this.getWarHistoryById(warId);
    if (!existing) return err("NOT_FOUND", "War history not found");
    const patch: Partial<typeof warHistory.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (input.event_id !== undefined) patch.eventId = input.event_id;
    if (input.war_name !== undefined) patch.warName = input.war_name;
    if (input.enemy_name !== undefined) patch.enemyName = input.enemy_name;
    if (input.result !== undefined) patch.result = input.result;
    if (input.own_stats !== undefined) patch.ownStats = input.own_stats;
    if (input.enemy_stats !== undefined) patch.enemyStats = input.enemy_stats;
    if (input.duration_minutes !== undefined) patch.durationMinutes = input.duration_minutes;
    if (input.notes !== undefined) patch.notes = input.notes;
    await this.db.update(warHistory).set(patch).where(eq(warHistory.id, warId));
    const updated = await this.getWarHistoryById(warId);
    if (!updated) return err("SERVER_ERROR", "Failed to load updated war history");
    await this.deps.writeAuditLog({ entityType: "guild_war_history", action: "update", actorId, entityId: warId, diffTitle: updated.warName, detailText: JSON.stringify(input) });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: warId, hint: "history_updated" });
    return ok(toWarHistoryPayload(updated));
  }

  async deleteHistory(actorId: string, warId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getWarHistoryById(warId);
    if (!existing) return err("NOT_FOUND", "War history not found");
    const { rawDb } = this.deps;
    const teamIds = (await this.db.select({ id: warTeams.id }).from(warTeams).where(eq(warTeams.warHistoryId, warId))).map((r) => r.id);
    const stmts: D1PreparedStatement[] = [];
    for (const teamId of teamIds) stmts.push(rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id = ?1").bind(teamId));
    stmts.push(rawDb.prepare("DELETE FROM war_teams WHERE war_history_id = ?1").bind(warId));
    stmts.push(rawDb.prepare("DELETE FROM war_pool_members WHERE war_history_id = ?1").bind(warId));
    stmts.push(rawDb.prepare("DELETE FROM war_history WHERE id = ?1").bind(warId));
    await rawDb.batch(stmts);
    await this.deps.writeAuditLog({ entityType: "guild_war_history", action: "delete", actorId, entityId: warId, diffTitle: existing.warName });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: warId, hint: "history_deleted" });
    return ok({ ok: true });
  }

  async batchDeleteHistory(actorId: string, warIds: string[]): Promise<ServiceResult<{ ok: true; deleted: number }>> {
    if (warIds.length === 0) return ok({ ok: true, deleted: 0 });
    const { rawDb } = this.deps;

    const existingRows = await this.db
      .select({ id: warHistory.id, warName: warHistory.warName })
      .from(warHistory)
      .where(inArray(warHistory.id, warIds));
    const existingIds = existingRows.map((r) => r.id);
    if (existingIds.length === 0) return ok({ ok: true, deleted: 0 });

    const allTeamRows = await this.db
      .select({ id: warTeams.id })
      .from(warTeams)
      .where(inArray(warTeams.warHistoryId, existingIds));
    const allTeamIds = allTeamRows.map((r) => r.id);

    const stmts: D1PreparedStatement[] = [];
    for (const teamId of allTeamIds) {
      stmts.push(rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id = ?1").bind(teamId));
    }
    for (const warId of existingIds) {
      stmts.push(rawDb.prepare("DELETE FROM war_teams WHERE war_history_id = ?1").bind(warId));
      stmts.push(rawDb.prepare("DELETE FROM war_pool_members WHERE war_history_id = ?1").bind(warId));
      stmts.push(rawDb.prepare("DELETE FROM war_history WHERE id = ?1").bind(warId));
    }
    await rawDb.batch(stmts);

    for (const row of existingRows) {
      await this.deps.writeAuditLog({ entityType: "guild_war_history", action: "delete", actorId, entityId: row.id, diffTitle: row.warName });
      await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: row.id, hint: "history_deleted" });
    }
    return ok({ ok: true, deleted: existingIds.length });
  }

  async updateMemberStats(actorId: string, warId: string, targetUserId: string, input: z.infer<typeof updateMemberStatsSchema>): Promise<ServiceResult<unknown>> {
    const existingHistory = await this.getWarHistoryById(warId);
    if (!existingHistory) return err("NOT_FOUND", "War history not found");
    const memberRow = (await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, stats: warTeamMembers.stats, note: warTeamMembers.note }).from(warTeamMembers).innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId)).where(and(eq(warTeams.warHistoryId, warId), eq(warTeamMembers.userId, targetUserId))).limit(1))[0];
    if (!memberRow) return err("NOT_FOUND", "Team member not found in selected war history");
    const patch: Partial<typeof warTeamMembers.$inferInsert> = {};
    if (input.stats !== undefined) patch.stats = input.stats;
    if (input.note !== undefined) patch.note = input.note;
    await this.db.update(warTeamMembers).set(patch).where(eq(warTeamMembers.id, memberRow.id));
    const refreshed = (await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, stats: warTeamMembers.stats, note: warTeamMembers.note }).from(warTeamMembers).where(eq(warTeamMembers.id, memberRow.id)).limit(1))[0];
    if (!refreshed) return err("SERVER_ERROR", "Failed to load updated member stats");
    const targetUser = (await this.db.select({ username: users.username }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    await this.deps.writeAuditLog({ entityType: "guild_war_member_stats", action: "update", actorId, entityId: `${warId}:${targetUserId}`, diffTitle: targetUser?.username ?? null, detailText: JSON.stringify(input) });
    return ok(toMemberPayload(refreshed));
  }

  async batchUpdateMemberStats(actorId: string, warId: string, updates: Array<{ user_id: string; stats: unknown }>): Promise<ServiceResult<{ data: unknown[] }>> {
    const existingHistory = await this.getWarHistoryById(warId);
    if (!existingHistory) return err("NOT_FOUND", "War history not found");
    const userIds = updates.map((u) => u.user_id).filter((id) => typeof id === "string" && id.length > 0);
    const memberRows = await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, stats: warTeamMembers.stats, note: warTeamMembers.note }).from(warTeamMembers).innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId)).where(and(eq(warTeams.warHistoryId, warId), inArray(warTeamMembers.userId, userIds)));
    const memberByUserId = new Map(memberRows.map((m) => [m.userId, m]));
    const results: ReturnType<typeof toMemberPayload>[] = [];

    type PatchEntry = { memberRow: WarTeamMemberRow; patch: Partial<typeof warTeamMembers.$inferInsert> };
    const pendingPatches: PatchEntry[] = [];

    for (const update of updates) {
      const memberRow = memberByUserId.get(update.user_id);
      if (!memberRow) continue;
      const parsed = updateMemberStatsSchema.safeParse(update.stats);
      if (!parsed.success) continue;
      const patch: Partial<typeof warTeamMembers.$inferInsert> = {};
      if (parsed.data.stats !== undefined) patch.stats = parsed.data.stats;
      if (parsed.data.note !== undefined) patch.note = parsed.data.note;
      if (Object.keys(patch).length > 0) {
        pendingPatches.push({ memberRow, patch });
      } else {
        results.push(toMemberPayload(memberRow));
      }
    }

    if (pendingPatches.length > 0) {
      const { rawDb } = this.deps;
      const stmts: D1PreparedStatement[] = pendingPatches.map(({ memberRow, patch }) => {
        const setClauses: string[] = [];
        const bindings: unknown[] = [];
        let paramIdx = 1;
        if (patch.stats !== undefined) { setClauses.push(`stats = ?${paramIdx++}`); bindings.push(JSON.stringify(patch.stats)); }
        if (patch.note !== undefined) { setClauses.push(`note = ?${paramIdx++}`); bindings.push(patch.note); }
        bindings.push(memberRow.id);
        return (rawDb.prepare(`UPDATE war_team_members SET ${setClauses.join(", ")} WHERE id = ?${paramIdx}`) as D1PreparedStatement).bind(...(bindings as Parameters<D1PreparedStatement["bind"]>));
      });
      await rawDb.batch(stmts);
      for (const { memberRow, patch } of pendingPatches) {
        const merged: WarTeamMemberRow = { ...memberRow, ...patch as Partial<WarTeamMemberRow> };
        results.push(toMemberPayload(merged));
      }
    }

    const targetNames = await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds));
    await this.deps.writeAuditLog({ entityType: "guild_war_member_stats", action: "batch_update", actorId, entityId: warId, diffTitle: targetNames.map((r) => r.username).join(", "), detailText: JSON.stringify({ count: results.length, user_ids: userIds, usernames: targetNames.map((r) => r.username) }) });
    return ok({ data: results });
  }

  async getAnalytics(warIds: string[], userIds: string[]): Promise<ServiceResult<{ wars: unknown[]; member_stats: unknown[]; analytics_settings: AnalyticsSettings }>> {
    const warFilters: SQL<unknown>[] = [];
    if (warIds.length > 0) warFilters.push(inArray(warHistory.id, warIds));
    const wars = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(warFilters.length > 0 ? and(...warFilters) : undefined).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(200);
    const historyIds = wars.map((w) => w.id);
    if (historyIds.length === 0) return ok({ wars: [], member_stats: [], analytics_settings: defaultAnalyticsSettings() });
    const teamSizeCounts = await this.db.select({ warHistoryId: warTeams.warHistoryId, memberCount: sql<number>`count(${warTeamMembers.id})`.as("member_count") }).from(warTeamMembers).innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId)).where(inArray(warTeams.warHistoryId, historyIds)).groupBy(warTeams.warHistoryId);
    const teamSizeMap = new Map<string, number>();
    for (const row of teamSizeCounts) teamSizeMap.set(row.warHistoryId, row.memberCount);
    const analyticsSettings = await this.readAnalyticsSettings();
    const warsWithModifier = wars.map((war) => {
      const teamSize = teamSizeMap.get(war.id) ?? 0;
      const modifier = computeWarModifier(war, teamSize, analyticsSettings);
      return { ...toWarHistoryPayload(war), team_size: teamSize, modifier: modifier.value, modifier_breakdown: modifier.breakdown };
    });
    const memberFilters: SQL<unknown>[] = [inArray(warTeams.warHistoryId, historyIds)];
    if (userIds.length > 0) memberFilters.push(inArray(warTeamMembers.userId, userIds));
    const members = await this.db.select({ userId: warTeamMembers.userId, stats: warTeamMembers.stats }).from(warTeamMembers).innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId)).where(and(...memberFilters));
    const aggregate = new Map<string, { user_id: string; stats: Record<string, number> }>();
    for (const row of members) {
      const s = row.stats ?? {};
      const current = aggregate.get(row.userId) ?? { user_id: row.userId, stats: {} };
      for (const [key, val] of Object.entries(s)) {
        current.stats[key] = (current.stats[key] ?? 0) + (val ?? 0);
      }
      aggregate.set(row.userId, current);
    }
    return ok({ wars: warsWithModifier, member_stats: Array.from(aggregate.values()), analytics_settings: analyticsSettings });
  }
}
