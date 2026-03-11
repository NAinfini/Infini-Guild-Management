import { and, eq, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import {
  botDeliveryLog,
  discordLinkCodes,
  eventParticipants,
  events,
  memberProfiles,
  users,
} from "../db/schema";
import { ok, err, type ServiceResult } from "./result";

// --- Types ---

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type AuditLogInput = { entityType: string; action: string; actorId: string; entityId: string; diffTitle?: string | null; detailText?: string | null };
type EntityChangedInput = { entityType: string; entityId: string; hint: string };

export type InternalBotServiceDeps = {
  d1: D1Database;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (msg: EntityChangedInput) => Promise<void>;
};

type BotUserLookup = { userId: string; discordId: string | null };

// --- Helpers ---

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

// --- Service ---

export class InternalBotService {
  private db: DrizzleDb;
  private deps: InternalBotServiceDeps;

  constructor(db: DrizzleDb, deps: InternalBotServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  // --- Private: user resolution ---

  private async resolveUser(userId?: string, discordId?: string): Promise<ServiceResult<BotUserLookup>> {
    if (userId) {
      const user = (await this.db.select({ id: users.id, deletedAt: users.deletedAt, isActive: users.isActive, discordId: memberProfiles.discordId }).from(users).leftJoin(memberProfiles, eq(memberProfiles.userId, users.id)).where(eq(users.id, userId)).limit(1))[0];
      if (!user || user.deletedAt !== null || !user.isActive) return err("NOT_FOUND", "User not found");
      return ok({ userId: user.id, discordId: user.discordId ?? null });
    }
    if (discordId) {
      const linked = (await this.db.select({ userId: memberProfiles.userId, discordId: memberProfiles.discordId, deletedAt: users.deletedAt, isActive: users.isActive }).from(memberProfiles).innerJoin(users, eq(users.id, memberProfiles.userId)).where(eq(memberProfiles.discordId, discordId)).limit(1))[0];
      if (!linked || linked.deletedAt !== null || !linked.isActive) return err("NOT_FOUND", "Linked user not found for discord_id");
      return ok({ userId: linked.userId, discordId: linked.discordId ?? discordId });
    }
    return err("VALIDATION_ERROR", "Either user_id or discord_id is required");
  }

  // --- Public: event participation ---

  async signup(eventId: string, userId?: string, discordId?: string, source?: string): Promise<ServiceResult<{ ok: true; event_id: string; user_id: string }>> {
    const resolved = await this.resolveUser(userId, discordId);
    if (!resolved.ok) return resolved;
    const user = resolved.data;

    const participantId = nanoid();
    const insertResult = await this.deps.d1.prepare(
      `INSERT INTO event_participants (id, event_id, user_id)
       SELECT ?1, ?2, ?3
       WHERE EXISTS (
         SELECT 1 FROM events e
         WHERE e.id = ?2 AND e.archived_at IS NULL AND e.signup_locked = 0
           AND (e.capacity IS NULL OR (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id) < e.capacity)
       )
       AND NOT EXISTS (
         SELECT 1 FROM event_participants p WHERE p.event_id = ?2 AND p.user_id = ?3
       )`,
    ).bind(participantId, eventId, user.userId).run();

    if ((insertResult.meta?.changes ?? 0) !== 1) {
      const eventRow = (await this.db.select({ id: events.id, archivedAt: events.archivedAt, signupLocked: events.signupLocked, capacity: events.capacity }).from(events).where(eq(events.id, eventId)).limit(1))[0];
      if (!eventRow) return err("NOT_FOUND", "Event not found");
      if (eventRow.archivedAt !== null) return err("CONFLICT", "Event is archived");
      if (eventRow.signupLocked) return err("CONFLICT", "Event signup is locked");
      const existing = (await this.db.select({ id: eventParticipants.id }).from(eventParticipants).where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, user.userId))).limit(1))[0];
      if (existing) return err("CONFLICT", "Already joined");
      if (eventRow.capacity !== null) {
        const countRow = (await this.db.select({ count: sql<number>`count(*)` }).from(eventParticipants).where(eq(eventParticipants.eventId, eventId)))[0];
        if (Number(countRow?.count ?? 0) >= eventRow.capacity) return err("CONFLICT", "Event is full");
      }
      return err("SERVER_ERROR", "Failed to join event");
    }

    await this.deps.writeAuditLog({ entityType: "event_participant", action: "join_by_bot", actorId: user.userId, entityId: `${eventId}:${user.userId}`, detailText: JSON.stringify({ event_id: eventId, user_id: user.userId, source: source ?? "discord" }) });
    await this.deps.publishEntityChanged({ entityType: "event", entityId: eventId, hint: "participant_joined" });
    return ok({ ok: true, event_id: eventId, user_id: user.userId });
  }

  async leave(eventId: string, userId?: string, discordId?: string, source?: string): Promise<ServiceResult<{ ok: true; event_id: string; user_id: string }>> {
    const resolved = await this.resolveUser(userId, discordId);
    if (!resolved.ok) return resolved;
    const user = resolved.data;

    const existing = (await this.db.select({ id: eventParticipants.id }).from(eventParticipants).where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, user.userId))).limit(1))[0];
    await this.db.delete(eventParticipants).where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, user.userId)));

    if (existing) {
      await this.deps.writeAuditLog({ entityType: "event_participant", action: "leave_by_bot", actorId: user.userId, entityId: `${eventId}:${user.userId}`, detailText: JSON.stringify({ event_id: eventId, user_id: user.userId, source: source ?? "discord" }) });
      await this.deps.publishEntityChanged({ entityType: "event", entityId: eventId, hint: "participant_left" });
    }
    return ok({ ok: true, event_id: eventId, user_id: user.userId });
  }

  // --- Public: discord linking ---

  async linkStart(username: string, discordId: string): Promise<ServiceResult<{ code: string; expires_at: string; user_id: string }>> {
    const user = (await this.db.select({ id: users.id, deletedAt: users.deletedAt, isActive: users.isActive }).from(users).where(eq(users.username, username)).limit(1))[0];
    if (!user || user.deletedAt !== null || !user.isActive) return err("NOT_FOUND", "Username not found");

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await this.db.update(discordLinkCodes).set({ used: true }).where(and(eq(discordLinkCodes.discordId, discordId), eq(discordLinkCodes.used, false)));
    await this.db.insert(discordLinkCodes).values({ id: nanoid(), userId: user.id, discordId, code, expiresAt, used: false });
    await this.deps.writeAuditLog({ entityType: "discord_link", action: "link_start", actorId: user.id, entityId: user.id, detailText: JSON.stringify({ discord_id: discordId }) });
    return ok({ code, expires_at: expiresAt, user_id: user.id });
  }

  async linkVerify(code: string, discordId: string): Promise<ServiceResult<{ ok: true; user_id: string; discord_id: string }>> {
    const nowIso = new Date().toISOString();
    const linkCode = (await this.db.select({ id: discordLinkCodes.id, userId: discordLinkCodes.userId }).from(discordLinkCodes).where(and(eq(discordLinkCodes.code, code), eq(discordLinkCodes.discordId, discordId), eq(discordLinkCodes.used, false), sql`${discordLinkCodes.expiresAt} > ${nowIso}`)).limit(1))[0];
    if (!linkCode) return err("UNAUTHORIZED", "Invalid or expired code");

    const hasProfile = (await this.db.select({ id: memberProfiles.id }).from(memberProfiles).where(eq(memberProfiles.userId, linkCode.userId)).limit(1))[0];
    if (!hasProfile) {
      await this.db.insert(memberProfiles).values({ id: nanoid(), userId: linkCode.userId, power: 0, classes: "[]", images: "[]", videoUrls: "[]", discordReminderOptOut: false });
    }

    await this.db.update(discordLinkCodes).set({ used: true }).where(eq(discordLinkCodes.id, linkCode.id));
    await this.db.update(memberProfiles).set({ discordId, updatedAt: nowIso }).where(eq(memberProfiles.userId, linkCode.userId));
    await this.deps.writeAuditLog({ entityType: "discord_link", action: "link_verify", actorId: linkCode.userId, entityId: linkCode.userId, detailText: JSON.stringify({ discord_id: discordId }) });
    return ok({ ok: true, user_id: linkCode.userId, discord_id: discordId });
  }

  // --- Public: task status ---

  async updateTaskStatus(taskId: string, status: string, errorMessage?: string, messageId?: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = (await this.db.select({ id: botDeliveryLog.id }).from(botDeliveryLog).where(eq(botDeliveryLog.id, taskId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Task not found");

    const nowIso = new Date().toISOString();
    const patch: Partial<typeof botDeliveryLog.$inferInsert> = { status: status as typeof botDeliveryLog.status.enumValues[number] };

    if (status === "sent") {
      patch.sentAt = nowIso;
      patch.lastError = null;
      patch.nextAttemptAt = null;
      if (messageId) patch.messageId = messageId;
    }
    if (status === "failed") {
      patch.lastError = errorMessage ?? "bot runtime delivery failure";
      patch.nextAttemptAt = new Date(Date.now() + 2 * 60_000).toISOString();
    }
    if (status === "queued" || status === "sending") {
      patch.lastError = null;
    }

    await this.db.update(botDeliveryLog).set(patch).where(eq(botDeliveryLog.id, taskId));
    return ok({ ok: true });
  }

  // --- Public: bot data queries (raw D1) ---

  async getUpcomingEvents(): Promise<ServiceResult<unknown[]>> {
    const nowIso = new Date().toISOString();
    const endIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.deps.d1.prepare(
      `SELECT id, title, type, start_at, capacity FROM events WHERE archived_at IS NULL AND start_at >= ?1 AND start_at <= ?2 ORDER BY start_at ASC LIMIT 30`,
    ).bind(nowIso, endIso).all();
    return ok((result.results ?? []) as unknown[]);
  }

  async getRoster(): Promise<ServiceResult<unknown[]>> {
    const result = await this.deps.d1.prepare(
      `SELECT u.id AS user_id, u.username AS username, mp.wechat_name AS wechat_name, coalesce(mp.power, 0) AS power, json_extract(coalesce(mp.classes, '[]'), '$[0]') AS class_name FROM users u LEFT JOIN member_profiles mp ON mp.user_id = u.id WHERE u.deleted_at IS NULL AND u.is_active = 1 ORDER BY coalesce(mp.power, 0) DESC, u.username ASC LIMIT 120`,
    ).all();
    return ok((result.results ?? []) as unknown[]);
  }

  async getLatestWarWithTeams(): Promise<ServiceResult<{ war: unknown; teams: unknown[] }>> {
    const latestWarResult = await this.deps.d1.prepare(
      `SELECT id, war_name, created_at FROM war_history ORDER BY created_at DESC LIMIT 1`,
    ).all();
    const latestWar = (latestWarResult.results?.[0] ?? null) as { id: string; war_name: string; created_at: string } | null;
    if (!latestWar) return ok({ war: null, teams: [] });

    const teamsResult = await this.deps.d1.prepare(
      `SELECT id, team_name, notes, is_locked FROM war_teams WHERE war_history_id = ?1 ORDER BY sort_order ASC, team_name ASC`,
    ).bind(latestWar.id).all();
    const teams = (teamsResult.results ?? []) as Array<{ id: string; team_name: string; notes: string | null; is_locked: number | boolean }>;

    const teamIds = teams.map((t) => t.id);
    let allMembers: Array<{ war_team_id: string; user_id: string; role_tag: string | null; username: string; wechat_name: string | null; power: number; classes: string | null; sort_order: number }> = [];
    if (teamIds.length > 0) {
      const placeholders = teamIds.map((_, i) => `?${i + 1}`).join(", ");
      const membersResult = await this.deps.d1.prepare(
        `SELECT tm.war_team_id, tm.user_id, tm.role_tag, tm.sort_order, u.username, mp.wechat_name, coalesce(mp.power, 0) AS power, mp.classes FROM war_team_members tm INNER JOIN users u ON u.id = tm.user_id LEFT JOIN member_profiles mp ON mp.user_id = u.id WHERE tm.war_team_id IN (${placeholders}) ORDER BY tm.sort_order ASC, u.username ASC`,
      ).bind(...teamIds).all();
      allMembers = (membersResult.results ?? []) as typeof allMembers;
    }

    const membersByTeam = new Map<string, typeof allMembers>();
    for (const m of allMembers) {
      const list = membersByTeam.get(m.war_team_id) ?? [];
      list.push(m);
      membersByTeam.set(m.war_team_id, list);
    }

    const enrichedTeams = teams.map((team) => {
      const members = (membersByTeam.get(team.id) ?? []).map((m) => {
        const classes = parseJsonStringArray(m.classes);
        return { user_id: m.user_id, username: m.username, wechat_name: m.wechat_name, power: Number(m.power ?? 0), class_name: classes[0] ?? null, role_tag: m.role_tag };
      });
      return { id: team.id, team_name: team.team_name, notes: team.notes, is_locked: Boolean(team.is_locked), members };
    });

    return ok({ war: latestWar, teams: enrichedTeams });
  }

  async getMemberStats(memberName?: string, discordId?: string): Promise<ServiceResult<{ member: unknown; wars: unknown[] }>> {
    let target: { user_id: string; username: string } | null = null;
    if (memberName) {
      const byNameResult = await this.deps.d1.prepare(
        `SELECT id AS user_id, username FROM users WHERE deleted_at IS NULL AND lower(username) = lower(?1) LIMIT 1`,
      ).bind(memberName).all();
      target = (byNameResult.results?.[0] ?? null) as { user_id: string; username: string } | null;
    } else if (discordId) {
      const byDiscordResult = await this.deps.d1.prepare(
        `SELECT u.id AS user_id, u.username FROM users u INNER JOIN member_profiles mp ON mp.user_id = u.id WHERE u.deleted_at IS NULL AND mp.discord_id = ?1 LIMIT 1`,
      ).bind(discordId).all();
      target = (byDiscordResult.results?.[0] ?? null) as { user_id: string; username: string } | null;
    }
    if (!target) return err("NOT_FOUND", "Target member not found");

    const rowsResult = await this.deps.d1.prepare(
      `SELECT wh.id AS war_id, wh.war_name, wh.created_at, tm.damage, tm.healing, tm.building_damage, tm.kills, tm.deaths, tm.assists, tm.credits FROM war_team_members tm INNER JOIN war_teams wt ON wt.id = tm.war_team_id INNER JOIN war_history wh ON wh.id = wt.war_history_id WHERE tm.user_id = ?1 ORDER BY wh.created_at DESC LIMIT 5`,
    ).bind(target.user_id).all();
    return ok({ member: target, wars: (rowsResult.results ?? []) as unknown[] });
  }

  // --- Public: reminder preference ---

  async toggleReminder(discordId: string, mode: "on" | "off"): Promise<ServiceResult<{ ok: true; mode: string }>> {
    const linked = (await this.db.select({ userId: memberProfiles.userId }).from(memberProfiles).innerJoin(users, eq(users.id, memberProfiles.userId)).where(and(eq(memberProfiles.discordId, discordId), isNull(users.deletedAt))).limit(1))[0];
    if (!linked) return err("NOT_FOUND", "Linked member not found");

    await this.db.update(memberProfiles).set({ discordReminderOptOut: mode === "off", updatedAt: new Date().toISOString() }).where(eq(memberProfiles.userId, linked.userId));
    await this.deps.writeAuditLog({ entityType: "member_profile", action: "toggle_discord_reminder", actorId: linked.userId, entityId: linked.userId, detailText: JSON.stringify({ mode, source: "bot_command" }) });
    return ok({ ok: true, mode });
  }
}
