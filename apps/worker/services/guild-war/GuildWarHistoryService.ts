import { updateMemberStatsSchema } from "@guild/shared";
import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { events, users, warHistory, warPoolMembers, warTeamMembers, warTeams } from "../../db/schema";
import { err, ok, type ServiceResult } from "../result";
import { escapeLikePattern, likeEscaped } from "../helpers";
import {
  GuildWarCoreService,
  toMemberPayload,
  toTeamPayload,
  toWarHistoryPayload,
  type CreateWarHistoryInput,
  type DrizzleDb,
  type GuildWarServiceDeps,
  type UpdateWarHistoryInput,
  type WarTeamMemberRow,
  type WarTemplateSnapshot,
} from "./GuildWarCoreService";

type GuildWarFacade = Pick<
  GuildWarCoreService,
  | "getWarHistoryById"
  | "getLatestWarHistory"
  | "getTeamsForEvent"
  | "getTeamsForHistory"
  | "getMembersForTeams"
  | "getPoolMembers"
  | "getPoolMembersForEvent"
> & {
  replaceHistoryTeams(warHistoryId: string, snapshot: WarTemplateSnapshot): Promise<void>;
};

const EVENT_HISTORY_CONFLICT_MESSAGE =
  "This guild war event already has a history record";

function isEventHistoryUniqueConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE constraint failed: war_history.event_id")
    || message.includes("ux_war_history_event_id");
}

function eventHistoryConflict(historyId?: string): ServiceResult<never> {
  return err(
    "CONFLICT",
    EVENT_HISTORY_CONFLICT_MESSAGE,
    historyId ? { war_history_id: historyId } : undefined,
  );
}

function buildWarHistoryDiff(
  existing: { eventId: string | null; warName: string; enemyName: string | null; result: string | null; ownStats: Record<string, number | null> | null; enemyStats: Record<string, number | null> | null; durationMinutes: number | null; notes: string | null },
  input: UpdateWarHistoryInput,
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (input.event_id !== undefined && (input.event_id ?? null) !== existing.eventId) diff.event_id = { from: existing.eventId, to: input.event_id ?? null };
  if (input.war_name !== undefined && input.war_name !== existing.warName) diff.war_name = { from: existing.warName, to: input.war_name };
  if (input.enemy_name !== undefined && (input.enemy_name ?? null) !== existing.enemyName) diff.enemy_name = { from: existing.enemyName, to: input.enemy_name ?? null };
  if (input.result !== undefined && (input.result ?? null) !== existing.result) diff.result = { from: existing.result, to: input.result ?? null };
  if (input.own_stats !== undefined && JSON.stringify(input.own_stats ?? null) !== JSON.stringify(existing.ownStats)) diff.own_stats = { from: existing.ownStats, to: input.own_stats ?? null };
  if (input.enemy_stats !== undefined && JSON.stringify(input.enemy_stats ?? null) !== JSON.stringify(existing.enemyStats)) diff.enemy_stats = { from: existing.enemyStats, to: input.enemy_stats ?? null };
  if (input.duration_minutes !== undefined && (input.duration_minutes ?? null) !== existing.durationMinutes) diff.duration_minutes = { from: existing.durationMinutes, to: input.duration_minutes ?? null };
  if (input.notes !== undefined && (input.notes ?? null) !== existing.notes) diff.notes = { from: existing.notes, to: input.notes ?? null };
  return Object.keys(diff).length > 0 ? diff : null;
}

function buildMemberStatsDiff(
  existing: { stats: Record<string, number | null> | null; note: string | null },
  input: { stats?: unknown; note?: string | null },
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (input.stats !== undefined && JSON.stringify(input.stats ?? null) !== JSON.stringify(existing.stats)) diff.stats = { from: existing.stats, to: input.stats ?? null };
  if (input.note !== undefined && (input.note ?? null) !== existing.note) diff.note = { from: existing.note, to: input.note ?? null };
  return Object.keys(diff).length > 0 ? diff : null;
}

export class GuildWarHistoryService extends GuildWarCoreService {
  constructor(db: DrizzleDb, deps: GuildWarServiceDeps, private readonly facade?: GuildWarFacade) {
    super(db, deps);
  }

  override getWarHistoryById(warId: string) {
    return this.facade?.getWarHistoryById(warId) ?? super.getWarHistoryById(warId);
  }

  override getLatestWarHistory(eventId?: string) {
    return this.facade?.getLatestWarHistory(eventId) ?? super.getLatestWarHistory(eventId);
  }

  override getTeamsForEvent(eventId: string) {
    return this.facade?.getTeamsForEvent(eventId) ?? super.getTeamsForEvent(eventId);
  }

  override getTeamsForHistory(warHistoryId: string) {
    return this.facade?.getTeamsForHistory(warHistoryId) ?? super.getTeamsForHistory(warHistoryId);
  }

  override getMembersForTeams(teamIds: string[]) {
    return this.facade?.getMembersForTeams(teamIds) ?? super.getMembersForTeams(teamIds);
  }

  override getPoolMembers(warHistoryId: string) {
    return this.facade?.getPoolMembers(warHistoryId) ?? super.getPoolMembers(warHistoryId);
  }

  override getPoolMembersForEvent(eventId: string) {
    return this.facade?.getPoolMembersForEvent(eventId) ?? super.getPoolMembersForEvent(eventId);
  }

  async getConcludedEventIds(): Promise<string[]> {
    const rows = await this.db
      .select({ eventId: warHistory.eventId })
      .from(warHistory)
      .where(and(sql`${warHistory.eventId} IS NOT NULL`, sql`${warHistory.result} IS NOT NULL`))
      .orderBy(desc(warHistory.createdAt))
      .limit(500);
    return rows.map((r) => r.eventId).filter((id): id is string => id !== null);
  }

  async concludeWar(
    actorId: string,
    eventId: string,
    warInfo: { enemy_name?: string; result: string; duration_minutes?: number | null; own_stats?: Record<string, number | null>; enemy_stats?: Record<string, number | null> },
    memberStats?: Array<{ user_id: string; stats: Record<string, number> }>,
  ): Promise<ServiceResult<{ war_history_id: string }>> {
    const existingHistory = await this.getLatestWarHistory(eventId);
    if (existingHistory) return eventHistoryConflict(existingHistory.id);

    const teams = await this.getTeamsForEvent(eventId);
    if (teams.length === 0) return err("VALIDATION_ERROR", "No active teams found for this event");
    const members = await this.getMembersForTeams(teams.map((t) => t.id));
    if (members.length === 0) return err("VALIDATION_ERROR", "No members assigned to teams");

    const eventRow = (await this.db.select({ title: events.title }).from(events).where(eq(events.id, eventId)).limit(1))[0];
    const warName = eventRow?.title ?? `Guild War ${new Date().toISOString().slice(0, 10)}`;
    const historyId = nanoid();
    const nowIso = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [];

    stmts.push(this.deps.rawDb.prepare(
      "INSERT INTO war_history (id, event_id, war_name, enemy_name, result, own_stats, enemy_stats, duration_minutes, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    ).bind(
      historyId, eventId, warName, warInfo.enemy_name ?? null, warInfo.result,
      warInfo.own_stats ? JSON.stringify(warInfo.own_stats) : null,
      warInfo.enemy_stats ? JSON.stringify(warInfo.enemy_stats) : null,
      warInfo.duration_minutes ?? null,
      actorId, nowIso, nowIso,
    ));
    stmts.push(this.deps.rawDb.prepare("UPDATE war_teams SET war_history_id = ?1, event_id = NULL WHERE event_id = ?2").bind(historyId, eventId));
    stmts.push(this.deps.rawDb.prepare("UPDATE war_pool_members SET war_history_id = ?1, event_id = NULL WHERE event_id = ?2").bind(historyId, eventId));

    if (memberStats && memberStats.length > 0) {
      const memberByUserId = new Map(members.map((m) => [m.userId, m.id]));
      for (const ms of memberStats) {
        const memberId = memberByUserId.get(ms.user_id);
        if (memberId) stmts.push(this.deps.rawDb.prepare("UPDATE war_team_members SET stats = ?1 WHERE id = ?2").bind(JSON.stringify(ms.stats), memberId));
      }
    }

    try {
      await this.deps.rawDb.batch(stmts);
    } catch (e) {
      if (isEventHistoryUniqueConflict(e)) {
        const conflictingHistory = await this.getLatestWarHistory(eventId);
        return eventHistoryConflict(conflictingHistory?.id);
      }
      console.error("concludeWar batch failed", { error: String(e), eventId });
      return err("SERVER_ERROR", "Failed to conclude war");
    }

    try {
      await this.deps.writeAuditLog({
        entityType: "guild_war_history", action: "conclude", actorId, entityId: historyId,
        diffTitle: warName,
        detailText: JSON.stringify({ event_id: eventId, result: warInfo.result, team_count: teams.length, member_count: members.length }),
      });
      await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: eventId, hint: "war_concluded" });
    } catch (postBatchErr) {
      console.error("concludeWar post-batch failed", { error: String(postBatchErr), eventId });
    }
    return ok({ war_history_id: historyId });
  }

  async replaceHistoryTeams(warHistoryId: string, snapshot: WarTemplateSnapshot): Promise<void> {
    const existingTeams = await this.getTeamsForHistory(warHistoryId);
    const stmts: D1PreparedStatement[] = [];
    for (const team of existingTeams) {
      stmts.push(this.deps.rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id = ?1").bind(team.id));
    }
    stmts.push(this.deps.rawDb.prepare("DELETE FROM war_teams WHERE war_history_id = ?1").bind(warHistoryId));
    stmts.push(this.deps.rawDb.prepare("DELETE FROM war_pool_members WHERE war_history_id = ?1").bind(warHistoryId));

    for (const team of snapshot.teams) {
      const teamId = nanoid();
      stmts.push(this.deps.rawDb.prepare("INSERT INTO war_teams (id, war_history_id, team_name, sort_order, notes, is_locked) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(teamId, warHistoryId, team.team_name, team.sort_order, team.notes ?? null, team.is_locked ? 1 : 0));
      for (const member of team.members) {
        stmts.push(this.deps.rawDb.prepare("INSERT INTO war_team_members (id, war_team_id, user_id, role_tag, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)").bind(nanoid(), teamId, member.user_id, member.role_tag ?? null, member.sort_order));
      }
    }
    for (const poolMember of snapshot.pool_members) {
      stmts.push(this.deps.rawDb.prepare("INSERT INTO war_pool_members (id, war_history_id, user_id) VALUES (?1, ?2, ?3)").bind(nanoid(), warHistoryId, poolMember.user_id));
    }
    stmts.push(this.deps.rawDb.prepare("UPDATE war_history SET updated_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), warHistoryId));
    await this.deps.rawDb.batch(stmts);
  }

  async listHistory(page: number, limit: number, filters: { dateFrom?: string; dateTo?: string; search?: string }): Promise<ServiceResult<{ data: unknown[]; total: number; page: number; limit: number; total_pages: number }>> {
    const offset = (page - 1) * limit;
    const where: SQL<unknown>[] = [];
    if (filters.dateFrom) where.push(gte(warHistory.createdAt, filters.dateFrom));
    if (filters.dateTo) where.push(lte(warHistory.createdAt, filters.dateTo));
    if (filters.search?.trim()) {
      const pattern = `%${escapeLikePattern(filters.search.trim())}%`;
      where.push(or(
        likeEscaped(warHistory.warName, pattern),
        likeEscaped(warHistory.enemyName, pattern),
        likeEscaped(warHistory.result, pattern),
        likeEscaped(warHistory.createdAt, pattern),
        likeEscaped(warHistory.ownStats, pattern),
        likeEscaped(warHistory.enemyStats, pattern),
      )!);
    }
    const whereClause = where.length > 0 ? and(...where) : undefined;
    const selectFields = { id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, updatedBy: warHistory.updatedBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt };
    const [rows, countRow] = await Promise.all([
      this.db.select(selectFields).from(warHistory).where(whereClause).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(limit).offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(warHistory).where(whereClause),
    ]);
    const total = Number(countRow[0]?.count ?? 0);
    return ok({ data: rows.map(toWarHistoryPayload), total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)) });
  }

  async batchHistory(ids: string[]): Promise<ServiceResult<{ data: unknown[] }>> {
    const histories = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, updatedBy: warHistory.updatedBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(inArray(warHistory.id, ids));
    const allTeams = await this.db.select({ id: warTeams.id, warHistoryId: warTeams.warHistoryId, eventId: warTeams.eventId, teamName: warTeams.teamName, sortOrder: warTeams.sortOrder, notes: warTeams.notes, isLocked: warTeams.isLocked }).from(warTeams).where(inArray(warTeams.warHistoryId, ids)).orderBy(asc(warTeams.sortOrder), asc(warTeams.id));
    const allMembers = allTeams.length > 0 ? await this.getMembersForTeams(allTeams.map((t) => t.id)) : [];
    const allPool = await this.db.select({ id: warPoolMembers.id, warHistoryId: warPoolMembers.warHistoryId, eventId: warPoolMembers.eventId, userId: warPoolMembers.userId }).from(warPoolMembers).where(inArray(warPoolMembers.warHistoryId, ids));
    const usernameMap = await this.getUsernameMap([...new Set([...allMembers.map((m) => m.userId), ...allPool.map((p) => p.userId)])]);
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
    const usernameMap = await this.getUsernameMap([...new Set([...members.map((m) => m.userId), ...pool.map((p) => p.userId)])]);
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
    try {
      await this.db.insert(warHistory).values({ id: historyId, eventId: input.event_id ?? null, warName: input.war_name, enemyName: input.enemy_name ?? null, result: input.result ?? null, ownStats: input.own_stats ?? null, enemyStats: input.enemy_stats ?? null, notes: input.notes ?? null, createdBy: actorId });
    } catch (error) {
      if (isEventHistoryUniqueConflict(error)) {
        const conflictingHistory = input.event_id
          ? await this.getLatestWarHistory(input.event_id)
          : null;
        return eventHistoryConflict(conflictingHistory?.id);
      }
      console.error("createHistory insert failed", { error: String(error) });
      return err("SERVER_ERROR", "Failed to create war history");
    }
    if (input.event_id) {
      const teams = await this.getTeamsForEvent(input.event_id);
      const members = await this.getMembersForTeams(teams.map((team) => team.id));
      const pool = await this.getPoolMembersForEvent(input.event_id);
      if (teams.length > 0 || pool.length > 0) {
        await (this.facade ?? this).replaceHistoryTeams(historyId, {
          teams: teams.map((team) => ({
            team_name: team.teamName,
            sort_order: team.sortOrder,
            notes: team.notes ?? undefined,
            is_locked: team.isLocked,
            members: members
              .filter((member) => member.warTeamId === team.id)
              .map((member) => ({ user_id: member.userId, role_tag: member.roleTag ?? undefined, sort_order: member.sortOrder })),
          })),
          pool_members: pool.map((member) => ({ user_id: member.userId })),
        });
      }
    }
    const created = await this.getWarHistoryById(historyId);
    if (!created) return err("SERVER_ERROR", "Failed to create war history");
    await this.deps.writeAuditLog({ entityType: "guild_war_history", action: "create", actorId, entityId: historyId, diffTitle: created.warName });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: historyId, hint: "history_created" });
    return ok(toWarHistoryPayload(created));
  }

  async updateHistory(actorId: string, warId: string, input: UpdateWarHistoryInput): Promise<ServiceResult<unknown>> {
    const existing = await this.getWarHistoryById(warId);
    if (!existing) return err("NOT_FOUND", "War history not found");
    const patch: Partial<typeof warHistory.$inferInsert> = { updatedAt: new Date().toISOString(), updatedBy: actorId };
    if (input.event_id !== undefined) patch.eventId = input.event_id;
    if (input.war_name !== undefined) patch.warName = input.war_name;
    if (input.enemy_name !== undefined) patch.enemyName = input.enemy_name;
    if (input.result !== undefined) patch.result = input.result;
    if (input.own_stats !== undefined) patch.ownStats = input.own_stats;
    if (input.enemy_stats !== undefined) patch.enemyStats = input.enemy_stats;
    if (input.duration_minutes !== undefined) patch.durationMinutes = input.duration_minutes;
    if (input.notes !== undefined) patch.notes = input.notes;
    try {
      await this.db.update(warHistory).set(patch).where(eq(warHistory.id, warId));
    } catch (error) {
      if (isEventHistoryUniqueConflict(error)) {
        const conflictingHistory = input.event_id
          ? await this.getLatestWarHistory(input.event_id)
          : null;
        return eventHistoryConflict(conflictingHistory?.id);
      }
      console.error("updateHistory write failed", { error: String(error), warId });
      return err("SERVER_ERROR", "Failed to update war history");
    }
    const updated = await this.getWarHistoryById(warId);
    if (!updated) return err("SERVER_ERROR", "Failed to load updated war history");
    const historyDiff = buildWarHistoryDiff(existing, input);
    await this.deps.writeAuditLog({ entityType: "guild_war_history", action: "update", actorId, entityId: warId, diffTitle: updated.warName, detailText: historyDiff ? JSON.stringify(historyDiff) : null });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: warId, hint: "history_updated" });
    return ok(toWarHistoryPayload(updated));
  }

  async deleteHistory(actorId: string, warId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getWarHistoryById(warId);
    if (!existing) return err("NOT_FOUND", "War history not found");
    const teamIds = (await this.db.select({ id: warTeams.id }).from(warTeams).where(eq(warTeams.warHistoryId, warId))).map((r) => r.id);
    const stmts: D1PreparedStatement[] = [];
    for (const teamId of teamIds) stmts.push(this.deps.rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id = ?1").bind(teamId));
    stmts.push(this.deps.rawDb.prepare("DELETE FROM war_teams WHERE war_history_id = ?1").bind(warId));
    stmts.push(this.deps.rawDb.prepare("DELETE FROM war_pool_members WHERE war_history_id = ?1").bind(warId));
    stmts.push(this.deps.rawDb.prepare("DELETE FROM war_history WHERE id = ?1").bind(warId));
    await this.deps.rawDb.batch(stmts);
    await this.deps.writeAuditLog({ entityType: "guild_war_history", action: "delete", actorId, entityId: warId, diffTitle: existing.warName });
    await this.deps.publishEntityChanged({ entityType: "guild_war", entityId: warId, hint: "history_deleted" });
    return ok({ ok: true });
  }

  async batchDeleteHistory(actorId: string, warIds: string[]): Promise<ServiceResult<{ ok: true; deleted: number }>> {
    if (warIds.length === 0) return ok({ ok: true, deleted: 0 });
    const existingRows = await this.db.select({ id: warHistory.id, warName: warHistory.warName }).from(warHistory).where(inArray(warHistory.id, warIds));
    const existingIds = existingRows.map((r) => r.id);
    if (existingIds.length === 0) return ok({ ok: true, deleted: 0 });
    const allTeamRows = await this.db.select({ id: warTeams.id }).from(warTeams).where(inArray(warTeams.warHistoryId, existingIds));
    const stmts: D1PreparedStatement[] = [];
    for (const teamId of allTeamRows.map((r) => r.id)) {
      stmts.push(this.deps.rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id = ?1").bind(teamId));
    }
    for (const warId of existingIds) {
      stmts.push(this.deps.rawDb.prepare("DELETE FROM war_teams WHERE war_history_id = ?1").bind(warId));
      stmts.push(this.deps.rawDb.prepare("DELETE FROM war_pool_members WHERE war_history_id = ?1").bind(warId));
      stmts.push(this.deps.rawDb.prepare("DELETE FROM war_history WHERE id = ?1").bind(warId));
    }
    await this.deps.rawDb.batch(stmts);
    await Promise.all(existingRows.map((row) => Promise.all([
      this.deps.writeAuditLog({ entityType: "guild_war_history", action: "delete", actorId, entityId: row.id, diffTitle: row.warName }),
      this.deps.publishEntityChanged({ entityType: "guild_war", entityId: row.id, hint: "history_deleted" }),
    ])));
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
    const memberDiff = buildMemberStatsDiff(memberRow, input);
    await this.deps.writeAuditLog({ entityType: "guild_war_member_stats", action: "update", actorId, entityId: `${warId}:${targetUserId}`, diffTitle: targetUser?.username ?? null, detailText: memberDiff ? JSON.stringify(memberDiff) : null });
    return ok(toMemberPayload(refreshed));
  }

  async batchUpdateMemberStats(actorId: string, warId: string, updates: Array<{ user_id: string; stats: unknown }>): Promise<ServiceResult<{ data: unknown[] }>> {
    const existingHistory = await this.getWarHistoryById(warId);
    if (!existingHistory) return err("NOT_FOUND", "War history not found");
    const userIds = updates.map((u) => u.user_id).filter((id) => typeof id === "string" && id.length > 0);
    const memberRows = await this.db.select({ id: warTeamMembers.id, warTeamId: warTeamMembers.warTeamId, userId: warTeamMembers.userId, roleTag: warTeamMembers.roleTag, sortOrder: warTeamMembers.sortOrder, stats: warTeamMembers.stats, note: warTeamMembers.note }).from(warTeamMembers).innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId)).where(and(eq(warTeams.warHistoryId, warId), inArray(warTeamMembers.userId, userIds)));
    const memberByUserId = new Map(memberRows.map((m) => [m.userId, m]));
    const results: ReturnType<typeof toMemberPayload>[] = [];
    const pendingPatches: Array<{ memberRow: WarTeamMemberRow; patch: Partial<typeof warTeamMembers.$inferInsert> }> = [];

    for (const update of updates) {
      const memberRow = memberByUserId.get(update.user_id);
      if (!memberRow) continue;
      const parsed = updateMemberStatsSchema.safeParse(update.stats);
      if (!parsed.success) continue;
      const patch: Partial<typeof warTeamMembers.$inferInsert> = {};
      if (parsed.data.stats !== undefined) patch.stats = parsed.data.stats;
      if (parsed.data.note !== undefined) patch.note = parsed.data.note;
      if (Object.keys(patch).length > 0) pendingPatches.push({ memberRow, patch });
      else results.push(toMemberPayload(memberRow));
    }

    if (pendingPatches.length > 0) {
      const stmts: D1PreparedStatement[] = pendingPatches.map(({ memberRow, patch }) => {
        const setClauses: string[] = [];
        const bindings: unknown[] = [];
        let paramIdx = 1;
        if (patch.stats !== undefined) { setClauses.push(`stats = ?${paramIdx++}`); bindings.push(JSON.stringify(patch.stats)); }
        if (patch.note !== undefined) { setClauses.push(`note = ?${paramIdx++}`); bindings.push(patch.note); }
        bindings.push(memberRow.id);
        return this.deps.rawDb.prepare(`UPDATE war_team_members SET ${setClauses.join(", ")} WHERE id = ?${paramIdx}`).bind(...(bindings as Parameters<D1PreparedStatement["bind"]>));
      });
      await this.deps.rawDb.batch(stmts);
      for (const { memberRow, patch } of pendingPatches) {
        const merged: WarTeamMemberRow = { ...memberRow, ...(patch as Partial<WarTeamMemberRow>) };
        results.push(toMemberPayload(merged));
      }
    }

    const targetNames = await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds));
    await this.deps.writeAuditLog({ entityType: "guild_war_member_stats", action: "batch_update", actorId, entityId: warId, diffTitle: targetNames.map((r) => r.username).join(", "), detailText: JSON.stringify({ count: results.length, user_ids: userIds, usernames: targetNames.map((r) => r.username) }) });
    return ok({ data: results });
  }
}
