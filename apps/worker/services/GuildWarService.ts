import {
  botSettingsSchema,
  createWarHistorySchema,
  eventSchema,
  saveTeamsPayloadSchema,
  updateMemberStatsSchema,
  updateWarHistorySchema,
  warHistorySchema,
  warTeamMemberSchema,
  warTeamSchema,
  warTemplateSchema,
} from "@guild/shared";
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { z } from "zod";
import {
  eventParticipants,
  events,
  warHistory,
  warPoolMembers,
  warTeamMembers,
  warTeams,
  warTemplates,
} from "../db/schema";
import { ok, err, type ServiceResult } from "./result";

// --- Types (single source of truth) ---

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

export type WarTemplateRow = {
  id: string;
  templateName: string;
  description: string | null;
  templateType: string;
  sourceEventId: string | null;
  payloadJson: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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

export type StructureTemplatePayload = {
  teams: Array<{ team_name: string; sort_order: number; notes?: string }>;
};

export type MemberTemplatePayload = {
  user_ids: string[];
};

type BotSettings = {
  discord: { guild_id: string; notification_channel_id: string; team_comp_channel_id: string; default_toggles: Record<string, boolean> };
  wechat: { room_ids: string[]; default_toggles: Record<string, boolean> };
};

export type AnalyticsSettings = {
  reference_duration_minutes: number;
  modifier_weight_kda: number;
  modifier_weight_towers: number;
  modifier_weight_credits: number;
  modifier_weight_distance: number;
  modifier_weight_basehp: number;
};

type ModifierBreakdown = { factor: string; ratio: number; weight: number; contribution: number };

type AuditLogInput = { entityType: string; action: string; actorId: string; entityId: string; diffTitle?: string | null; detailText?: string | null };
type BotPlatform = "discord" | "wechat";
type BotTaskType = "event_notify" | "team_comp" | "reminder" | "war_result";
type BotTaskInput = { platform: BotPlatform; taskType: BotTaskType; targetId: string; eventId: string | null; payload: Record<string, unknown>; idempotencyKey: string; dispatchNow: boolean };
type SaveTeamsInput = z.infer<typeof saveTeamsPayloadSchema>;
type EventPayload = z.infer<typeof eventSchema> | null;
type CreateWarHistoryInput = z.infer<typeof createWarHistorySchema>;
type UpdateWarHistoryInput = z.infer<typeof updateWarHistorySchema>;

export type GuildWarServiceDeps = {
  media: { get(key: string): Promise<{ text(): Promise<string> } | null> };
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  createBotTask: (input: BotTaskInput) => Promise<{ task_id: string }>;
  botRuntimeUrl: string;
  botSharedSecret: string;
  publishEntityChanged: (input: { entityType: string; entityId: string; hint: string }) => Promise<void>;
};

// --- Constants ---

const BOT_SETTINGS_KEY = "config/bot-settings.json";
const ANALYTICS_SETTINGS_KEY = "config/analytics-settings.json";
const TEAM_COMP_DEBOUNCE_BUCKET_MS = 30_000;

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

export function parseTemplateSnapshot(payloadJson: string): WarTemplateSnapshot {
  const parsed = JSON.parse(payloadJson) as unknown;
  const snapshot = typeof parsed === "object" && parsed !== null
    ? parsed as Record<string, unknown>
    : {};
  const rawTeams = Array.isArray(snapshot.teams) ? snapshot.teams : [];
  const normalized = saveTeamsPayloadSchema.parse({
    event_id: "template",
    ...snapshot,
    teams: rawTeams.map((t: Record<string, unknown>) => ({
      ...t,
      members: Array.isArray(t.members) ? t.members : [],
    })),
    pool_members: Array.isArray(snapshot.pool_members) ? snapshot.pool_members : [],
  });
  return { teams: normalized.teams, pool_members: normalized.pool_members };
}

export function buildTemplateSnapshot(teams: WarTeamRow[], members: WarTeamMemberRow[], poolMembers: Array<{ userId: string }>): WarTemplateSnapshot {
  return {
    teams: teams.map((team) => ({
      team_name: team.teamName, sort_order: team.sortOrder, notes: team.notes ?? undefined, is_locked: team.isLocked,
      members: members.filter((m) => m.warTeamId === team.id).map((m) => ({ user_id: m.userId, role_tag: m.roleTag ?? undefined, sort_order: m.sortOrder })),
    })),
    pool_members: poolMembers.map((item) => ({ user_id: item.userId })),
  };
}

export function toWarTemplatePayload(row: WarTemplateRow) {
  const isMembers = row.templateType === "members";
  if (isMembers) {
    const payload = JSON.parse(row.payloadJson) as MemberTemplatePayload;
    return warTemplateSchema.parse({
      id: row.id, template_name: row.templateName, template_type: "members",
      description: row.description, source_event_id: row.sourceEventId,
      team_count: 0, member_count: payload.user_ids?.length ?? 0,
      created_by: row.createdBy, created_at: row.createdAt, updated_at: row.updatedAt,
    });
  }
  const snapshot = parseTemplateSnapshot(row.payloadJson);
  return warTemplateSchema.parse({
    id: row.id, template_name: row.templateName, template_type: "structure",
    description: row.description, source_event_id: row.sourceEventId,
    team_count: snapshot.teams.length, member_count: snapshot.teams.reduce((t, team) => t + team.members.length, 0),
    created_by: row.createdBy, created_at: row.createdAt, updated_at: row.updatedAt,
  });
}

export function buildWarEtag(warId: string, updatedAt: string): string {
  return `"war-${warId}-${updatedAt}"`;
}

export function parseRecurrenceRule(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function defaultBotSettings(): BotSettings {
  return { discord: { guild_id: "", notification_channel_id: "", team_comp_channel_id: "", default_toggles: {} }, wechat: { room_ids: [], default_toggles: {} } };
}

export function defaultAnalyticsSettings(): AnalyticsSettings {
  return { reference_duration_minutes: 30, modifier_weight_kda: 0.30, modifier_weight_towers: 0.10, modifier_weight_credits: 0.30, modifier_weight_distance: 0.15, modifier_weight_basehp: 0.15 };
}

function normalizeRoomIds(settings: BotSettings): string[] {
  return Array.from(new Set(settings.wechat.room_ids.map((r) => r.trim()).filter(Boolean)));
}

function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function buildWarHistoryCsv(rows: WarHistoryRow[]): string {
  const headers = ["id","event_id","war_name","enemy_name","result","own_kills","enemy_kills","own_towers","enemy_towers","own_base_hp","enemy_base_hp","own_credits","enemy_credits","own_distance","enemy_distance","duration_minutes","notes","created_by","created_at","updated_at"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push([toCsvCell(row.id),toCsvCell(row.eventId),toCsvCell(row.warName),toCsvCell(row.enemyName),toCsvCell(row.result),toCsvCell(row.ownKills),toCsvCell(row.enemyKills),toCsvCell(row.ownTowers),toCsvCell(row.enemyTowers),toCsvCell(row.ownBaseHp),toCsvCell(row.enemyBaseHp),toCsvCell(row.ownCredits),toCsvCell(row.enemyCredits),toCsvCell(row.ownDistance),toCsvCell(row.enemyDistance),toCsvCell(row.durationMinutes),toCsvCell(row.notes),toCsvCell(row.createdBy),toCsvCell(row.createdAt),toCsvCell(row.updatedAt)].join(","));
  }
  return lines.join("\n");
}

function computeWarModifier(
  war: { ownKills: number | null; ownTowers: number | null; ownBaseHp: number | null; ownCredits: number | null; ownDistance: number | null; enemyKills: number | null; enemyTowers: number | null; enemyBaseHp: number | null; enemyCredits: number | null; enemyDistance: number | null },
  ownTeamSize: number, settings: AnalyticsSettings,
): { value: number; breakdown: ModifierBreakdown[] } {
  const factors = [
    { key: "kda", weight: settings.modifier_weight_kda, ownVal: war.ownKills, enemyVal: war.enemyKills, perCapita: true },
    { key: "towers", weight: settings.modifier_weight_towers, ownVal: war.ownTowers, enemyVal: war.enemyTowers, perCapita: false },
    { key: "credits", weight: settings.modifier_weight_credits, ownVal: war.ownCredits, enemyVal: war.enemyCredits, perCapita: true },
    { key: "distance", weight: settings.modifier_weight_distance, ownVal: war.ownDistance, enemyVal: war.enemyDistance, perCapita: true },
    { key: "basehp", weight: settings.modifier_weight_basehp, ownVal: war.ownBaseHp, enemyVal: war.enemyBaseHp, perCapita: false },
  ];
  const valid: Array<{ key: string; weight: number; ratio: number }> = [];
  for (const f of factors) {
    if (f.weight <= 0 || f.ownVal === null || f.enemyVal === null) continue;
    let ownVal = f.ownVal, enemyVal = f.enemyVal;
    if (f.perCapita && ownTeamSize > 0) { ownVal /= ownTeamSize; enemyVal /= ownTeamSize; }
    valid.push({ key: f.key, weight: f.weight, ratio: enemyVal / Math.max(ownVal, 1) });
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

function buildTeamCompTaskPayload(history: WarHistoryRow, teams: WarTeamRow[], members: WarTeamMemberRow[], poolMembers: Array<{ userId: string }>): Record<string, unknown> {
  return {
    war_history_id: history.id, war_name: history.warName, enemy_name: history.enemyName, event_id: history.eventId,
    teams: teams.map((team) => ({ team_id: team.id, team_name: team.teamName, is_locked: team.isLocked, members: members.filter((m) => m.warTeamId === team.id).map((m) => ({ user_id: m.userId, role_tag: m.roleTag })) })),
    pool: poolMembers.map((item) => ({ user_id: item.userId })),
  };
}

function buildWarResultTaskPayload(history: WarHistoryRow, members: WarTeamMemberRow[]): Record<string, unknown> {
  const topDamage = [...members].sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0)).slice(0, 3).map((m) => ({ user_id: m.userId, damage: m.damage ?? 0 }));
  const topHealing = [...members].sort((a, b) => (b.healing ?? 0) - (a.healing ?? 0)).slice(0, 3).map((m) => ({ user_id: m.userId, healing: m.healing ?? 0 }));
  return {
    war_history_id: history.id, war_name: history.warName, enemy_name: history.enemyName, result: history.result,
    own_kills: history.ownKills, enemy_kills: history.enemyKills, own_towers: history.ownTowers, enemy_towers: history.enemyTowers,
    own_base_hp: history.ownBaseHp, enemy_base_hp: history.enemyBaseHp, own_credits: history.ownCredits, enemy_credits: history.enemyCredits,
    top_damage: topDamage, top_healing: topHealing,
  };
}

// --- Service class ---

export class GuildWarService {
  private db: DrizzleDb;
  private deps: GuildWarServiceDeps;

  constructor(db: DrizzleDb, deps: GuildWarServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  // --- Private: bot settings ---

  private async readBotSettings(): Promise<BotSettings> {
    const object = await this.deps.media.get(BOT_SETTINGS_KEY);
    if (!object) return defaultBotSettings();
    try {
      const parsed = JSON.parse(await object.text()) as unknown;
      return botSettingsSchema.parse(parsed);
    } catch { return defaultBotSettings(); }
  }

  private shouldDispatchNow(): boolean {
    return Boolean(this.deps.botRuntimeUrl.trim() && this.deps.botSharedSecret.trim());
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

  // --- Private: bot dispatch ---

  private async dispatchAutoTeamComp(history: WarHistoryRow, teams: WarTeamRow[], members: WarTeamMemberRow[], poolMembers: Array<{ userId: string }>): Promise<void> {
    const settings = await this.readBotSettings();
    const payload = buildTeamCompTaskPayload(history, teams, members, poolMembers);
    const dispatchNow = this.shouldDispatchNow();
    const debounceBucket = Math.floor(Date.now() / TEAM_COMP_DEBOUNCE_BUCKET_MS);
    const tasks: Promise<unknown>[] = [];
    const discordChannelId = settings.discord.team_comp_channel_id.trim();
    if (discordChannelId) {
      tasks.push(this.deps.createBotTask({ platform: "discord", taskType: "team_comp", targetId: discordChannelId, eventId: history.eventId, payload, idempotencyKey: `guild-war-team-comp:auto:discord:${history.id}:${debounceBucket}`, dispatchNow }));
    }
    for (const roomId of normalizeRoomIds(settings)) {
      tasks.push(this.deps.createBotTask({ platform: "wechat", taskType: "team_comp", targetId: roomId, eventId: history.eventId, payload, idempotencyKey: `guild-war-team-comp:auto:wechat:${history.id}:${roomId}:${debounceBucket}`, dispatchNow }));
    }
    await Promise.all(tasks);
  }

  private async dispatchAutoWarResult(history: WarHistoryRow, members: WarTeamMemberRow[]): Promise<void> {
    if (!history.result || history.result.trim().length === 0) return;
    const settings = await this.readBotSettings();
    const payload = buildWarResultTaskPayload(history, members);
    const dispatchNow = this.shouldDispatchNow();
    const dispatchKey = history.updatedAt || new Date().toISOString();
    const tasks: Promise<unknown>[] = [];
    const discordChannelId = settings.discord.notification_channel_id.trim() || settings.discord.team_comp_channel_id.trim();
    if (discordChannelId) {
      tasks.push(this.deps.createBotTask({ platform: "discord", taskType: "war_result", targetId: discordChannelId, eventId: history.eventId, payload, idempotencyKey: `guild-war-result:auto:discord:${history.id}:${dispatchKey}`, dispatchNow }));
    }
    for (const roomId of normalizeRoomIds(settings)) {
      tasks.push(this.deps.createBotTask({ platform: "wechat", taskType: "war_result", targetId: roomId, eventId: history.eventId, payload, idempotencyKey: `guild-war-result:auto:wechat:${history.id}:${roomId}:${dispatchKey}`, dispatchNow }));
    }
    await Promise.all(tasks);
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

  async getWarTemplateById(templateId: string): Promise<WarTemplateRow | null> {
    const row = (await this.db.select({ id: warTemplates.id, templateName: warTemplates.templateName, description: warTemplates.description, templateType: warTemplates.templateType, sourceEventId: warTemplates.sourceEventId, payloadJson: warTemplates.payloadJson, createdBy: warTemplates.createdBy, createdAt: warTemplates.createdAt, updatedAt: warTemplates.updatedAt }).from(warTemplates).where(eq(warTemplates.id, templateId)).limit(1))[0];
    return row ?? null;
  }

  async ensureWarHistoryForEvent(eventId: string, actorId: string): Promise<WarHistoryRow | null> {
    const existing = await this.getLatestWarHistory(eventId);
    if (existing) return existing;
    const historyId = nanoid();
    await this.db.insert(warHistory).values({ id: historyId, eventId, warName: `Guild War ${new Date().toISOString().slice(0, 10)}`, createdBy: actorId });
    return await this.getWarHistoryById(historyId);
  }

  async replaceHistoryTeams(warHistoryId: string, snapshot: WarTemplateSnapshot): Promise<void> {
    const existingTeams = await this.getTeamsForHistory(warHistoryId);
    const existingTeamIds = existingTeams.map((team) => team.id);
    if (existingTeamIds.length > 0) {
      await this.db.delete(warTeamMembers).where(inArray(warTeamMembers.warTeamId, existingTeamIds));
    }
    await this.db.delete(warTeams).where(eq(warTeams.warHistoryId, warHistoryId));
    await this.db.delete(warPoolMembers).where(eq(warPoolMembers.warHistoryId, warHistoryId));
    for (const team of snapshot.teams) {
      const teamId = nanoid();
      await this.db.insert(warTeams).values({ id: teamId, warHistoryId, teamName: team.team_name, sortOrder: team.sort_order, notes: team.notes ?? null, isLocked: team.is_locked ?? false });
      for (const member of team.members) {
        await this.db.insert(warTeamMembers).values({ id: nanoid(), warTeamId: teamId, userId: member.user_id, roleTag: member.role_tag ?? null, sortOrder: member.sort_order });
      }
    }
    for (const poolMember of snapshot.pool_members) {
      await this.db.insert(warPoolMembers).values({ id: nanoid(), warHistoryId, userId: poolMember.user_id });
    }
    await this.db.update(warHistory).set({ updatedAt: new Date().toISOString() }).where(eq(warHistory.id, warHistoryId));
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

  async saveTeams(actorId: string, payload: SaveTeamsInput): Promise<ServiceResult<WarHistoryRow>> {
    const activeHistory = await this.ensureWarHistoryForEvent(payload.event_id, actorId);
    if (!activeHistory) return err("SERVER_ERROR", "Failed to initialize war history");
    const snapshot: WarTemplateSnapshot = { teams: payload.teams, pool_members: payload.pool_members };
    await this.replaceHistoryTeams(activeHistory.id, snapshot);
    const refreshed = await this.getWarHistoryById(activeHistory.id);
    if (!refreshed) return err("SERVER_ERROR", "Failed to refresh war history");
    const teams = await this.getTeamsForHistory(refreshed.id);
    const members = await this.getMembersForTeams(teams.map((t) => t.id));
    const poolMembers = await this.db.select({ userId: warPoolMembers.userId }).from(warPoolMembers).where(eq(warPoolMembers.warHistoryId, refreshed.id));
    await this.dispatchAutoTeamComp(refreshed, teams, members, poolMembers);
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
    if (teamIds.length > 0) {
      await this.db.delete(warTeamMembers).where(and(inArray(warTeamMembers.warTeamId, teamIds), eq(warTeamMembers.userId, userId)));
    }
    await this.db.delete(warPoolMembers).where(and(eq(warPoolMembers.warHistoryId, activeHistory.id), eq(warPoolMembers.userId, userId)));
    if (to === "pool") {
      await this.db.insert(warPoolMembers).values({ id: nanoid(), warHistoryId: activeHistory.id, userId });
    } else {
      const targetTeam = teams.find((t) => t.id === to);
      if (!targetTeam) return err("NOT_FOUND", "Target team not found");
      const maxRow = (await this.db.select({ maxSort: sql<number>`coalesce(max(${warTeamMembers.sortOrder}), -1)` }).from(warTeamMembers).where(eq(warTeamMembers.warTeamId, targetTeam.id)))[0];
      const nextSort = Number(maxRow?.maxSort ?? -1) + 1;
      await this.db.insert(warTeamMembers).values({ id: nanoid(), warTeamId: targetTeam.id, userId, sortOrder: nextSort });
    }
    await this.db.update(warHistory).set({ updatedAt: new Date().toISOString() }).where(eq(warHistory.id, activeHistory.id));
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

  async postTeams(actorId: string, eventId: string, platform: "discord" | "wechat"): Promise<ServiceResult<{ ok: true; task_id: string }>> {
    const activeHistory = await this.getLatestWarHistory(eventId);
    if (!activeHistory) return err("NOT_FOUND", "Active war history not found");
    const teams = await this.getTeamsForHistory(activeHistory.id);
    const members = await this.getMembersForTeams(teams.map((t) => t.id));
    const poolMembers = await this.db.select({ userId: warPoolMembers.userId }).from(warPoolMembers).where(eq(warPoolMembers.warHistoryId, activeHistory.id));
    const settings = await this.readBotSettings();
    const targetId = platform === "discord" ? settings.discord.team_comp_channel_id.trim() : normalizeRoomIds(settings)[0] ?? "";
    if (!targetId) return err("VALIDATION_ERROR", `Missing ${platform} target for team composition dispatch`);
    const task = await this.deps.createBotTask({ platform, taskType: "team_comp", targetId, eventId: activeHistory.eventId, payload: buildTeamCompTaskPayload(activeHistory, teams, members, poolMembers), idempotencyKey: `guild-war-team-comp:${platform}:${activeHistory.id}:${Date.now()}`, dispatchNow: this.shouldDispatchNow() });
    await this.deps.writeAuditLog({ entityType: "guild_war", action: "post_team_comp", actorId, entityId: activeHistory.id, detailText: JSON.stringify({ platform, task_id: task.task_id }) });
    return ok({ ok: true, task_id: task.task_id });
  }

  async postResults(actorId: string, warHistoryId: string, platform: "discord" | "wechat"): Promise<ServiceResult<{ ok: true; task_id: string }>> {
    const history = await this.getWarHistoryById(warHistoryId);
    if (!history) return err("NOT_FOUND", "War history not found");
    const teams = await this.getTeamsForHistory(history.id);
    const members = await this.getMembersForTeams(teams.map((t) => t.id));
    const settings = await this.readBotSettings();
    const targetId = platform === "discord" ? settings.discord.notification_channel_id.trim() || settings.discord.team_comp_channel_id.trim() : normalizeRoomIds(settings)[0] ?? "";
    if (!targetId) return err("VALIDATION_ERROR", `Missing ${platform} target for war result dispatch`);
    const task = await this.deps.createBotTask({ platform, taskType: "war_result", targetId, eventId: history.eventId, payload: buildWarResultTaskPayload(history, members), idempotencyKey: `guild-war-result:${platform}:${history.id}:${Date.now()}`, dispatchNow: this.shouldDispatchNow() });
    await this.deps.writeAuditLog({ entityType: "guild_war_history", action: "post_results", actorId, entityId: history.id, detailText: JSON.stringify({ platform, task_id: task.task_id }) });
    return ok({ ok: true, task_id: task.task_id });
  }

  async exportHistory(format: "csv" | "json", filters: { dateFrom?: string; dateTo?: string; eventId?: string }): Promise<ServiceResult<{ content: string; contentType: string; filename: string }>> {
    const where: SQL<unknown>[] = [];
    if (filters.dateFrom) where.push(gte(warHistory.createdAt, filters.dateFrom));
    if (filters.dateTo) where.push(lte(warHistory.createdAt, filters.dateTo));
    if (filters.eventId) where.push(eq(warHistory.eventId, filters.eventId));
    const rows = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownKills: warHistory.ownKills, ownTowers: warHistory.ownTowers, ownBaseHp: warHistory.ownBaseHp, ownCredits: warHistory.ownCredits, ownDistance: warHistory.ownDistance, enemyKills: warHistory.enemyKills, enemyTowers: warHistory.enemyTowers, enemyBaseHp: warHistory.enemyBaseHp, enemyCredits: warHistory.enemyCredits, enemyDistance: warHistory.enemyDistance, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(where.length > 0 ? and(...where) : undefined).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(5000);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `guild-war-history-${dateStamp}.${format}`;
    if (format === "json") {
      const payload = { exported_at: new Date().toISOString(), filters: { date_from: filters.dateFrom ?? null, date_to: filters.dateTo ?? null, event_id: filters.eventId ?? null }, total: rows.length, data: rows.map(toWarHistoryPayload) };
      return ok({ content: JSON.stringify(payload, null, 2), contentType: "application/json; charset=utf-8", filename });
    }
    return ok({ content: buildWarHistoryCsv(rows), contentType: "text/csv; charset=utf-8", filename });
  }

  async listTemplates(eventId?: string, templateType?: string): Promise<ServiceResult<unknown[]>> {
    const where: SQL<unknown>[] = [];
    if (templateType) where.push(eq(warTemplates.templateType, templateType));
    if (eventId) where.push(eq(warTemplates.sourceEventId, eventId));
    const rows = await this.db.select({ id: warTemplates.id, templateName: warTemplates.templateName, description: warTemplates.description, templateType: warTemplates.templateType, sourceEventId: warTemplates.sourceEventId, payloadJson: warTemplates.payloadJson, createdBy: warTemplates.createdBy, createdAt: warTemplates.createdAt, updatedAt: warTemplates.updatedAt }).from(warTemplates).where(where.length > 0 ? and(...where) : undefined).orderBy(desc(warTemplates.updatedAt), desc(warTemplates.id)).limit(200);
    return ok(rows.map(toWarTemplatePayload));
  }

  async createStructureTemplate(actorId: string, templateName: string, description: string | null, eventId: string): Promise<ServiceResult<unknown>> {
    const activeHistory = await this.getLatestWarHistory(eventId);
    if (!activeHistory) return err("NOT_FOUND", "Active war history not found for selected event");
    const teams = await this.getTeamsForHistory(activeHistory.id);
    if (teams.length === 0) return err("VALIDATION_ERROR", "Cannot save empty structure template");
    const templateId = nanoid();
    const payload: StructureTemplatePayload = {
      teams: teams.map((t) => ({ team_name: t.teamName, sort_order: t.sortOrder, notes: t.notes ?? undefined })),
    };
    await this.db.insert(warTemplates).values({ id: templateId, templateName, description, templateType: "structure", sourceEventId: eventId, payloadJson: JSON.stringify(payload), createdBy: actorId });
    const created = await this.getWarTemplateById(templateId);
    if (!created) return err("SERVER_ERROR", "Failed to load saved war template");
    await this.deps.writeAuditLog({ entityType: "guild_war_template", action: "create", actorId, entityId: templateId, diffTitle: created.templateName, detailText: JSON.stringify({ event_id: eventId, type: "structure" }) });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: templateId, hint: "template_created" });
    return ok(toWarTemplatePayload(created));
  }

  async createMemberTemplate(actorId: string, templateName: string, description: string | null, userIds: string[]): Promise<ServiceResult<unknown>> {
    const templateId = nanoid();
    const payload: MemberTemplatePayload = { user_ids: userIds };
    await this.db.insert(warTemplates).values({ id: templateId, templateName, description, templateType: "members", sourceEventId: null, payloadJson: JSON.stringify(payload), createdBy: actorId });
    const created = await this.getWarTemplateById(templateId);
    if (!created) return err("SERVER_ERROR", "Failed to load saved member template");
    await this.deps.writeAuditLog({ entityType: "guild_war_template", action: "create", actorId, entityId: templateId, diffTitle: created.templateName, detailText: JSON.stringify({ type: "members", member_count: userIds.length }) });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: templateId, hint: "template_created" });
    return ok(toWarTemplatePayload(created));
  }

  async applyStructureTemplate(actorId: string, templateId: string, eventId: string): Promise<ServiceResult<{ ok: true; war_history_id: string }>> {
    const template = await this.getWarTemplateById(templateId);
    if (!template) return err("NOT_FOUND", "War template not found");
    if (template.templateType !== "structure") return err("VALIDATION_ERROR", "Template is not a structure template");
    const payload = JSON.parse(template.payloadJson) as StructureTemplatePayload;
    const activeHistory = await this.ensureWarHistoryForEvent(eventId, actorId);
    if (!activeHistory) return err("SERVER_ERROR", "Failed to initialize war history");
    // Structure templates replace all teams with empty skeleton (no members)
    const snapshot: WarTemplateSnapshot = {
      teams: payload.teams.map((t) => ({ ...t, is_locked: false, members: [] })),
      pool_members: [],
    };
    await this.replaceHistoryTeams(activeHistory.id, snapshot);
    const refreshed = await this.getWarHistoryById(activeHistory.id);
    if (!refreshed) return err("SERVER_ERROR", "Failed to refresh war history");
    await this.deps.writeAuditLog({ entityType: "guild_war_template", action: "apply", actorId, entityId: template.id, diffTitle: template.templateName, detailText: JSON.stringify({ event_id: eventId, war_history_id: refreshed.id, type: "structure" }) });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: refreshed.id, hint: "template_applied" });
    return ok({ ok: true, war_history_id: refreshed.id });
  }

  async previewMemberTemplate(templateId: string, eventId: string): Promise<ServiceResult<{ user_ids: string[]; signed_up: string[]; not_signed_up: string[] }>> {
    const template = await this.getWarTemplateById(templateId);
    if (!template) return err("NOT_FOUND", "War template not found");
    if (template.templateType !== "members") return err("VALIDATION_ERROR", "Template is not a members template");
    const payload = JSON.parse(template.payloadJson) as MemberTemplatePayload;
    // Check which users are signed up for this event
    const signups = await this.db.select({ userId: eventParticipants.userId }).from(eventParticipants).where(eq(eventParticipants.eventId, eventId));
    const signedUpSet = new Set(signups.map((s) => s.userId));
    const signedUp = payload.user_ids.filter((id) => signedUpSet.has(id));
    const notSignedUp = payload.user_ids.filter((id) => !signedUpSet.has(id));
    return ok({ user_ids: payload.user_ids, signed_up: signedUp, not_signed_up: notSignedUp });
  }

  async applyMemberTemplate(actorId: string, templateId: string, eventId: string, teamId: string, forceSignupUserIds?: string[]): Promise<ServiceResult<{ ok: true }>> {
    const template = await this.getWarTemplateById(templateId);
    if (!template) return err("NOT_FOUND", "War template not found");
    if (template.templateType !== "members") return err("VALIDATION_ERROR", "Template is not a members template");
    const payload = JSON.parse(template.payloadJson) as MemberTemplatePayload;
    // Verify the team exists
    const team = (await this.db.select({ id: warTeams.id, warHistoryId: warTeams.warHistoryId }).from(warTeams).where(eq(warTeams.id, teamId)).limit(1))[0];
    if (!team) return err("NOT_FOUND", "Team not found");
    // Force-signup users who aren't signed up yet
    if (forceSignupUserIds && forceSignupUserIds.length > 0) {
      const existingSignups = await this.db.select({ userId: eventParticipants.userId }).from(eventParticipants).where(and(eq(eventParticipants.eventId, eventId), inArray(eventParticipants.userId, forceSignupUserIds)));
      const alreadySignedUp = new Set(existingSignups.map((s) => s.userId));
      for (const userId of forceSignupUserIds) {
        if (!alreadySignedUp.has(userId)) {
          await this.db.insert(eventParticipants).values({ id: nanoid(), eventId, userId });
        }
      }
    }
    // Ensure all template users are in the pool
    const poolMembers = await this.db.select({ userId: warPoolMembers.userId }).from(warPoolMembers).where(eq(warPoolMembers.warHistoryId, team.warHistoryId));
    const poolSet = new Set(poolMembers.map((p) => p.userId));
    for (const userId of payload.user_ids) {
      if (!poolSet.has(userId)) {
        await this.db.insert(warPoolMembers).values({ id: nanoid(), warHistoryId: team.warHistoryId, userId }).onConflictDoNothing();
      }
    }
    // Clear existing members from this team
    await this.db.delete(warTeamMembers).where(eq(warTeamMembers.warTeamId, teamId));
    // Add template members to the team
    for (let i = 0; i < payload.user_ids.length; i++) {
      await this.db.insert(warTeamMembers).values({ id: nanoid(), warTeamId: teamId, userId: payload.user_ids[i], sortOrder: i });
    }
    // Remove added members from pool (they're now on a team)
    const addedSet = new Set(payload.user_ids);
    for (const userId of addedSet) {
      await this.db.delete(warPoolMembers).where(and(eq(warPoolMembers.warHistoryId, team.warHistoryId), eq(warPoolMembers.userId, userId)));
    }
    await this.db.update(warHistory).set({ updatedAt: new Date().toISOString() }).where(eq(warHistory.id, team.warHistoryId));
    await this.deps.writeAuditLog({ entityType: "guild_war_template", action: "apply_members", actorId, entityId: template.id, diffTitle: template.templateName, detailText: JSON.stringify({ event_id: eventId, team_id: teamId, member_count: payload.user_ids.length }) });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: team.warHistoryId, hint: "template_applied" });
    return ok({ ok: true });
  }

  async deleteTemplate(actorId: string, templateId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getWarTemplateById(templateId);
    if (!existing) return err("NOT_FOUND", "War template not found");
    await this.db.delete(warTemplates).where(eq(warTemplates.id, templateId));
    await this.deps.writeAuditLog({ entityType: "guild_war_template", action: "delete", actorId, entityId: templateId, diffTitle: existing.templateName });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: templateId, hint: "template_deleted" });
    return ok({ ok: true });
  }

  async listHistory(page: number, limit: number, filters: { dateFrom?: string; dateTo?: string }): Promise<ServiceResult<{ data: unknown[]; total: number; page: number; limit: number; total_pages: number }>> {
    const offset = (page - 1) * limit;
    const where: SQL<unknown>[] = [];
    if (filters.dateFrom) where.push(gte(warHistory.createdAt, filters.dateFrom));
    if (filters.dateTo) where.push(lte(warHistory.createdAt, filters.dateTo));
    const whereClause = where.length > 0 ? and(...where) : undefined;
    const totalRow = (await this.db.select({ count: sql<number>`count(*)` }).from(warHistory).where(whereClause))[0];
    const total = Number(totalRow?.count ?? 0);
    const rows = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownKills: warHistory.ownKills, ownTowers: warHistory.ownTowers, ownBaseHp: warHistory.ownBaseHp, ownCredits: warHistory.ownCredits, ownDistance: warHistory.ownDistance, enemyKills: warHistory.enemyKills, enemyTowers: warHistory.enemyTowers, enemyBaseHp: warHistory.enemyBaseHp, enemyCredits: warHistory.enemyCredits, enemyDistance: warHistory.enemyDistance, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(whereClause).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(limit).offset(offset);
    return ok({ data: rows.map(toWarHistoryPayload), total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)) });
  }

  async batchHistory(ids: string[]): Promise<ServiceResult<{ data: unknown[] }>> {
    const histories = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownKills: warHistory.ownKills, ownTowers: warHistory.ownTowers, ownBaseHp: warHistory.ownBaseHp, ownCredits: warHistory.ownCredits, ownDistance: warHistory.ownDistance, enemyKills: warHistory.enemyKills, enemyTowers: warHistory.enemyTowers, enemyBaseHp: warHistory.enemyBaseHp, enemyCredits: warHistory.enemyCredits, enemyDistance: warHistory.enemyDistance, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(inArray(warHistory.id, ids));
    const allTeams = await this.db.select({ id: warTeams.id, warHistoryId: warTeams.warHistoryId, teamName: warTeams.teamName, sortOrder: warTeams.sortOrder, notes: warTeams.notes, isLocked: warTeams.isLocked }).from(warTeams).where(inArray(warTeams.warHistoryId, ids)).orderBy(asc(warTeams.sortOrder), asc(warTeams.id));
    const teamIds = allTeams.map((t) => t.id);
    const allMembers = teamIds.length > 0 ? await this.getMembersForTeams(teamIds) : [];
    const allPool = await this.db.select({ id: warPoolMembers.id, warHistoryId: warPoolMembers.warHistoryId, userId: warPoolMembers.userId }).from(warPoolMembers).where(inArray(warPoolMembers.warHistoryId, ids));
    const data = histories.map((h) => {
      const hTeams = allTeams.filter((t) => t.warHistoryId === h.id);
      const hTeamIds = new Set(hTeams.map((t) => t.id));
      return { ...toWarHistoryPayload(h), teams: hTeams.map((team) => ({ ...toTeamPayload(team), members: allMembers.filter((m) => m.warTeamId === team.id).map(toMemberPayload) })), pool: allPool.filter((p) => p.warHistoryId === h.id), member_stats: allMembers.filter((m) => hTeamIds.has(m.warTeamId)).map(toMemberPayload) };
    });
    return ok({ data });
  }

  async getHistoryDetail(warId: string): Promise<ServiceResult<unknown>> {
    const history = await this.getWarHistoryById(warId);
    if (!history) return err("NOT_FOUND", "War history not found");
    const teams = await this.getTeamsForHistory(warId);
    const members = await this.getMembersForTeams(teams.map((t) => t.id));
    const pool = await this.getPoolMembers(warId);
    return ok({ ...toWarHistoryPayload(history), teams: teams.map((team) => ({ ...toTeamPayload(team), members: members.filter((m) => m.warTeamId === team.id).map(toMemberPayload) })), pool, member_stats: members.map(toMemberPayload) });
  }

  async createHistory(actorId: string, input: CreateWarHistoryInput): Promise<ServiceResult<unknown>> {
    const historyId = nanoid();
    await this.db.insert(warHistory).values({ id: historyId, eventId: input.event_id ?? null, warName: input.war_name, enemyName: input.enemy_name ?? null, result: input.result ?? null, ownKills: input.own_kills ?? null, ownTowers: input.own_towers ?? null, ownBaseHp: input.own_base_hp ?? null, ownCredits: input.own_credits ?? null, ownDistance: input.own_distance ?? null, enemyKills: input.enemy_kills ?? null, enemyTowers: input.enemy_towers ?? null, enemyBaseHp: input.enemy_base_hp ?? null, enemyCredits: input.enemy_credits ?? null, enemyDistance: input.enemy_distance ?? null, notes: input.notes ?? null, createdBy: actorId });
    const created = await this.getWarHistoryById(historyId);
    if (!created) return err("SERVER_ERROR", "Failed to create war history");
    await this.deps.writeAuditLog({ entityType: "guild_war_history", action: "create", actorId, entityId: historyId, diffTitle: created.warName });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: historyId, hint: "history_created" });
    const createdTeams = await this.getTeamsForHistory(created.id);
    const createdMembers = await this.getMembersForTeams(createdTeams.map((t) => t.id));
    await this.dispatchAutoWarResult(created, createdMembers);
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
    const updatedTeams = await this.getTeamsForHistory(updated.id);
    const updatedMembers = await this.getMembersForTeams(updatedTeams.map((t) => t.id));
    await this.dispatchAutoWarResult(updated, updatedMembers);
    return ok(toWarHistoryPayload(updated));
  }

  async deleteHistory(actorId: string, warId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getWarHistoryById(warId);
    if (!existing) return err("NOT_FOUND", "War history not found");
    const teamIds = (await this.db.select({ id: warTeams.id }).from(warTeams).where(eq(warTeams.warHistoryId, warId))).map((r) => r.id);
    if (teamIds.length > 0) await this.db.delete(warTeamMembers).where(inArray(warTeamMembers.warTeamId, teamIds));
    await this.db.delete(warTeams).where(eq(warTeams.warHistoryId, warId));
    await this.db.delete(warPoolMembers).where(eq(warPoolMembers.warHistoryId, warId));
    await this.db.delete(warHistory).where(eq(warHistory.id, warId));
    await this.deps.writeAuditLog({ entityType: "guild_war_history", action: "delete", actorId, entityId: warId, diffTitle: existing.warName });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: warId, hint: "history_deleted" });
    return ok({ ok: true });
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
      if (Object.keys(patch).length > 0) await this.db.update(warTeamMembers).set(patch).where(eq(warTeamMembers.id, memberRow.id));
      const refreshed = (await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, kills: warTeamMembers.kills, deaths: warTeamMembers.deaths, assists: warTeamMembers.assists, damage: warTeamMembers.damage, healing: warTeamMembers.healing, buildingDamage: warTeamMembers.buildingDamage, credits: warTeamMembers.credits, damageTaken: warTeamMembers.damageTaken, note: warTeamMembers.note }).from(warTeamMembers).where(eq(warTeamMembers.id, memberRow.id)).limit(1))[0];
      if (refreshed) results.push(toMemberPayload(refreshed));
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
