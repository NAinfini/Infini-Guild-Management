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
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { z } from "zod";
import {
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
  ownKills: number | null;
  ownTowers: number | null;
  ownBaseHp: number | null;
  ownCredits: number | null;
  ownDistance: number | null;
  enemyKills: number | null;
  enemyTowers: number | null;
  enemyBaseHp: number | null;
  enemyCredits: number | null;
  enemyDistance: number | null;
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
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  damage: number | null;
  healing: number | null;
  buildingDamage: number | null;
  credits: number | null;
  damageTaken: number | null;
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
    own_kills: toNum(row.ownKills), own_towers: toNum(row.ownTowers), own_base_hp: toNum(row.ownBaseHp),
    own_credits: toNum(row.ownCredits), own_distance: toNum(row.ownDistance),
    enemy_kills: toNum(row.enemyKills), enemy_towers: toNum(row.enemyTowers), enemy_base_hp: toNum(row.enemyBaseHp),
    enemy_credits: toNum(row.enemyCredits), enemy_distance: toNum(row.enemyDistance),
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
    sort_order: toNum(row.sortOrder) ?? 0, kills: toNum(row.kills), deaths: toNum(row.deaths),
    assists: toNum(row.assists), damage: toNum(row.damage), healing: toNum(row.healing),
    building_damage: toNum(row.buildingDamage), credits: toNum(row.credits),
    damage_taken: toNum(row.damageTaken), note: row.note,
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
  const headers = ["id","event_id","war_name","enemy_name","result","own_kills","enemy_kills","own_towers","enemy_towers","own_base_hp","enemy_base_hp","own_credits","enemy_credits","own_distance","enemy_distance","duration_minutes","notes","created_by","created_by_username","created_at","updated_at"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push([toCsvCell(row.id),toCsvCell(row.eventId),toCsvCell(row.warName),toCsvCell(row.enemyName),toCsvCell(row.result),toCsvCell(row.ownKills),toCsvCell(row.enemyKills),toCsvCell(row.ownTowers),toCsvCell(row.enemyTowers),toCsvCell(row.ownBaseHp),toCsvCell(row.enemyBaseHp),toCsvCell(row.ownCredits),toCsvCell(row.enemyCredits),toCsvCell(row.ownDistance),toCsvCell(row.enemyDistance),toCsvCell(row.durationMinutes),toCsvCell(row.notes),toCsvCell(row.createdBy),toCsvCell(creatorMap.get(row.createdBy ?? "") ?? row.createdBy),toCsvCell(row.createdAt),toCsvCell(row.updatedAt)].join(","));
  }
  return lines.join("\n");
}

function computeWarModifier(
  war: { ownKills: number | null; ownTowers: number | null; ownBaseHp: number | null; ownCredits: number | null; ownDistance: number | null; enemyKills: number | null; enemyTowers: number | null; enemyBaseHp: number | null; enemyCredits: number | null; enemyDistance: number | null },
  _ownTeamSize: number, settings: AnalyticsSettings,
): { value: number; breakdown: ModifierBreakdown[] } {
  // Note: Previously some factors used perCapita which divided only ownVal by
  // ownTeamSize, mixing per-capita and total units. Enemy team size is not
  // tracked in the schema, so we use raw totals for both sides to keep units
  // consistent. The ratio thus reflects total team performance comparison.
  const factors = [
    { key: "kda", weight: settings.modifier_weight_kda, ownVal: war.ownKills, enemyVal: war.enemyKills },
    { key: "towers", weight: settings.modifier_weight_towers, ownVal: war.ownTowers, enemyVal: war.enemyTowers },
    { key: "credits", weight: settings.modifier_weight_credits, ownVal: war.ownCredits, enemyVal: war.enemyCredits },
    { key: "distance", weight: settings.modifier_weight_distance, ownVal: war.ownDistance, enemyVal: war.enemyDistance },
    { key: "basehp", weight: settings.modifier_weight_basehp, ownVal: war.ownBaseHp, enemyVal: war.enemyBaseHp },
  ];
  const valid: Array<{ key: string; weight: number; ratio: number }> = [];
  for (const f of factors) {
    if (f.weight <= 0 || f.ownVal === null || f.enemyVal === null) continue;
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
      return {
        reference_duration_minutes: typeof record.reference_duration_minutes === "number" && record.reference_duration_minutes > 0 ? record.reference_duration_minutes : defaults.reference_duration_minutes,
        modifier_weight_kda: typeof record.modifier_weight_kda === "number" ? record.modifier_weight_kda : defaults.modifier_weight_kda,
        modifier_weight_towers: typeof record.modifier_weight_towers === "number" ? record.modifier_weight_towers : defaults.modifier_weight_towers,
        modifier_weight_credits: typeof record.modifier_weight_credits === "number" ? record.modifier_weight_credits : defaults.modifier_weight_credits,
        modifier_weight_distance: typeof record.modifier_weight_distance === "number" ? record.modifier_weight_distance : defaults.modifier_weight_distance,
        modifier_weight_basehp: typeof record.modifier_weight_basehp === "number" ? record.modifier_weight_basehp : defaults.modifier_weight_basehp,
      };
    } catch { return defaultAnalyticsSettings(); }
  }

  // --- DB query methods ---

  async getWarHistoryById(warId: string): Promise<WarHistoryRow | null> {
    const row = (await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownKills: warHistory.ownKills, ownTowers: warHistory.ownTowers, ownBaseHp: warHistory.ownBaseHp, ownCredits: warHistory.ownCredits, ownDistance: warHistory.ownDistance, enemyKills: warHistory.enemyKills, enemyTowers: warHistory.enemyTowers, enemyBaseHp: warHistory.enemyBaseHp, enemyCredits: warHistory.enemyCredits, enemyDistance: warHistory.enemyDistance, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(eq(warHistory.id, warId)).limit(1))[0];
    return row ?? null;
  }

  async getLatestWarHistory(eventId?: string): Promise<WarHistoryRow | null> {
    const rows = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownKills: warHistory.ownKills, ownTowers: warHistory.ownTowers, ownBaseHp: warHistory.ownBaseHp, ownCredits: warHistory.ownCredits, ownDistance: warHistory.ownDistance, enemyKills: warHistory.enemyKills, enemyTowers: warHistory.enemyTowers, enemyBaseHp: warHistory.enemyBaseHp, enemyCredits: warHistory.enemyCredits, enemyDistance: warHistory.enemyDistance, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(eventId ? eq(warHistory.eventId, eventId) : undefined).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(1);
    return rows[0] ?? null;
  }

  async getTeamsForHistory(warHistoryId: string): Promise<WarTeamRow[]> {
    return await this.db.select({ id: warTeams.id, warHistoryId: warTeams.warHistoryId, teamName: warTeams.teamName, sortOrder: warTeams.sortOrder, notes: warTeams.notes, isLocked: warTeams.isLocked }).from(warTeams).where(eq(warTeams.warHistoryId, warHistoryId)).orderBy(asc(warTeams.sortOrder), asc(warTeams.id));
  }

  async getMembersForTeams(teamIds: string[]): Promise<WarTeamMemberRow[]> {
    if (teamIds.length === 0) return [];
    return await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, kills: warTeamMembers.kills, deaths: warTeamMembers.deaths, assists: warTeamMembers.assists, damage: warTeamMembers.damage, healing: warTeamMembers.healing, buildingDamage: warTeamMembers.buildingDamage, credits: warTeamMembers.credits, damageTaken: warTeamMembers.damageTaken, note: warTeamMembers.note }).from(warTeamMembers).where(inArray(warTeamMembers.warTeamId, teamIds)).orderBy(asc(warTeamMembers.sortOrder), asc(warTeamMembers.id));
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

  async getActive(eventId?: string): Promise<ServiceResult<unknown>> {
    const activeWar = await this.getLatestWarHistory(eventId);
    if (!activeWar) return ok({ event: null, teams: [], pool: [], etag: null });
    const teams = await this.getTeamsForHistory(activeWar.id);
    const teamIds = teams.map((t) => t.id);
    const members = await this.getMembersForTeams(teamIds);
    const pool = await this.getPoolMembers(activeWar.id);
    let eventPayload: EventPayload = null;
    if (activeWar.eventId) {
      const eventRow = (await this.db.select({ id: events.id, type: events.type, title: events.title, description: events.description, startAt: events.startAt, endAt: events.endAt, capacity: events.capacity, pinned: events.pinned, signupLocked: events.signupLocked, archivedAt: events.archivedAt, createdBy: events.createdBy, recurrenceRule: events.recurrenceRule, seriesId: events.seriesId, isSeriesParent: events.isSeriesParent, instanceDate: events.instanceDate, createdAt: events.createdAt, updatedAt: events.updatedAt }).from(events).where(eq(events.id, activeWar.eventId)).limit(1))[0];
      if (eventRow) {
        eventPayload = eventSchema.parse({ id: eventRow.id, type: eventRow.type, title: eventRow.title, description: eventRow.description, start_at: eventRow.startAt, end_at: eventRow.endAt, capacity: eventRow.capacity, pinned: eventRow.pinned, signup_locked: eventRow.signupLocked, archived_at: eventRow.archivedAt, created_by: eventRow.createdBy, recurrence_rule: parseRecurrenceRule(eventRow.recurrenceRule), series_id: eventRow.seriesId, is_series_parent: eventRow.isSeriesParent, instance_date: eventRow.instanceDate, created_at: eventRow.createdAt, updated_at: eventRow.updatedAt });
      }
    }
    const etag = buildWarEtag(activeWar.id, activeWar.updatedAt);
    return ok({
      war_history: toWarHistoryPayload(activeWar), event: eventPayload, etag,
      teams: teams.map((team) => ({ ...toTeamPayload(team), members: members.filter((m) => m.warTeamId === team.id).map(toMemberPayload) })),
      pool: pool.map((p) => ({ id: p.id, warHistoryId: p.warHistoryId, userId: p.userId })),
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
    await this.deps.writeAuditLog({ entityType: "guild_war", action: "save_teams", actorId, entityId: refreshed.id, detailText: JSON.stringify({ event_id: payload.event_id }) });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: refreshed.id, hint: "teams_saved" });
    return ok(refreshed);
  }

  async moveMember(actorId: string, eventId: string, userId: string, to: string, conditionalEtag?: string): Promise<ServiceResult<{ ok: true }>> {
    const activeHistory = await this.getLatestWarHistory(eventId);
    if (!activeHistory) return err("NOT_FOUND", "Active war history not found");
    if (conditionalEtag) {
      const expectedEtag = buildWarEtag(activeHistory.id, activeHistory.updatedAt);
      if (conditionalEtag !== expectedEtag) return err("CONFLICT", "Guild war roster changed, refresh and retry", { expected_etag: expectedEtag });
    }
    const teams = await this.getTeamsForHistory(activeHistory.id);
    const teamIds = teams.map((t) => t.id);
    const nowIso = new Date().toISOString();
    const { rawDb } = this.deps;

    const stmts: D1PreparedStatement[] = [];
    for (const tid of teamIds) stmts.push(rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id = ?1 AND user_id = ?2").bind(tid, userId));
    stmts.push(rawDb.prepare("DELETE FROM war_pool_members WHERE war_history_id = ?1 AND user_id = ?2").bind(activeHistory.id, userId));
    if (to === "pool") {
      stmts.push(rawDb.prepare("INSERT INTO war_pool_members (id, war_history_id, user_id) VALUES (?1, ?2, ?3)").bind(nanoid(), activeHistory.id, userId));
    } else {
      const targetTeam = teams.find((t) => t.id === to);
      if (!targetTeam) return err("NOT_FOUND", "Target team not found");
      const maxRow = (await this.db.select({ maxSort: sql<number>`coalesce(max(${warTeamMembers.sortOrder}), -1)` }).from(warTeamMembers).where(eq(warTeamMembers.warTeamId, targetTeam.id)))[0];
      const nextSort = Number(maxRow?.maxSort ?? -1) + 1;
      stmts.push(rawDb.prepare("INSERT INTO war_team_members (id, war_team_id, user_id, sort_order) VALUES (?1, ?2, ?3, ?4)").bind(nanoid(), targetTeam.id, userId, nextSort));
    }
    stmts.push(rawDb.prepare("UPDATE war_history SET updated_at = ?1 WHERE id = ?2").bind(nowIso, activeHistory.id));
    await rawDb.batch(stmts);
    await this.deps.writeAuditLog({ entityType: "guild_war", action: "move_member", actorId, entityId: activeHistory.id, detailText: JSON.stringify({ user_id: userId, to }) });
    return ok({ ok: true });
  }

  async setRoleTag(actorId: string, eventId: string, userId: string, roleTag: string | null): Promise<ServiceResult<{ ok: true }>> {
    const activeHistory = await this.getLatestWarHistory(eventId);
    if (!activeHistory) return err("NOT_FOUND", "Active war history not found");
    const memberRow = (await this.db.select({ id: warTeamMembers.id }).from(warTeamMembers).innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId)).where(and(eq(warTeams.warHistoryId, activeHistory.id), eq(warTeamMembers.userId, userId))).limit(1))[0];
    if (!memberRow) return err("NOT_FOUND", "Member not found in active teams");
    const nextTag = typeof roleTag === "string" && roleTag.trim().length > 0 ? roleTag.trim() : null;
    await this.db.update(warTeamMembers).set({ roleTag: nextTag }).where(eq(warTeamMembers.id, memberRow.id));
    await this.db.update(warHistory).set({ updatedAt: new Date().toISOString() }).where(eq(warHistory.id, activeHistory.id));
    await this.deps.writeAuditLog({ entityType: "guild_war", action: "set_role_tag", actorId, entityId: activeHistory.id, detailText: JSON.stringify({ user_id: userId, role_tag: nextTag }) });
    return ok({ ok: true });
  }

  async exportHistory(format: "csv" | "json", filters: { dateFrom?: string; dateTo?: string; eventId?: string }): Promise<ServiceResult<{ content: string; contentType: string; filename: string }>> {
    const where: SQL<unknown>[] = [];
    if (filters.dateFrom) where.push(gte(warHistory.createdAt, filters.dateFrom));
    if (filters.dateTo) where.push(lte(warHistory.createdAt, filters.dateTo));
    if (filters.eventId) where.push(eq(warHistory.eventId, filters.eventId));
    const rows = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownKills: warHistory.ownKills, ownTowers: warHistory.ownTowers, ownBaseHp: warHistory.ownBaseHp, ownCredits: warHistory.ownCredits, ownDistance: warHistory.ownDistance, enemyKills: warHistory.enemyKills, enemyTowers: warHistory.enemyTowers, enemyBaseHp: warHistory.enemyBaseHp, enemyCredits: warHistory.enemyCredits, enemyDistance: warHistory.enemyDistance, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(where.length > 0 ? and(...where) : undefined).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(5000);
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
    const rows = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownKills: warHistory.ownKills, ownTowers: warHistory.ownTowers, ownBaseHp: warHistory.ownBaseHp, ownCredits: warHistory.ownCredits, ownDistance: warHistory.ownDistance, enemyKills: warHistory.enemyKills, enemyTowers: warHistory.enemyTowers, enemyBaseHp: warHistory.enemyBaseHp, enemyCredits: warHistory.enemyCredits, enemyDistance: warHistory.enemyDistance, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt, _total: sql<number>`count(*) over()` }).from(warHistory).where(whereClause).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(limit).offset(offset);
    const total = Number((rows[0] as Record<string, unknown> | undefined)?._total ?? 0);
    return ok({ data: rows.map(toWarHistoryPayload), total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)) });
  }

  async batchHistory(ids: string[]): Promise<ServiceResult<{ data: unknown[] }>> {
    const histories = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownKills: warHistory.ownKills, ownTowers: warHistory.ownTowers, ownBaseHp: warHistory.ownBaseHp, ownCredits: warHistory.ownCredits, ownDistance: warHistory.ownDistance, enemyKills: warHistory.enemyKills, enemyTowers: warHistory.enemyTowers, enemyBaseHp: warHistory.enemyBaseHp, enemyCredits: warHistory.enemyCredits, enemyDistance: warHistory.enemyDistance, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(inArray(warHistory.id, ids));
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
    await this.db.insert(warHistory).values({ id: historyId, eventId: input.event_id ?? null, warName: input.war_name, enemyName: input.enemy_name ?? null, result: input.result ?? null, ownKills: input.own_kills ?? null, ownTowers: input.own_towers ?? null, ownBaseHp: input.own_base_hp ?? null, ownCredits: input.own_credits ?? null, ownDistance: input.own_distance ?? null, enemyKills: input.enemy_kills ?? null, enemyTowers: input.enemy_towers ?? null, enemyBaseHp: input.enemy_base_hp ?? null, enemyCredits: input.enemy_credits ?? null, enemyDistance: input.enemy_distance ?? null, notes: input.notes ?? null, createdBy: actorId });
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
    if (input.own_kills !== undefined) patch.ownKills = input.own_kills;
    if (input.own_towers !== undefined) patch.ownTowers = input.own_towers;
    if (input.own_base_hp !== undefined) patch.ownBaseHp = input.own_base_hp;
    if (input.own_credits !== undefined) patch.ownCredits = input.own_credits;
    if (input.own_distance !== undefined) patch.ownDistance = input.own_distance;
    if (input.enemy_kills !== undefined) patch.enemyKills = input.enemy_kills;
    if (input.enemy_towers !== undefined) patch.enemyTowers = input.enemy_towers;
    if (input.enemy_base_hp !== undefined) patch.enemyBaseHp = input.enemy_base_hp;
    if (input.enemy_credits !== undefined) patch.enemyCredits = input.enemy_credits;
    if (input.enemy_distance !== undefined) patch.enemyDistance = input.enemy_distance;
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
    const memberRow = (await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, kills: warTeamMembers.kills, deaths: warTeamMembers.deaths, assists: warTeamMembers.assists, damage: warTeamMembers.damage, healing: warTeamMembers.healing, buildingDamage: warTeamMembers.buildingDamage, credits: warTeamMembers.credits, damageTaken: warTeamMembers.damageTaken, note: warTeamMembers.note }).from(warTeamMembers).innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId)).where(and(eq(warTeams.warHistoryId, warId), eq(warTeamMembers.userId, targetUserId))).limit(1))[0];
    if (!memberRow) return err("NOT_FOUND", "Team member not found in selected war history");
    const patch: Partial<typeof warTeamMembers.$inferInsert> = {};
    if (input.kills !== undefined) patch.kills = input.kills;
    if (input.deaths !== undefined) patch.deaths = input.deaths;
    if (input.assists !== undefined) patch.assists = input.assists;
    if (input.damage !== undefined) patch.damage = input.damage;
    if (input.healing !== undefined) patch.healing = input.healing;
    if (input.building_damage !== undefined) patch.buildingDamage = input.building_damage;
    if (input.credits !== undefined) patch.credits = input.credits;
    if (input.damage_taken !== undefined) patch.damageTaken = input.damage_taken;
    if (input.note !== undefined) patch.note = input.note;
    await this.db.update(warTeamMembers).set(patch).where(eq(warTeamMembers.id, memberRow.id));
    const refreshed = (await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, kills: warTeamMembers.kills, deaths: warTeamMembers.deaths, assists: warTeamMembers.assists, damage: warTeamMembers.damage, healing: warTeamMembers.healing, buildingDamage: warTeamMembers.buildingDamage, credits: warTeamMembers.credits, damageTaken: warTeamMembers.damageTaken, note: warTeamMembers.note }).from(warTeamMembers).where(eq(warTeamMembers.id, memberRow.id)).limit(1))[0];
    if (!refreshed) return err("SERVER_ERROR", "Failed to load updated member stats");
    await this.deps.writeAuditLog({ entityType: "guild_war_member_stats", action: "update", actorId, entityId: `${warId}:${targetUserId}`, detailText: JSON.stringify(input) });
    return ok(toMemberPayload(refreshed));
  }

  async batchUpdateMemberStats(actorId: string, warId: string, updates: Array<{ user_id: string; stats: unknown }>): Promise<ServiceResult<{ data: unknown[] }>> {
    const existingHistory = await this.getWarHistoryById(warId);
    if (!existingHistory) return err("NOT_FOUND", "War history not found");
    const userIds = updates.map((u) => u.user_id).filter((id) => typeof id === "string" && id.length > 0);
    const memberRows = await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, kills: warTeamMembers.kills, deaths: warTeamMembers.deaths, assists: warTeamMembers.assists, damage: warTeamMembers.damage, healing: warTeamMembers.healing, buildingDamage: warTeamMembers.buildingDamage, credits: warTeamMembers.credits, damageTaken: warTeamMembers.damageTaken, note: warTeamMembers.note }).from(warTeamMembers).innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId)).where(and(eq(warTeams.warHistoryId, warId), inArray(warTeamMembers.userId, userIds)));
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
      if (parsed.data.kills !== undefined) patch.kills = parsed.data.kills;
      if (parsed.data.deaths !== undefined) patch.deaths = parsed.data.deaths;
      if (parsed.data.assists !== undefined) patch.assists = parsed.data.assists;
      if (parsed.data.damage !== undefined) patch.damage = parsed.data.damage;
      if (parsed.data.healing !== undefined) patch.healing = parsed.data.healing;
      if (parsed.data.building_damage !== undefined) patch.buildingDamage = parsed.data.building_damage;
      if (parsed.data.credits !== undefined) patch.credits = parsed.data.credits;
      if (parsed.data.damage_taken !== undefined) patch.damageTaken = parsed.data.damage_taken;
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
        if (patch.kills !== undefined) { setClauses.push(`kills = ?${paramIdx++}`); bindings.push(patch.kills); }
        if (patch.deaths !== undefined) { setClauses.push(`deaths = ?${paramIdx++}`); bindings.push(patch.deaths); }
        if (patch.assists !== undefined) { setClauses.push(`assists = ?${paramIdx++}`); bindings.push(patch.assists); }
        if (patch.damage !== undefined) { setClauses.push(`damage = ?${paramIdx++}`); bindings.push(patch.damage); }
        if (patch.healing !== undefined) { setClauses.push(`healing = ?${paramIdx++}`); bindings.push(patch.healing); }
        if (patch.buildingDamage !== undefined) { setClauses.push(`building_damage = ?${paramIdx++}`); bindings.push(patch.buildingDamage); }
        if (patch.credits !== undefined) { setClauses.push(`credits = ?${paramIdx++}`); bindings.push(patch.credits); }
        if (patch.damageTaken !== undefined) { setClauses.push(`damage_taken = ?${paramIdx++}`); bindings.push(patch.damageTaken); }
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

    await this.deps.writeAuditLog({ entityType: "guild_war_member_stats", action: "batch_update", actorId, entityId: warId, detailText: JSON.stringify({ count: results.length, user_ids: userIds }) });
    return ok({ data: results });
  }

  async getAnalytics(warIds: string[], userIds: string[]): Promise<ServiceResult<{ wars: unknown[]; member_stats: unknown[]; analytics_settings: AnalyticsSettings }>> {
    const warFilters: SQL<unknown>[] = [];
    if (warIds.length > 0) warFilters.push(inArray(warHistory.id, warIds));
    const wars = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownKills: warHistory.ownKills, ownTowers: warHistory.ownTowers, ownBaseHp: warHistory.ownBaseHp, ownCredits: warHistory.ownCredits, ownDistance: warHistory.ownDistance, enemyKills: warHistory.enemyKills, enemyTowers: warHistory.enemyTowers, enemyBaseHp: warHistory.enemyBaseHp, enemyCredits: warHistory.enemyCredits, enemyDistance: warHistory.enemyDistance, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(warFilters.length > 0 ? and(...warFilters) : undefined).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(200);
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
    const members = await this.db.select({ userId: warTeamMembers.userId, kills: warTeamMembers.kills, deaths: warTeamMembers.deaths, assists: warTeamMembers.assists, damage: warTeamMembers.damage, healing: warTeamMembers.healing, buildingDamage: warTeamMembers.buildingDamage, credits: warTeamMembers.credits, damageTaken: warTeamMembers.damageTaken }).from(warTeamMembers).innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId)).where(and(...memberFilters));
    const aggregate = new Map<string, { user_id: string; kills: number; deaths: number; assists: number; damage: number; healing: number; building_damage: number; credits: number; damage_taken: number }>();
    for (const row of members) {
      const current = aggregate.get(row.userId) ?? { user_id: row.userId, kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, building_damage: 0, credits: 0, damage_taken: 0 };
      current.kills += row.kills ?? 0; current.deaths += row.deaths ?? 0; current.assists += row.assists ?? 0;
      current.damage += row.damage ?? 0; current.healing += row.healing ?? 0; current.building_damage += row.buildingDamage ?? 0;
      current.credits += row.credits ?? 0; current.damage_taken += row.damageTaken ?? 0;
      aggregate.set(row.userId, current);
    }
    return ok({ wars: warsWithModifier, member_stats: Array.from(aggregate.values()), analytics_settings: analyticsSettings });
  }
}
