import {
  ERROR_STATUS,
  applyWarTemplateSchema,
  botSettingsSchema,
  createWarHistorySchema,
  createWarTemplateSchema,
  eventSchema,
  hasRoleAtLeast,
  saveTeamsPayloadSchema,
  updateMemberStatsSchema,
  updateWarHistorySchema,
  warHistorySchema,
  warTemplateSchema,
  warTeamMemberSchema,
  warTeamSchema,
  type ErrorCode,
  type Role,
  type StandardErrorResponse,
} from "@guild/shared";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import {
  events,
  warHistory,
  warPoolMembers,
  warTeamMembers,
  warTeams,
  warTemplates,
} from "../db/schema";
import type { Bindings } from "../index";
import { resolveSession } from "../services/auth";
import { writeAuditLog } from "../services/audit";
import { createBotTask } from "../services/bot-dispatch";

type SessionUser = { id: string; role: Role };
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

type WarHistoryRow = {
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

type WarTeamRow = {
  id: string;
  warHistoryId: string;
  teamName: string;
  sortOrder: number;
  notes: string | null;
  isLocked: boolean;
};

type WarTeamMemberRow = {
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

type WarTemplateRow = {
  id: string;
  templateName: string;
  description: string | null;
  sourceEventId: string | null;
  payloadJson: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type WarTemplateSnapshot = {
  teams: Array<{
    team_name: string;
    sort_order: number;
    notes?: string;
    is_locked?: boolean;
    members: Array<{
      user_id: string;
      role_tag?: string;
      sort_order: number;
    }>;
  }>;
  pool_members: Array<{ user_id: string }>;
};

type BotSettings = {
  discord: {
    guild_id: string;
    notification_channel_id: string;
    team_comp_channel_id: string;
    default_toggles: Record<string, boolean>;
  };
  wechat: {
    room_ids: string[];
    default_toggles: Record<string, boolean>;
  };
};

const BOT_SETTINGS_KEY = "config/bot-settings.json";
const TEAM_COMP_DEBOUNCE_BUCKET_MS = 30_000;

export const guildWarRoutes = new Hono();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function defaultBotSettings(): BotSettings {
  return {
    discord: {
      guild_id: "",
      notification_channel_id: "",
      team_comp_channel_id: "",
      default_toggles: {},
    },
    wechat: {
      room_ids: [],
      default_toggles: {},
    },
  };
}

async function readBotSettings(env: Bindings): Promise<BotSettings> {
  const object = await env.MEDIA.get(BOT_SETTINGS_KEY);
  if (!object) {
    return defaultBotSettings();
  }

  try {
    const parsed = JSON.parse(await object.text()) as unknown;
    return botSettingsSchema.parse(parsed);
  } catch {
    return defaultBotSettings();
  }
}

function shouldDispatchNow(env: Bindings): boolean {
  return Boolean(env.BOT_RUNTIME_URL?.trim() && env.BOT_SHARED_SECRET?.trim());
}

function normalizeRoomIds(settings: BotSettings): string[] {
  return Array.from(
    new Set(
      settings.wechat.room_ids
        .map((roomId) => roomId.trim())
        .filter((roomId): roomId is string => roomId.length > 0),
    ),
  );
}

function buildTeamCompTaskPayload(
  history: WarHistoryRow,
  teams: WarTeamRow[],
  members: WarTeamMemberRow[],
  poolMembers: Array<{ userId: string }>,
): Record<string, unknown> {
  return {
    war_history_id: history.id,
    war_name: history.warName,
    enemy_name: history.enemyName,
    event_id: history.eventId,
    teams: teams.map((team) => ({
      team_id: team.id,
      team_name: team.teamName,
      is_locked: team.isLocked,
      members: members
        .filter((member) => member.warTeamId === team.id)
        .map((member) => ({
          user_id: member.userId,
          role_tag: member.roleTag,
        })),
    })),
    pool: poolMembers.map((item) => ({ user_id: item.userId })),
  };
}

function buildWarResultTaskPayload(
  history: WarHistoryRow,
  members: WarTeamMemberRow[],
): Record<string, unknown> {
  const topDamage = [...members]
    .sort((left, right) => (right.damage ?? 0) - (left.damage ?? 0))
    .slice(0, 3)
    .map((item) => ({ user_id: item.userId, damage: item.damage ?? 0 }));

  const topHealing = [...members]
    .sort((left, right) => (right.healing ?? 0) - (left.healing ?? 0))
    .slice(0, 3)
    .map((item) => ({ user_id: item.userId, healing: item.healing ?? 0 }));

  return {
    war_history_id: history.id,
    war_name: history.warName,
    enemy_name: history.enemyName,
    result: history.result,
    own_kills: history.ownKills,
    enemy_kills: history.enemyKills,
    own_towers: history.ownTowers,
    enemy_towers: history.enemyTowers,
    own_base_hp: history.ownBaseHp,
    enemy_base_hp: history.enemyBaseHp,
    own_credits: history.ownCredits,
    enemy_credits: history.enemyCredits,
    top_damage: topDamage,
    top_healing: topHealing,
  };
}

async function dispatchAutoTeamComp(
  c: Context,
  history: WarHistoryRow,
  teams: WarTeamRow[],
  members: WarTeamMemberRow[],
  poolMembers: Array<{ userId: string }>,
): Promise<void> {
  const env = c.env as Bindings;
  const settings = await readBotSettings(env);
  const payload = buildTeamCompTaskPayload(history, teams, members, poolMembers);
  const dispatchNow = shouldDispatchNow(env);
  const debounceBucket = Math.floor(Date.now() / TEAM_COMP_DEBOUNCE_BUCKET_MS);

  const tasks: Promise<unknown>[] = [];
  const discordChannelId = settings.discord.team_comp_channel_id.trim();
  if (discordChannelId) {
    tasks.push(
      createBotTask(env, {
        platform: "discord",
        taskType: "team_comp",
        targetId: discordChannelId,
        eventId: history.eventId,
        payload,
        idempotencyKey: `guild-war-team-comp:auto:discord:${history.id}:${debounceBucket}`,
        dispatchNow,
      }),
    );
  }

  for (const roomId of normalizeRoomIds(settings)) {
    tasks.push(
      createBotTask(env, {
        platform: "wechat",
        taskType: "team_comp",
        targetId: roomId,
        eventId: history.eventId,
        payload,
        idempotencyKey: `guild-war-team-comp:auto:wechat:${history.id}:${roomId}:${debounceBucket}`,
        dispatchNow,
      }),
    );
  }

  await Promise.all(tasks);
}

async function dispatchAutoWarResult(
  c: Context,
  history: WarHistoryRow,
  members: WarTeamMemberRow[],
): Promise<void> {
  if (!history.result || history.result.trim().length === 0) {
    return;
  }

  const env = c.env as Bindings;
  const settings = await readBotSettings(env);
  const payload = buildWarResultTaskPayload(history, members);
  const dispatchNow = shouldDispatchNow(env);
  const dispatchKey = history.updatedAt || new Date().toISOString();

  const tasks: Promise<unknown>[] = [];
  const discordChannelId =
    settings.discord.notification_channel_id.trim() || settings.discord.team_comp_channel_id.trim();
  if (discordChannelId) {
    tasks.push(
      createBotTask(env, {
        platform: "discord",
        taskType: "war_result",
        targetId: discordChannelId,
        eventId: history.eventId,
        payload,
        idempotencyKey: `guild-war-result:auto:discord:${history.id}:${dispatchKey}`,
        dispatchNow,
      }),
    );
  }

  for (const roomId of normalizeRoomIds(settings)) {
    tasks.push(
      createBotTask(env, {
        platform: "wechat",
        taskType: "war_result",
        targetId: roomId,
        eventId: history.eventId,
        payload,
        idempotencyKey: `guild-war-result:auto:wechat:${history.id}:${roomId}:${dispatchKey}`,
        dispatchNow,
      }),
    );
  }

  await Promise.all(tasks);
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: code,
    message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function buildWarHistoryCsv(rows: WarHistoryRow[]): string {
  const headers = [
    "id",
    "event_id",
    "war_name",
    "enemy_name",
    "result",
    "own_kills",
    "enemy_kills",
    "own_towers",
    "enemy_towers",
    "own_base_hp",
    "enemy_base_hp",
    "own_credits",
    "enemy_credits",
    "own_distance",
    "enemy_distance",
    "notes",
    "created_by",
    "created_at",
    "updated_at",
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push([
      toCsvCell(row.id),
      toCsvCell(row.eventId),
      toCsvCell(row.warName),
      toCsvCell(row.enemyName),
      toCsvCell(row.result),
      toCsvCell(row.ownKills),
      toCsvCell(row.enemyKills),
      toCsvCell(row.ownTowers),
      toCsvCell(row.enemyTowers),
      toCsvCell(row.ownBaseHp),
      toCsvCell(row.enemyBaseHp),
      toCsvCell(row.ownCredits),
      toCsvCell(row.enemyCredits),
      toCsvCell(row.ownDistance),
      toCsvCell(row.enemyDistance),
      toCsvCell(row.durationMinutes),
      toCsvCell(row.notes),
      toCsvCell(row.createdBy),
      toCsvCell(row.createdAt),
      toCsvCell(row.updatedAt),
    ].join(","));
  }

  return lines.join("\n");
}

function parseRecurrenceRule(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** D1 sometimes returns REAL/INTEGER columns as strings — coerce to number. */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toWarHistoryPayload(row: WarHistoryRow) {
  return warHistorySchema.parse({
    id: row.id,
    event_id: row.eventId,
    war_name: row.warName,
    enemy_name: row.enemyName,
    result: row.result,
    own_kills: toNum(row.ownKills),
    own_towers: toNum(row.ownTowers),
    own_base_hp: toNum(row.ownBaseHp),
    own_credits: toNum(row.ownCredits),
    own_distance: toNum(row.ownDistance),
    enemy_kills: toNum(row.enemyKills),
    enemy_towers: toNum(row.enemyTowers),
    enemy_base_hp: toNum(row.enemyBaseHp),
    enemy_credits: toNum(row.enemyCredits),
    enemy_distance: toNum(row.enemyDistance),
    duration_minutes: toNum(row.durationMinutes),
    notes: row.notes,
    created_by: row.createdBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

function toTeamPayload(row: WarTeamRow) {
  return warTeamSchema.parse({
    id: row.id,
    war_history_id: row.warHistoryId,
    team_name: row.teamName,
    sort_order: toNum(row.sortOrder),
    notes: row.notes,
    is_locked: row.isLocked,
  });
}

function toMemberPayload(row: WarTeamMemberRow) {
  return warTeamMemberSchema.parse({
    id: row.id,
    war_team_id: row.warTeamId,
    user_id: row.userId,
    role_tag: row.roleTag,
    sort_order: toNum(row.sortOrder),
    kills: toNum(row.kills),
    deaths: toNum(row.deaths),
    assists: toNum(row.assists),
    damage: toNum(row.damage),
    healing: toNum(row.healing),
    building_damage: toNum(row.buildingDamage),
    credits: toNum(row.credits),
    damage_taken: toNum(row.damageTaken),
    note: row.note,
  });
}

function parseTemplateSnapshot(payloadJson: string): WarTemplateSnapshot {
  const parsed = JSON.parse(payloadJson) as unknown;
  const normalized = saveTeamsPayloadSchema.parse({
    event_id: "template",
    ...(parsed as Record<string, unknown>),
  });

  return {
    teams: normalized.teams,
    pool_members: normalized.pool_members,
  };
}

function buildTemplateSnapshot(
  teams: WarTeamRow[],
  members: WarTeamMemberRow[],
  poolMembers: Array<{ userId: string }>,
): WarTemplateSnapshot {
  return {
    teams: teams.map((team) => ({
      team_name: team.teamName,
      sort_order: team.sortOrder,
      notes: team.notes ?? undefined,
      is_locked: team.isLocked,
      members: members
        .filter((member) => member.warTeamId === team.id)
        .map((member) => ({
          user_id: member.userId,
          role_tag: member.roleTag ?? undefined,
          sort_order: member.sortOrder,
        })),
    })),
    pool_members: poolMembers.map((item) => ({ user_id: item.userId })),
  };
}

function toWarTemplatePayload(row: WarTemplateRow) {
  const snapshot = parseTemplateSnapshot(row.payloadJson);
  const memberCount = snapshot.teams.reduce((total, team) => total + team.members.length, 0);

  return warTemplateSchema.parse({
    id: row.id,
    template_name: row.templateName,
    description: row.description,
    source_event_id: row.sourceEventId,
    team_count: snapshot.teams.length,
    member_count: memberCount,
    created_by: row.createdBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

function buildWarEtag(warId: string, updatedAt: string): string {
  return `"war-${warId}-${updatedAt}"`;
}

async function requireRole(c: Context, requiredRole: Role): Promise<SessionUser | Response> {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return buildError(c, "UNAUTHORIZED", "Authentication required");
  }
  if (!hasRoleAtLeast(resolved.user.role, requiredRole)) {
    return buildError(c, "FORBIDDEN", "Insufficient role");
  }

  return resolved.user;
}

async function getWarHistoryById(c: Context, warId: string): Promise<WarHistoryRow | null> {
  const db = getDb(c);
  const row = (
    await db
      .select({
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
        createdAt: warHistory.createdAt,
        updatedAt: warHistory.updatedAt,
      })
      .from(warHistory)
      .where(eq(warHistory.id, warId))
      .limit(1)
  )[0];

  return row ?? null;
}

async function getLatestWarHistory(c: Context, eventId?: string): Promise<WarHistoryRow | null> {
  const db = getDb(c);
  const rows = await db
    .select({
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
      createdAt: warHistory.createdAt,
      updatedAt: warHistory.updatedAt,
    })
    .from(warHistory)
    .where(eventId ? eq(warHistory.eventId, eventId) : undefined)
    .orderBy(desc(warHistory.createdAt), desc(warHistory.id))
    .limit(1);

  return rows[0] ?? null;
}

async function getTeamsForHistory(c: Context, warHistoryId: string): Promise<WarTeamRow[]> {
  const db = getDb(c);
  return await db
    .select({
      id: warTeams.id,
      warHistoryId: warTeams.warHistoryId,
      teamName: warTeams.teamName,
      sortOrder: warTeams.sortOrder,
      notes: warTeams.notes,
      isLocked: warTeams.isLocked,
    })
    .from(warTeams)
    .where(eq(warTeams.warHistoryId, warHistoryId))
    .orderBy(asc(warTeams.sortOrder), asc(warTeams.id));
}

async function getMembersForTeams(c: Context, teamIds: string[]): Promise<WarTeamMemberRow[]> {
  if (teamIds.length === 0) {
    return [];
  }

  const db = getDb(c);
  return await db
    .select({
      id: warTeamMembers.id,
      warTeamId: warTeamMembers.warTeamId,
      userId: warTeamMembers.userId,
      roleTag: warTeamMembers.roleTag,
      sortOrder: warTeamMembers.sortOrder,
      kills: warTeamMembers.kills,
      deaths: warTeamMembers.deaths,
      assists: warTeamMembers.assists,
      damage: warTeamMembers.damage,
      healing: warTeamMembers.healing,
      buildingDamage: warTeamMembers.buildingDamage,
      credits: warTeamMembers.credits,
      damageTaken: warTeamMembers.damageTaken,
      note: warTeamMembers.note,
    })
    .from(warTeamMembers)
    .where(inArray(warTeamMembers.warTeamId, teamIds))
    .orderBy(asc(warTeamMembers.sortOrder), asc(warTeamMembers.id));
}

async function getWarTemplateById(c: Context, templateId: string): Promise<WarTemplateRow | null> {
  const db = getDb(c);
  const row = (
    await db
      .select({
        id: warTemplates.id,
        templateName: warTemplates.templateName,
        description: warTemplates.description,
        sourceEventId: warTemplates.sourceEventId,
        payloadJson: warTemplates.payloadJson,
        createdBy: warTemplates.createdBy,
        createdAt: warTemplates.createdAt,
        updatedAt: warTemplates.updatedAt,
      })
      .from(warTemplates)
      .where(eq(warTemplates.id, templateId))
      .limit(1)
  )[0];

  return row ?? null;
}

async function ensureWarHistoryForEvent(c: Context, eventId: string, actorId: string): Promise<WarHistoryRow | null> {
  const existing = await getLatestWarHistory(c, eventId);
  if (existing) {
    return existing;
  }

  const historyId = nanoid();
  const db = getDb(c);
  await db.insert(warHistory).values({
    id: historyId,
    eventId,
    warName: `Guild War ${new Date().toISOString().slice(0, 10)}`,
    createdBy: actorId,
  });

  return await getWarHistoryById(c, historyId);
}

async function replaceHistoryTeams(c: Context, warHistoryId: string, snapshot: WarTemplateSnapshot): Promise<void> {
  const db = getDb(c);
  const existingTeams = await getTeamsForHistory(c, warHistoryId);
  const existingTeamIds = existingTeams.map((team) => team.id);

  if (existingTeamIds.length > 0) {
    await db.delete(warTeamMembers).where(inArray(warTeamMembers.warTeamId, existingTeamIds));
  }

  await db.delete(warTeams).where(eq(warTeams.warHistoryId, warHistoryId));
  await db.delete(warPoolMembers).where(eq(warPoolMembers.warHistoryId, warHistoryId));

  for (const team of snapshot.teams) {
    const teamId = nanoid();
    await db.insert(warTeams).values({
      id: teamId,
      warHistoryId,
      teamName: team.team_name,
      sortOrder: team.sort_order,
      notes: team.notes ?? null,
      isLocked: team.is_locked ?? false,
    });

    for (const member of team.members) {
      await db.insert(warTeamMembers).values({
        id: nanoid(),
        warTeamId: teamId,
        userId: member.user_id,
        roleTag: member.role_tag ?? null,
        sortOrder: member.sort_order,
      });
    }
  }

  for (const poolMember of snapshot.pool_members) {
    await db.insert(warPoolMembers).values({
      id: nanoid(),
      warHistoryId,
      userId: poolMember.user_id,
    });
  }

  await db
    .update(warHistory)
    .set({
      updatedAt: new Date().toISOString(),
    })
    .where(eq(warHistory.id, warHistoryId));
}

guildWarRoutes.get("/active", async (c) => {
  const eventId = c.req.query("event_id");
  const activeWar = await getLatestWarHistory(c, eventId);

  if (!activeWar) {
    return c.json({ event: null, teams: [], pool: [], etag: null });
  }

  const teams = await getTeamsForHistory(c, activeWar.id);
  const teamIds = teams.map((item) => item.id);
  const members = await getMembersForTeams(c, teamIds);

  const db = getDb(c);
  const pool = await db
    .select({
      id: warPoolMembers.id,
      warHistoryId: warPoolMembers.warHistoryId,
      userId: warPoolMembers.userId,
    })
    .from(warPoolMembers)
    .where(eq(warPoolMembers.warHistoryId, activeWar.id));

  let eventPayload: unknown = null;
  if (activeWar.eventId) {
    const eventRow = (
      await db
        .select({
          id: events.id,
          type: events.type,
          title: events.title,
          description: events.description,
          startAt: events.startAt,
          endAt: events.endAt,
          capacity: events.capacity,
          pinned: events.pinned,
          signupLocked: events.signupLocked,
          archivedAt: events.archivedAt,
          createdBy: events.createdBy,
          recurrenceRule: events.recurrenceRule,
          seriesId: events.seriesId,
          isSeriesParent: events.isSeriesParent,
          instanceDate: events.instanceDate,
          createdAt: events.createdAt,
          updatedAt: events.updatedAt,
        })
        .from(events)
        .where(eq(events.id, activeWar.eventId))
        .limit(1)
    )[0];

    if (eventRow) {
      eventPayload = eventSchema.parse({
        id: eventRow.id,
        type: eventRow.type,
        title: eventRow.title,
        description: eventRow.description,
        start_at: eventRow.startAt,
        end_at: eventRow.endAt,
        capacity: eventRow.capacity,
        pinned: eventRow.pinned,
        signup_locked: eventRow.signupLocked,
        archived_at: eventRow.archivedAt,
        created_by: eventRow.createdBy,
        recurrence_rule: parseRecurrenceRule(eventRow.recurrenceRule),
        series_id: eventRow.seriesId,
        is_series_parent: eventRow.isSeriesParent,
        instance_date: eventRow.instanceDate,
        created_at: eventRow.createdAt,
        updated_at: eventRow.updatedAt,
      });
    }
  }

  return c.json({
    event: eventPayload,
    teams: teams.map((team) => ({
      ...toTeamPayload(team),
      members: members.filter((member) => member.warTeamId === team.id).map(toMemberPayload),
    })),
    pool,
    etag: buildWarEtag(activeWar.id, activeWar.updatedAt),
  });
});

guildWarRoutes.post("/save-teams", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = saveTeamsPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid save teams payload", parsed.error.flatten());
  }

  const activeHistory = await ensureWarHistoryForEvent(c, parsed.data.event_id, sessionUser.id);
  if (!activeHistory) {
    return buildError(c, "SERVER_ERROR", "Failed to initialize war history");
  }

  const snapshot: WarTemplateSnapshot = {
    teams: parsed.data.teams,
    pool_members: parsed.data.pool_members,
  };
  await replaceHistoryTeams(c, activeHistory.id, snapshot);

  await writeAuditLog(c, {
    entityType: "guild_war",
    action: "save_teams",
    actorId: sessionUser.id,
    entityId: activeHistory.id,
    detailText: JSON.stringify({ event_id: parsed.data.event_id }),
  });
  const refreshedHistory = await getWarHistoryById(c, activeHistory.id);
  if (!refreshedHistory) {
    return buildError(c, "SERVER_ERROR", "Failed to refresh war history");
  }

  const teamsForDispatch = await getTeamsForHistory(c, refreshedHistory.id);
  const teamIdsForDispatch = teamsForDispatch.map((team) => team.id);
  const membersForDispatch = await getMembersForTeams(c, teamIdsForDispatch);
  const db = getDb(c);
  const poolForDispatch = await db
    .select({ userId: warPoolMembers.userId })
    .from(warPoolMembers)
    .where(eq(warPoolMembers.warHistoryId, refreshedHistory.id));
  await dispatchAutoTeamComp(c, refreshedHistory, teamsForDispatch, membersForDispatch, poolForDispatch);

  return c.json(toWarHistoryPayload(refreshedHistory));
});

guildWarRoutes.post("/move", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const payload = body as {
    event_id?: unknown;
    user_id?: unknown;
    to?: unknown;
    etag?: unknown;
  };

  if (typeof payload.event_id !== "string" || typeof payload.user_id !== "string" || typeof payload.to !== "string") {
    return buildError(c, "VALIDATION_ERROR", "event_id, user_id and to are required");
  }

  const activeHistory = await getLatestWarHistory(c, payload.event_id);
  if (!activeHistory) {
    return buildError(c, "NOT_FOUND", "Active war history not found");
  }

  if (payload.etag !== undefined && typeof payload.etag !== "string") {
    return buildError(c, "VALIDATION_ERROR", "etag must be a string when provided");
  }

  const etagFromHeader = c.req.header("If-Match");
  const conditionalEtag =
    etagFromHeader && etagFromHeader !== "*"
      ? etagFromHeader
      : typeof payload.etag === "string"
        ? payload.etag
        : undefined;

  if (conditionalEtag) {
    const expectedEtag = buildWarEtag(activeHistory.id, activeHistory.updatedAt);
    if (conditionalEtag !== expectedEtag) {
      return buildError(c, "CONFLICT", "Guild war roster changed, refresh and retry", {
        expected_etag: expectedEtag,
      });
    }
  }

  const teams = await getTeamsForHistory(c, activeHistory.id);
  const teamIds = teams.map((team) => team.id);
  const db = getDb(c);

  if (teamIds.length > 0) {
    await db
      .delete(warTeamMembers)
      .where(and(inArray(warTeamMembers.warTeamId, teamIds), eq(warTeamMembers.userId, payload.user_id)));
  }

  await db
    .delete(warPoolMembers)
    .where(and(eq(warPoolMembers.warHistoryId, activeHistory.id), eq(warPoolMembers.userId, payload.user_id)));

  if (payload.to === "pool") {
    await db.insert(warPoolMembers).values({
      id: nanoid(),
      warHistoryId: activeHistory.id,
      userId: payload.user_id,
    });
  } else {
    const targetTeam = teams.find((team) => team.id === payload.to);
    if (!targetTeam) {
      return buildError(c, "NOT_FOUND", "Target team not found");
    }

    const maxSortOrderRow = (
      await db
        .select({ maxSortOrder: sql<number>`coalesce(max(${warTeamMembers.sortOrder}), -1)` })
        .from(warTeamMembers)
        .where(eq(warTeamMembers.warTeamId, targetTeam.id))
    )[0];
    const nextSortOrder = Number(maxSortOrderRow?.maxSortOrder ?? -1) + 1;

    await db.insert(warTeamMembers).values({
      id: nanoid(),
      warTeamId: targetTeam.id,
      userId: payload.user_id,
      sortOrder: nextSortOrder,
    });
  }

  await db
    .update(warHistory)
    .set({
      updatedAt: new Date().toISOString(),
    })
    .where(eq(warHistory.id, activeHistory.id));

  await writeAuditLog(c, {
    entityType: "guild_war",
    action: "move_member",
    actorId: sessionUser.id,
    entityId: activeHistory.id,
    detailText: JSON.stringify({ user_id: payload.user_id, to: payload.to }),
  });

  return c.json({ ok: true });
});

guildWarRoutes.patch("/role-tag", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const payload = body as {
    event_id?: unknown;
    user_id?: unknown;
    role_tag?: unknown;
  };
  if (typeof payload.event_id !== "string" || typeof payload.user_id !== "string") {
    return buildError(c, "VALIDATION_ERROR", "event_id and user_id are required");
  }
  if (payload.role_tag !== undefined && payload.role_tag !== null && typeof payload.role_tag !== "string") {
    return buildError(c, "VALIDATION_ERROR", "role_tag must be string or null");
  }

  const activeHistory = await getLatestWarHistory(c, payload.event_id);
  if (!activeHistory) {
    return buildError(c, "NOT_FOUND", "Active war history not found");
  }

  const db = getDb(c);
  const memberRow = (
    await db
      .select({ id: warTeamMembers.id })
      .from(warTeamMembers)
      .innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId))
      .where(and(eq(warTeams.warHistoryId, activeHistory.id), eq(warTeamMembers.userId, payload.user_id)))
      .limit(1)
  )[0];
  if (!memberRow) {
    return buildError(c, "NOT_FOUND", "Member not found in active teams");
  }

  const nextTag =
    typeof payload.role_tag === "string" && payload.role_tag.trim().length > 0
      ? payload.role_tag.trim()
      : null;

  await db.update(warTeamMembers).set({ roleTag: nextTag }).where(eq(warTeamMembers.id, memberRow.id));
  await db
    .update(warHistory)
    .set({
      updatedAt: new Date().toISOString(),
    })
    .where(eq(warHistory.id, activeHistory.id));

  await writeAuditLog(c, {
    entityType: "guild_war",
    action: "set_role_tag",
    actorId: sessionUser.id,
    entityId: activeHistory.id,
    detailText: JSON.stringify({ user_id: payload.user_id, role_tag: nextTag }),
  });

  return c.json({ ok: true });
});

guildWarRoutes.post("/post-teams", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const payload = body as {
    event_id?: unknown;
    platform?: unknown;
  };
  if (typeof payload.event_id !== "string") {
    return buildError(c, "VALIDATION_ERROR", "event_id is required");
  }
  if (payload.platform !== "discord" && payload.platform !== "wechat") {
    return buildError(c, "VALIDATION_ERROR", "platform must be discord or wechat");
  }

  const activeHistory = await getLatestWarHistory(c, payload.event_id);
  if (!activeHistory) {
    return buildError(c, "NOT_FOUND", "Active war history not found");
  }

  const teams = await getTeamsForHistory(c, activeHistory.id);
  const members = await getMembersForTeams(
    c,
    teams.map((team) => team.id),
  );
  const db = getDb(c);
  const poolMembers = await db
    .select({
      userId: warPoolMembers.userId,
    })
    .from(warPoolMembers)
    .where(eq(warPoolMembers.warHistoryId, activeHistory.id));

  const env = c.env as Bindings;
  const settings = await readBotSettings(env);
  const targetId =
    payload.platform === "discord"
      ? settings.discord.team_comp_channel_id.trim()
      : normalizeRoomIds(settings)[0] ?? "";
  if (!targetId) {
    return buildError(c, "VALIDATION_ERROR", `Missing ${payload.platform} target for team composition dispatch`);
  }

  const task = await createBotTask(env, {
    platform: payload.platform,
    taskType: "team_comp",
    targetId,
    eventId: activeHistory.eventId,
    payload: buildTeamCompTaskPayload(activeHistory, teams, members, poolMembers),
    idempotencyKey: `guild-war-team-comp:${payload.platform}:${activeHistory.id}:${Date.now()}`,
    dispatchNow: shouldDispatchNow(env),
  });

  await writeAuditLog(c, {
    entityType: "guild_war",
    action: "post_team_comp",
    actorId: sessionUser.id,
    entityId: activeHistory.id,
    detailText: JSON.stringify({ platform: payload.platform, task_id: task.task_id }),
  });

  return c.json({ ok: true, task_id: task.task_id });
});

guildWarRoutes.post("/post-results", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const payload = body as {
    war_history_id?: unknown;
    platform?: unknown;
  };

  if (typeof payload.war_history_id !== "string") {
    return buildError(c, "VALIDATION_ERROR", "war_history_id is required");
  }
  if (payload.platform !== "discord" && payload.platform !== "wechat") {
    return buildError(c, "VALIDATION_ERROR", "platform must be discord or wechat");
  }

  const history = await getWarHistoryById(c, payload.war_history_id);
  if (!history) {
    return buildError(c, "NOT_FOUND", "War history not found");
  }

  const teams = await getTeamsForHistory(c, history.id);
  const members = await getMembersForTeams(
    c,
    teams.map((team) => team.id),
  );

  const env = c.env as Bindings;
  const settings = await readBotSettings(env);
  const targetId =
    payload.platform === "discord"
      ? settings.discord.notification_channel_id.trim() || settings.discord.team_comp_channel_id.trim()
      : normalizeRoomIds(settings)[0] ?? "";
  if (!targetId) {
    return buildError(c, "VALIDATION_ERROR", `Missing ${payload.platform} target for war result dispatch`);
  }

  const task = await createBotTask(env, {
    platform: payload.platform,
    taskType: "war_result",
    targetId,
    eventId: history.eventId,
    payload: buildWarResultTaskPayload(history, members),
    idempotencyKey: `guild-war-result:${payload.platform}:${history.id}:${Date.now()}`,
    dispatchNow: shouldDispatchNow(env),
  });

  await writeAuditLog(c, {
    entityType: "guild_war_history",
    action: "post_results",
    actorId: sessionUser.id,
    entityId: history.id,
    detailText: JSON.stringify({ platform: payload.platform, task_id: task.task_id }),
  });

  return c.json({ ok: true, task_id: task.task_id });
});

guildWarRoutes.get("/export", async (c) => {
  const format = (c.req.query("format") ?? "csv").trim().toLowerCase();
  if (format !== "csv" && format !== "json") {
    return buildError(c, "VALIDATION_ERROR", "format must be csv or json");
  }

  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const eventId = c.req.query("event_id");

  const filters: SQL<unknown>[] = [];
  if (dateFrom) {
    filters.push(gte(warHistory.createdAt, dateFrom));
  }
  if (dateTo) {
    filters.push(lte(warHistory.createdAt, dateTo));
  }
  if (eventId) {
    filters.push(eq(warHistory.eventId, eventId));
  }

  const db = getDb(c);
  const rows = await db
    .select({
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
      createdAt: warHistory.createdAt,
      updatedAt: warHistory.updatedAt,
    })
    .from(warHistory)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(warHistory.createdAt), desc(warHistory.id))
    .limit(5000);

  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `guild-war-history-${dateStamp}.${format}`;

  if (format === "json") {
    const payload = {
      exported_at: new Date().toISOString(),
      filters: {
        date_from: dateFrom ?? null,
        date_to: dateTo ?? null,
        event_id: eventId ?? null,
      },
      total: rows.length,
      data: rows.map(toWarHistoryPayload),
    };

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const csv = buildWarHistoryCsv(rows);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

guildWarRoutes.get("/templates", async (c) => {
  const eventId = c.req.query("event_id");
  const filters: SQL<unknown>[] = [];

  if (eventId) {
    filters.push(eq(warTemplates.sourceEventId, eventId));
  }

  const db = getDb(c);
  const rows = await db
    .select({
      id: warTemplates.id,
      templateName: warTemplates.templateName,
      description: warTemplates.description,
      sourceEventId: warTemplates.sourceEventId,
      payloadJson: warTemplates.payloadJson,
      createdBy: warTemplates.createdBy,
      createdAt: warTemplates.createdAt,
      updatedAt: warTemplates.updatedAt,
    })
    .from(warTemplates)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(warTemplates.updatedAt), desc(warTemplates.id))
    .limit(200);

  return c.json(rows.map(toWarTemplatePayload));
});

guildWarRoutes.post("/templates", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = createWarTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid war template payload", parsed.error.flatten());
  }

  const activeHistory = await getLatestWarHistory(c, parsed.data.event_id);
  if (!activeHistory) {
    return buildError(c, "NOT_FOUND", "Active war history not found for selected event");
  }

  const teams = await getTeamsForHistory(c, activeHistory.id);
  const members = await getMembersForTeams(
    c,
    teams.map((team) => team.id),
  );
  const db = getDb(c);
  const poolMembers = await db
    .select({ userId: warPoolMembers.userId })
    .from(warPoolMembers)
    .where(eq(warPoolMembers.warHistoryId, activeHistory.id));

  if (teams.length === 0 && poolMembers.length === 0) {
    return buildError(c, "VALIDATION_ERROR", "Cannot save empty team template");
  }

  const templateId = nanoid();
  const snapshot = buildTemplateSnapshot(teams, members, poolMembers);

  await db.insert(warTemplates).values({
    id: templateId,
    templateName: parsed.data.template_name,
    description: parsed.data.description ?? null,
    sourceEventId: parsed.data.event_id,
    payloadJson: JSON.stringify(snapshot),
    createdBy: sessionUser.id,
  });

  const created = await getWarTemplateById(c, templateId);
  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to load saved war template");
  }

  await writeAuditLog(c, {
    entityType: "guild_war_template",
    action: "create",
    actorId: sessionUser.id,
    entityId: templateId,
    diffTitle: created.templateName,
    detailText: JSON.stringify({ event_id: parsed.data.event_id }),
  });

  return c.json(toWarTemplatePayload(created), 201);
});

guildWarRoutes.post("/templates/apply", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = applyWarTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid war template apply payload", parsed.error.flatten());
  }

  const template = await getWarTemplateById(c, parsed.data.template_id);
  if (!template) {
    return buildError(c, "NOT_FOUND", "War template not found");
  }

  const snapshot = parseTemplateSnapshot(template.payloadJson);
  const activeHistory = await ensureWarHistoryForEvent(c, parsed.data.event_id, sessionUser.id);
  if (!activeHistory) {
    return buildError(c, "SERVER_ERROR", "Failed to initialize war history");
  }

  await replaceHistoryTeams(c, activeHistory.id, snapshot);

  const refreshedHistory = await getWarHistoryById(c, activeHistory.id);
  if (!refreshedHistory) {
    return buildError(c, "SERVER_ERROR", "Failed to refresh war history");
  }

  const teamsForDispatch = await getTeamsForHistory(c, refreshedHistory.id);
  const teamIdsForDispatch = teamsForDispatch.map((team) => team.id);
  const membersForDispatch = await getMembersForTeams(c, teamIdsForDispatch);
  const db = getDb(c);
  const poolForDispatch = await db
    .select({ userId: warPoolMembers.userId })
    .from(warPoolMembers)
    .where(eq(warPoolMembers.warHistoryId, refreshedHistory.id));

  await dispatchAutoTeamComp(c, refreshedHistory, teamsForDispatch, membersForDispatch, poolForDispatch);

  await writeAuditLog(c, {
    entityType: "guild_war_template",
    action: "apply",
    actorId: sessionUser.id,
    entityId: template.id,
    diffTitle: template.templateName,
    detailText: JSON.stringify({ event_id: parsed.data.event_id, war_history_id: refreshedHistory.id }),
  });

  return c.json({ ok: true, war_history_id: refreshedHistory.id });
});

guildWarRoutes.delete("/templates/:id", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const templateId = c.req.param("id");
  const existing = await getWarTemplateById(c, templateId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "War template not found");
  }

  const db = getDb(c);
  await db.delete(warTemplates).where(eq(warTemplates.id, templateId));

  await writeAuditLog(c, {
    entityType: "guild_war_template",
    action: "delete",
    actorId: sessionUser.id,
    entityId: templateId,
    diffTitle: existing.templateName,
  });

  return c.json({ ok: true });
});

guildWarRoutes.get("/history", async (c) => {
  const page = parsePage(c.req.query("page"), 1);
  const limit = Math.min(100, parsePage(c.req.query("limit"), 20));
  const offset = (page - 1) * limit;
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");

  const filters: SQL<unknown>[] = [];
  if (dateFrom) {
    filters.push(gte(warHistory.createdAt, dateFrom));
  }
  if (dateTo) {
    filters.push(lte(warHistory.createdAt, dateTo));
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;
  const db = getDb(c);

  const totalRow = (
    await db
      .select({ count: sql<number>`count(*)` })
      .from(warHistory)
      .where(whereClause)
  )[0];
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
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
      createdAt: warHistory.createdAt,
      updatedAt: warHistory.updatedAt,
    })
    .from(warHistory)
    .where(whereClause)
    .orderBy(desc(warHistory.createdAt), desc(warHistory.id))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map(toWarHistoryPayload),
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  });
});

guildWarRoutes.get("/history/:id", async (c) => {
  const warId = c.req.param("id");
  const history = await getWarHistoryById(c, warId);
  if (!history) {
    return buildError(c, "NOT_FOUND", "War history not found");
  }

  const teams = await getTeamsForHistory(c, warId);
  const teamIds = teams.map((team) => team.id);
  const members = await getMembersForTeams(c, teamIds);

  const db = getDb(c);
  const pool = await db
    .select({
      id: warPoolMembers.id,
      warHistoryId: warPoolMembers.warHistoryId,
      userId: warPoolMembers.userId,
    })
    .from(warPoolMembers)
    .where(eq(warPoolMembers.warHistoryId, warId));

  return c.json({
    ...toWarHistoryPayload(history),
    teams: teams.map((team) => ({
      ...toTeamPayload(team),
      members: members.filter((member) => member.warTeamId === team.id).map(toMemberPayload),
    })),
    pool,
    member_stats: members.map(toMemberPayload),
  });
});

guildWarRoutes.post("/history", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = createWarHistorySchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid war history payload", parsed.error.flatten());
  }

  const historyId = nanoid();
  const db = getDb(c);
  await db.insert(warHistory).values({
    id: historyId,
    eventId: parsed.data.event_id ?? null,
    warName: parsed.data.war_name,
    enemyName: parsed.data.enemy_name ?? null,
    result: parsed.data.result ?? null,
    ownKills: parsed.data.own_kills ?? null,
    ownTowers: parsed.data.own_towers ?? null,
    ownBaseHp: parsed.data.own_base_hp ?? null,
    ownCredits: parsed.data.own_credits ?? null,
    ownDistance: parsed.data.own_distance ?? null,
    enemyKills: parsed.data.enemy_kills ?? null,
    enemyTowers: parsed.data.enemy_towers ?? null,
    enemyBaseHp: parsed.data.enemy_base_hp ?? null,
    enemyCredits: parsed.data.enemy_credits ?? null,
    enemyDistance: parsed.data.enemy_distance ?? null,
    notes: parsed.data.notes ?? null,
    createdBy: sessionUser.id,
  });

  const created = await getWarHistoryById(c, historyId);
  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to create war history");
  }

  await writeAuditLog(c, {
    entityType: "guild_war_history",
    action: "create",
    actorId: sessionUser.id,
    entityId: historyId,
    diffTitle: created.warName,
  });

  const createdTeams = await getTeamsForHistory(c, created.id);
  const createdMembers = await getMembersForTeams(
    c,
    createdTeams.map((team) => team.id),
  );
  await dispatchAutoWarResult(c, created, createdMembers);

  return c.json(toWarHistoryPayload(created), 201);
});

guildWarRoutes.patch("/history/:id", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const warId = c.req.param("id");
  const existing = await getWarHistoryById(c, warId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "War history not found");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = updateWarHistorySchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid war history payload", parsed.error.flatten());
  }

  const patch: Partial<typeof warHistory.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (parsed.data.event_id !== undefined) patch.eventId = parsed.data.event_id;
  if (parsed.data.war_name !== undefined) patch.warName = parsed.data.war_name;
  if (parsed.data.enemy_name !== undefined) patch.enemyName = parsed.data.enemy_name;
  if (parsed.data.result !== undefined) patch.result = parsed.data.result;
  if (parsed.data.own_kills !== undefined) patch.ownKills = parsed.data.own_kills;
  if (parsed.data.own_towers !== undefined) patch.ownTowers = parsed.data.own_towers;
  if (parsed.data.own_base_hp !== undefined) patch.ownBaseHp = parsed.data.own_base_hp;
  if (parsed.data.own_credits !== undefined) patch.ownCredits = parsed.data.own_credits;
  if (parsed.data.own_distance !== undefined) patch.ownDistance = parsed.data.own_distance;
  if (parsed.data.enemy_kills !== undefined) patch.enemyKills = parsed.data.enemy_kills;
  if (parsed.data.enemy_towers !== undefined) patch.enemyTowers = parsed.data.enemy_towers;
  if (parsed.data.enemy_base_hp !== undefined) patch.enemyBaseHp = parsed.data.enemy_base_hp;
  if (parsed.data.enemy_credits !== undefined) patch.enemyCredits = parsed.data.enemy_credits;
  if (parsed.data.enemy_distance !== undefined) patch.enemyDistance = parsed.data.enemy_distance;
  if (parsed.data.duration_minutes !== undefined) patch.durationMinutes = parsed.data.duration_minutes;
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;

  const db = getDb(c);
  await db.update(warHistory).set(patch).where(eq(warHistory.id, warId));

  const updated = await getWarHistoryById(c, warId);
  if (!updated) {
    return buildError(c, "SERVER_ERROR", "Failed to load updated war history");
  }

  await writeAuditLog(c, {
    entityType: "guild_war_history",
    action: "update",
    actorId: sessionUser.id,
    entityId: warId,
    diffTitle: updated.warName,
    detailText: JSON.stringify(parsed.data),
  });

  const updatedTeams = await getTeamsForHistory(c, updated.id);
  const updatedMembers = await getMembersForTeams(
    c,
    updatedTeams.map((team) => team.id),
  );
  await dispatchAutoWarResult(c, updated, updatedMembers);

  return c.json(toWarHistoryPayload(updated));
});

guildWarRoutes.patch("/history/:id/member-stats/:userId", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const warId = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const existingHistory = await getWarHistoryById(c, warId);
  if (!existingHistory) {
    return buildError(c, "NOT_FOUND", "War history not found");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = updateMemberStatsSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid member stats payload", parsed.error.flatten());
  }

  const db = getDb(c);
  const memberRow = (
    await db
      .select({
        id: warTeamMembers.id,
        warTeamId: warTeamMembers.warTeamId,
        userId: warTeamMembers.userId,
        roleTag: warTeamMembers.roleTag,
        sortOrder: warTeamMembers.sortOrder,
        kills: warTeamMembers.kills,
        deaths: warTeamMembers.deaths,
        assists: warTeamMembers.assists,
        damage: warTeamMembers.damage,
        healing: warTeamMembers.healing,
        buildingDamage: warTeamMembers.buildingDamage,
        credits: warTeamMembers.credits,
        damageTaken: warTeamMembers.damageTaken,
        note: warTeamMembers.note,
      })
      .from(warTeamMembers)
      .innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId))
      .where(and(eq(warTeams.warHistoryId, warId), eq(warTeamMembers.userId, targetUserId)))
      .limit(1)
  )[0];

  if (!memberRow) {
    return buildError(c, "NOT_FOUND", "Team member not found in selected war history");
  }

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

  await db.update(warTeamMembers).set(patch).where(eq(warTeamMembers.id, memberRow.id));

  const refreshed = (
    await db
      .select({
        id: warTeamMembers.id,
        warTeamId: warTeamMembers.warTeamId,
        userId: warTeamMembers.userId,
        roleTag: warTeamMembers.roleTag,
        sortOrder: warTeamMembers.sortOrder,
        kills: warTeamMembers.kills,
        deaths: warTeamMembers.deaths,
        assists: warTeamMembers.assists,
        damage: warTeamMembers.damage,
        healing: warTeamMembers.healing,
        buildingDamage: warTeamMembers.buildingDamage,
        credits: warTeamMembers.credits,
        damageTaken: warTeamMembers.damageTaken,
        note: warTeamMembers.note,
      })
      .from(warTeamMembers)
      .where(eq(warTeamMembers.id, memberRow.id))
      .limit(1)
  )[0];

  if (!refreshed) {
    return buildError(c, "SERVER_ERROR", "Failed to load updated member stats");
  }

  await writeAuditLog(c, {
    entityType: "guild_war_member_stats",
    action: "update",
    actorId: sessionUser.id,
    entityId: `${warId}:${targetUserId}`,
    detailText: JSON.stringify(parsed.data),
  });

  return c.json(toMemberPayload(refreshed));
});

// --- Analytics normalization helpers ---

const ANALYTICS_SETTINGS_KEY = "config/analytics-settings.json";

type AnalyticsSettings = {
  reference_duration_minutes: number;
  modifier_weight_kda: number;
  modifier_weight_towers: number;
  modifier_weight_credits: number;
  modifier_weight_distance: number;
  modifier_weight_basehp: number;
};

function defaultAnalyticsSettings(): AnalyticsSettings {
  return {
    reference_duration_minutes: 30,
    modifier_weight_kda: 0.30,
    modifier_weight_towers: 0.10,
    modifier_weight_credits: 0.30,
    modifier_weight_distance: 0.15,
    modifier_weight_basehp: 0.15,
  };
}

async function readAnalyticsSettings(c: Context): Promise<AnalyticsSettings> {
  const env = c.env as Bindings;
  const object = await env.MEDIA.get(ANALYTICS_SETTINGS_KEY);
  if (!object) {
    return defaultAnalyticsSettings();
  }
  try {
    const parsed = JSON.parse(await object.text()) as unknown;
    const defaults = defaultAnalyticsSettings();
    if (typeof parsed !== "object" || parsed === null) return defaults;
    const record = parsed as Record<string, unknown>;
    return {
      reference_duration_minutes:
        typeof record.reference_duration_minutes === "number" && record.reference_duration_minutes > 0
          ? record.reference_duration_minutes
          : defaults.reference_duration_minutes,
      modifier_weight_kda: typeof record.modifier_weight_kda === "number" ? record.modifier_weight_kda : defaults.modifier_weight_kda,
      modifier_weight_towers: typeof record.modifier_weight_towers === "number" ? record.modifier_weight_towers : defaults.modifier_weight_towers,
      modifier_weight_credits: typeof record.modifier_weight_credits === "number" ? record.modifier_weight_credits : defaults.modifier_weight_credits,
      modifier_weight_distance: typeof record.modifier_weight_distance === "number" ? record.modifier_weight_distance : defaults.modifier_weight_distance,
      modifier_weight_basehp: typeof record.modifier_weight_basehp === "number" ? record.modifier_weight_basehp : defaults.modifier_weight_basehp,
    };
  } catch {
    return defaultAnalyticsSettings();
  }
}

type ModifierBreakdown = {
  factor: string;
  ratio: number;
  weight: number;
  contribution: number;
};

function computeWarModifier(
  war: {
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
  },
  ownTeamSize: number,
  settings: AnalyticsSettings,
): { value: number; breakdown: ModifierBreakdown[] } {
  const factors: Array<{ key: string; weight: number; ownVal: number | null; enemyVal: number | null; perCapita: boolean }> = [
    { key: "kda", weight: settings.modifier_weight_kda, ownVal: war.ownKills, enemyVal: war.enemyKills, perCapita: true },
    { key: "towers", weight: settings.modifier_weight_towers, ownVal: war.ownTowers, enemyVal: war.enemyTowers, perCapita: false },
    { key: "credits", weight: settings.modifier_weight_credits, ownVal: war.ownCredits, enemyVal: war.enemyCredits, perCapita: true },
    { key: "distance", weight: settings.modifier_weight_distance, ownVal: war.ownDistance, enemyVal: war.enemyDistance, perCapita: true },
    { key: "basehp", weight: settings.modifier_weight_basehp, ownVal: war.ownBaseHp, enemyVal: war.enemyBaseHp, perCapita: false },
  ];

  const validFactors: Array<{ key: string; weight: number; ratio: number }> = [];

  for (const factor of factors) {
    if (factor.weight <= 0) continue;
    if (factor.ownVal === null || factor.enemyVal === null) continue;

    let ownVal = factor.ownVal;
    let enemyVal = factor.enemyVal;

    // Per-capita normalization (enemy team size assumed equal when unknown)
    if (factor.perCapita && ownTeamSize > 0) {
      ownVal = ownVal / ownTeamSize;
      enemyVal = enemyVal / ownTeamSize;
    }

    const ratio = enemyVal / Math.max(ownVal, 1);
    validFactors.push({ key: factor.key, weight: factor.weight, ratio });
  }

  if (validFactors.length === 0) {
    return { value: 1.0, breakdown: [] };
  }

  // Re-normalize weights to sum to 1.0
  const totalWeight = validFactors.reduce((sum, f) => sum + f.weight, 0);
  const breakdown: ModifierBreakdown[] = [];
  let modifier = 0;

  for (const factor of validFactors) {
    const normalizedWeight = factor.weight / totalWeight;
    const contribution = normalizedWeight * factor.ratio;
    modifier += contribution;
    breakdown.push({
      factor: factor.key,
      ratio: Number(factor.ratio.toFixed(4)),
      weight: Number(normalizedWeight.toFixed(4)),
      contribution: Number(contribution.toFixed(4)),
    });
  }

  return { value: Number(modifier.toFixed(4)), breakdown };
}

guildWarRoutes.get("/analytics", async (c) => {
  const warIdsRaw = c.req.queries("war_ids") ?? [];
  const userIdsRaw = c.req.queries("user_ids") ?? [];
  const warIds = warIdsRaw.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  const userIds = userIdsRaw.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);

  const db = getDb(c);
  const warFilters: SQL<unknown>[] = [];
  if (warIds.length > 0) {
    warFilters.push(inArray(warHistory.id, warIds));
  }

  const wars = await db
    .select({
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
      createdAt: warHistory.createdAt,
      updatedAt: warHistory.updatedAt,
    })
    .from(warHistory)
    .where(warFilters.length > 0 ? and(...warFilters) : undefined)
    .orderBy(desc(warHistory.createdAt), desc(warHistory.id))
    .limit(200);

  const historyIds = wars.map((item) => item.id);
  if (historyIds.length === 0) {
    return c.json({ wars: [], member_stats: [], analytics_settings: defaultAnalyticsSettings() });
  }

  // Count team members per war for per-capita normalization
  const teamSizeCounts = await db
    .select({
      warHistoryId: warTeams.warHistoryId,
      memberCount: sql<number>`count(${warTeamMembers.id})`.as("member_count"),
    })
    .from(warTeamMembers)
    .innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId))
    .where(inArray(warTeams.warHistoryId, historyIds))
    .groupBy(warTeams.warHistoryId);

  const teamSizeMap = new Map<string, number>();
  for (const row of teamSizeCounts) {
    teamSizeMap.set(row.warHistoryId, row.memberCount);
  }

  // Read analytics settings from R2
  const analyticsSettings = await readAnalyticsSettings(c);

  // Compute modifier for each war
  const warsWithModifier = wars.map((war) => {
    const teamSize = teamSizeMap.get(war.id) ?? 0;
    const modifier = computeWarModifier(war, teamSize, analyticsSettings);
    return {
      ...toWarHistoryPayload(war),
      team_size: teamSize,
      modifier: modifier.value,
      modifier_breakdown: modifier.breakdown,
    };
  });

  const memberFilters: SQL<unknown>[] = [inArray(warTeams.warHistoryId, historyIds)];
  if (userIds.length > 0) {
    memberFilters.push(inArray(warTeamMembers.userId, userIds));
  }

  const members = await db
    .select({
      userId: warTeamMembers.userId,
      kills: warTeamMembers.kills,
      deaths: warTeamMembers.deaths,
      assists: warTeamMembers.assists,
      damage: warTeamMembers.damage,
      healing: warTeamMembers.healing,
      buildingDamage: warTeamMembers.buildingDamage,
      credits: warTeamMembers.credits,
      damageTaken: warTeamMembers.damageTaken,
    })
    .from(warTeamMembers)
    .innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId))
    .where(and(...memberFilters));

  const aggregate = new Map<
    string,
    {
      user_id: string;
      kills: number;
      deaths: number;
      assists: number;
      damage: number;
      healing: number;
      building_damage: number;
      credits: number;
      damage_taken: number;
    }
  >();

  for (const row of members) {
    const current = aggregate.get(row.userId) ?? {
      user_id: row.userId,
      kills: 0,
      deaths: 0,
      assists: 0,
      damage: 0,
      healing: 0,
      building_damage: 0,
      credits: 0,
      damage_taken: 0,
    };

    current.kills += row.kills ?? 0;
    current.deaths += row.deaths ?? 0;
    current.assists += row.assists ?? 0;
    current.damage += row.damage ?? 0;
    current.healing += row.healing ?? 0;
    current.building_damage += row.buildingDamage ?? 0;
    current.credits += row.credits ?? 0;
    current.damage_taken += row.damageTaken ?? 0;

    aggregate.set(row.userId, current);
  }

  return c.json({
    wars: warsWithModifier,
    member_stats: Array.from(aggregate.values()),
    analytics_settings: analyticsSettings,
  });
});
