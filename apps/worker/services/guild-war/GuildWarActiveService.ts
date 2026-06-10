import { eventSchema } from "@guild/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { eventParticipants, events, users, warTeamMembers } from "../../db/schema";
import { err, ok, type ServiceResult } from "../result";
import {
  buildActiveEtag,
  GuildWarCoreService,
  toMemberPayload,
  toTeamPayload,
  type DrizzleDb,
  type GuildWarServiceDeps,
  type MoveMembersInput,
  type RoleTagUpdatesInput,
  type SaveTeamsInput,
  type WarTemplateSnapshot,
} from "./GuildWarCoreService";

type EventPayload = z.infer<typeof eventSchema> | null;

type GuildWarFacade = Pick<
  GuildWarCoreService,
  "getTeamsForEvent" | "getMembersForTeams"
>;

export class GuildWarActiveService extends GuildWarCoreService {
  constructor(db: DrizzleDb, deps: GuildWarServiceDeps, private readonly facade?: GuildWarFacade) {
    super(db, deps);
  }

  override getTeamsForEvent(eventId: string) {
    return this.facade?.getTeamsForEvent(eventId) ?? super.getTeamsForEvent(eventId);
  }

  override getMembersForTeams(teamIds: string[]) {
    return this.facade?.getMembersForTeams(teamIds) ?? super.getMembersForTeams(teamIds);
  }

  override getPoolMembersForEvent(eventId: string) {
    return super.getPoolMembersForEvent(eventId);
  }

  private async getEventPayload(eventId: string): Promise<EventPayload> {
    const eventRow = (await this.db.select({ id: events.id, type: events.type, title: events.title, description: events.description, startAt: events.startAt, endAt: events.endAt, capacity: events.capacity, pinned: events.pinned, signupLocked: events.signupLocked, autoArchive: events.autoArchive, autoArchived: events.autoArchived, visibleAt: events.visibleAt, archivedAt: events.archivedAt, createdBy: events.createdBy, updatedBy: events.updatedBy, seriesId: events.seriesId, instanceDate: events.instanceDate, createdAt: events.createdAt, updatedAt: events.updatedAt }).from(events).where(eq(events.id, eventId)).limit(1))[0];
    if (!eventRow) return null;
    return eventSchema.parse({ id: eventRow.id, type: eventRow.type, title: eventRow.title, description: eventRow.description, start_at: eventRow.startAt, end_at: eventRow.endAt ?? null, capacity: eventRow.capacity ?? null, pinned: eventRow.pinned, signup_locked: eventRow.signupLocked, auto_archive: eventRow.autoArchive, auto_archived: eventRow.autoArchived, visible_at: eventRow.visibleAt ?? null, archived_at: eventRow.archivedAt ?? null, created_by: eventRow.createdBy, updated_by: eventRow.updatedBy ?? null, series_id: eventRow.seriesId ?? null, instance_date: eventRow.instanceDate ?? null, created_at: eventRow.createdAt, updated_at: eventRow.updatedAt });
  }

  private async getEventParticipantUserIds(eventId: string): Promise<string[]> {
    const rows = await this.db.select({ userId: eventParticipants.userId }).from(eventParticipants).where(eq(eventParticipants.eventId, eventId));
    return rows.map((r) => r.userId);
  }

  async replaceEventTeams(eventId: string, snapshot: WarTemplateSnapshot): Promise<void> {
    const { rawDb } = this.deps;
    const existingTeams = await this.getTeamsForEvent(eventId);
    const stmts: D1PreparedStatement[] = [];

    for (const team of existingTeams) {
      stmts.push(rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id = ?1").bind(team.id));
    }
    stmts.push(rawDb.prepare("DELETE FROM war_teams WHERE event_id = ?1").bind(eventId));
    stmts.push(rawDb.prepare("DELETE FROM war_pool_members WHERE event_id = ?1").bind(eventId));

    for (const team of snapshot.teams) {
      const teamId = nanoid();
      stmts.push(rawDb.prepare("INSERT INTO war_teams (id, event_id, team_name, sort_order, notes, is_locked) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(teamId, eventId, team.team_name, team.sort_order, team.notes ?? null, team.is_locked ? 1 : 0));
      for (const member of team.members) {
        stmts.push(rawDb.prepare("INSERT INTO war_team_members (id, war_team_id, user_id, role_tag, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)").bind(nanoid(), teamId, member.user_id, member.role_tag ?? null, member.sort_order));
      }
    }

    for (const poolMember of snapshot.pool_members) {
      stmts.push(rawDb.prepare("INSERT INTO war_pool_members (id, event_id, user_id) VALUES (?1, ?2, ?3)").bind(nanoid(), eventId, poolMember.user_id));
    }

    await rawDb.batch(stmts);
  }

  async getActive(eventId?: string): Promise<ServiceResult<unknown>> {
    if (!eventId) return ok({ war_history: null, event: null, teams: [], pool: [], participants: [], etag: null });

    const teams = await this.getTeamsForEvent(eventId);
    const teamIds = teams.map((t) => t.id);
    const members = await this.getMembersForTeams(teamIds);
    const dbPool = await this.getPoolMembersForEvent(eventId);
    const participantUserIds = await this.getEventParticipantUserIds(eventId);

    if (teams.length === 0 && dbPool.length === 0) {
      const eventPayload = await this.getEventPayload(eventId);
      const virtualPool = participantUserIds.map((userId) => ({ id: `virtual:${userId}`, warHistoryId: null, eventId, userId }));
      return ok({
        war_history: null, event: eventPayload, etag: null,
        teams: [], pool: virtualPool,
        participants: participantUserIds.map((uid) => ({ user_id: uid })),
      });
    }

    const assignedUserIds = new Set([
      ...members.map((m) => m.userId),
      ...dbPool.map((p) => p.userId),
    ]);
    const virtualPoolAdditions = participantUserIds
      .filter((uid) => !assignedUserIds.has(uid))
      .map((uid) => ({ id: `virtual:${uid}`, warHistoryId: null, eventId, userId: uid }));

    const eventPayload = await this.getEventPayload(eventId);
    const etag = buildActiveEtag(eventId, teams, members);

    return ok({
      war_history: null, event: eventPayload, etag,
      teams: teams.map((team) => ({ ...toTeamPayload(team), members: members.filter((m) => m.warTeamId === team.id).map(toMemberPayload) })),
      pool: [...dbPool.map((p) => ({ id: p.id, warHistoryId: p.warHistoryId, eventId: p.eventId, userId: p.userId })), ...virtualPoolAdditions],
      participants: participantUserIds.map((uid) => ({ user_id: uid })),
    });
  }

  async saveTeams(actorId: string, payload: SaveTeamsInput, conditionalEtag?: string): Promise<ServiceResult<{ ok: true }>> {
    const eventId = payload.event_id;
    if (conditionalEtag) {
      const teams = await this.getTeamsForEvent(eventId);
      const members = await this.getMembersForTeams(teams.map((t) => t.id));
      const expectedEtag = buildActiveEtag(eventId, teams, members);
      if (conditionalEtag !== expectedEtag) return err("CONFLICT", "Guild war roster changed, refresh and retry", { expected_etag: expectedEtag });
    }
    const snapshot: WarTemplateSnapshot = { teams: payload.teams, pool_members: payload.pool_members };
    await this.replaceEventTeams(eventId, snapshot);
    const eventRow = (await this.db.select({ title: events.title }).from(events).where(eq(events.id, eventId)).limit(1))[0];
    await this.deps.writeAuditLog({ entityType: "guild_war", action: "save_teams", actorId, entityId: eventId, diffTitle: eventRow?.title ?? null, detailText: JSON.stringify({ event_id: eventId, event_name: eventRow?.title ?? null }) });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: eventId, hint: "teams_saved" });
    return ok({ ok: true });
  }

  async moveMembers(actorId: string, eventId: string, moves: MoveMembersInput, conditionalEtag?: string): Promise<ServiceResult<{ ok: true }>> {
    if (moves.length === 0) return err("VALIDATION_ERROR", "At least one move is required");
    const teams = await this.getTeamsForEvent(eventId);
    if (conditionalEtag) {
      const members = await this.getMembersForTeams(teams.map((t) => t.id));
      const expectedEtag = buildActiveEtag(eventId, teams, members);
      if (conditionalEtag !== expectedEtag) return err("CONFLICT", "Guild war roster changed, refresh and retry", { expected_etag: expectedEtag });
    }
    const teamIds = teams.map((t) => t.id);
    const teamById = new Map(teams.map((team) => [team.id, team]));
    const userIds = [...new Set(moves.map((move) => move.user_id))];
    const missingTeam = moves.find((move) => move.to !== "pool" && move.to !== "remove" && !teamById.has(move.to));
    if (missingTeam) return err("NOT_FOUND", "Target team not found");

    const { rawDb } = this.deps;
    const stmts: D1PreparedStatement[] = [];

    if (userIds.length > 0) {
      const userPlaceholders = userIds.map((_, index) => `?${index + 2}`).join(", ");
      for (const teamId of teamIds) {
        stmts.push(rawDb.prepare(`DELETE FROM war_team_members WHERE war_team_id = ?1 AND user_id IN (${userPlaceholders})`).bind(teamId, ...userIds));
      }
      stmts.push(rawDb.prepare(`DELETE FROM war_pool_members WHERE event_id = ?1 AND user_id IN (${userPlaceholders})`).bind(eventId, ...userIds));
    }

    const removeUserIds = moves.filter((move) => move.to === "remove").map((move) => move.user_id);
    if (removeUserIds.length > 0) {
      const removePlaceholders = removeUserIds.map((_, index) => `?${index + 2}`).join(", ");
      stmts.push(rawDb.prepare(`DELETE FROM event_participants WHERE event_id = ?1 AND user_id IN (${removePlaceholders})`).bind(eventId, ...removeUserIds));
    }

    for (const move of moves) {
      if (move.to === "pool") {
        stmts.push(rawDb.prepare("INSERT INTO war_pool_members (id, event_id, user_id) VALUES (?1, ?2, ?3)").bind(nanoid(), eventId, move.user_id));
      }
    }

    const teamMoves = moves.filter((move) => move.to !== "pool" && move.to !== "remove");
    const movesByTeam = new Map<string, typeof teamMoves>();
    for (const move of teamMoves) {
      movesByTeam.set(move.to, [...(movesByTeam.get(move.to) ?? []), move]);
    }

    const destinationTeamIds = [...movesByTeam.keys()];
    const maxSortRows = destinationTeamIds.length > 0
      ? await this.db
          .select({
            warTeamId: warTeamMembers.warTeamId,
            maxSort: sql<number>`coalesce(max(${warTeamMembers.sortOrder}), -1)`,
          })
          .from(warTeamMembers)
          .where(inArray(warTeamMembers.warTeamId, destinationTeamIds))
          .groupBy(warTeamMembers.warTeamId)
      : [];
    const maxSortByTeam = new Map(maxSortRows.map((r) => [r.warTeamId, Number(r.maxSort)]));

    for (const [teamId, teamGroup] of movesByTeam) {
      let nextSort = (maxSortByTeam.get(teamId) ?? -1) + 1;
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

    await rawDb.batch(stmts);
    const targetUsers = userIds.length > 0
      ? await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds))
      : [];
    const usernamesById = new Map(targetUsers.map((user) => [user.id, user.username]));
    await this.deps.writeAuditLog({
      entityType: "guild_war",
      action: "move_member",
      actorId,
      entityId: eventId,
      diffTitle: targetUsers.map((user) => user.username).join(", ") || null,
      detailText: JSON.stringify({
        count: moves.length,
        moves: moves.map((move) => ({ ...move, username: usernamesById.get(move.user_id) ?? null })),
      }),
    });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: eventId, hint: "members_moved" });
    return ok({ ok: true });
  }

  async setRoleTag(actorId: string, eventId: string, userId: string, roleTag: string | null): Promise<ServiceResult<{ ok: true }>> {
    const result = await this.setRoleTags(actorId, eventId, [{ user_id: userId, role_tag: roleTag }]);
    if (!result.ok) return result;
    return ok({ ok: true });
  }

  async setRoleTags(actorId: string, eventId: string, updates: RoleTagUpdatesInput): Promise<ServiceResult<{ ok: true; updated: number }>> {
    if (updates.length === 0) return err("VALIDATION_ERROR", "At least one role tag update is required");
    const teams = await this.getTeamsForEvent(eventId);
    if (teams.length === 0) return err("NOT_FOUND", "No active teams found for event");
    const teamIds = teams.map((t) => t.id);
    const userIds = [...new Set(updates.map((update) => update.user_id))];
    const memberRows = await this.db
      .select({ id: warTeamMembers.id, userId: warTeamMembers.userId })
      .from(warTeamMembers)
      .where(and(inArray(warTeamMembers.warTeamId, teamIds), inArray(warTeamMembers.userId, userIds)));
    const memberByUserId = new Map(memberRows.map((row) => [row.userId, row.id]));
    const missingUserId = userIds.find((userId) => !memberByUserId.has(userId));
    if (missingUserId) return err("NOT_FOUND", "Member not found in active teams", { user_id: missingUserId });

    const stmts: D1PreparedStatement[] = updates.map((update) => {
      const nextTag = typeof update.role_tag === "string" && update.role_tag.trim().length > 0 ? update.role_tag.trim() : null;
      return this.deps.rawDb
        .prepare("UPDATE war_team_members SET role_tag = ?1 WHERE id = ?2")
        .bind(nextTag, memberByUserId.get(update.user_id));
    });
    await this.deps.rawDb.batch(stmts);

    const targetUsers = await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds));
    const usernamesById = new Map(targetUsers.map((user) => [user.id, user.username]));
    await this.deps.writeAuditLog({
      entityType: "guild_war",
      action: "set_role_tag",
      actorId,
      entityId: eventId,
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
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: eventId, hint: "role_tags_updated" });
    return ok({ ok: true, updated: updates.length });
  }
}
