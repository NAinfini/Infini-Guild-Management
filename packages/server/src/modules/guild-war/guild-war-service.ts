import { AppError, type RequestContext } from "@guild/kernel";
import type { SiteAnalyticsSettings } from "@guild/shared";
import type { PushHint } from "@guild/shared/constants/push-hints";
import type { WarResult } from "@guild/shared/constants/guild-war";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { nanoid } from "nanoid";
import { createAuditMutation } from "@guild/server/modules/audit";
import {
  eventViewer,
  projectEventForViewer,
  type EventViewerAggregate,
} from "@guild/server/modules/events";
import type {
  GuildWarAggregate,
  GuildWarRecord,
  GuildWarServiceDependencies,
  HistoryListQuery,
  HistoryPatch,
  MemberStats,
  RosterPoolInput,
  RosterTeamInput,
  TeamStats,
  WarMemberRecord,
} from "./model.js";
import { assertPortableLikeSearch } from "../../portable-search.js";

const MAX_PAGE_SIZE = 100;
const MAX_HISTORY_BATCH = 50;
const MAX_ANALYTICS_WARS = 20;
const MAX_ANALYTICS_USERS = 100;

export type GuildWarActiveView = Readonly<{
  war: GuildWarAggregate["war"] | null;
  event: EventViewerAggregate | null;
  teams: GuildWarAggregate["teams"];
  pool: readonly WarMemberRecord[];
  participants: readonly Readonly<{ user_id: string }>[];
  etag: string | null;
}>;

export type GuildWarAnalytics = Readonly<{
  wars: readonly Readonly<GuildWarRecord & {
    teamSize: number;
    modifier: number;
    modifierBreakdown: readonly ModifierBreakdown[];
  }>[];
  memberStats: readonly Readonly<{ userId: string; stats: MemberStats }>[];
  settings: SiteAnalyticsSettings;
}>;

type ModifierBreakdown = Readonly<{
  factor: string;
  ratio: number;
  weight: number;
  contribution: number;
}>;

type SaveTeamsInput = Readonly<{
  event_id: string;
  teams: readonly Readonly<{
    id?: string;
    team_name: string;
    sort_order: number;
    notes?: string;
    is_locked?: boolean;
    members: readonly Readonly<{ user_id: string; role_tag?: string; sort_order: number }>[];
  }>[];
  pool_members: readonly Readonly<{ user_id: string }>[];
}>;

type WarInfoInput = Readonly<{
  enemy_name?: string;
  result: WarResult;
  duration_minutes?: number | null;
  own_stats?: TeamStats;
  enemy_stats?: TeamStats;
}>;

type HistoryInput = Readonly<{
  event_id?: string;
  war_name: string;
  enemy_name?: string;
  result: WarResult;
  own_stats?: TeamStats;
  enemy_stats?: TeamStats;
  duration_minutes?: number;
  notes?: string;
}>;

type HistoryUpdateInput = Partial<HistoryInput>;

type MemberStatsUpdate = Readonly<{ stats?: MemberStats; note?: string | null }>;

export class GuildWarService {
  private readonly createId: () => string;

  constructor(private readonly dependencies: GuildWarServiceDependencies) {
    this.createId = dependencies.createId ?? nanoid;
  }

  async active(context: RequestContext, eventId?: string): Promise<GuildWarActiveView> {
    if (!eventId) return emptyActive();
    const event = await this.dependencies.events.findVisible(context, eventId);
    if (!event || event.event.type !== "guild_war") throw notFound("Guild war event not found");
    const viewerEvent = projectEventForViewer(event, eventViewer(context));
    const aggregate = await this.dependencies.store.getByEvent(eventId);
    const participants = event.participants.map(({ user_id }) => ({ user_id }));
    if (!aggregate || aggregate.war.status !== "active") {
      return {
        war: null,
        event: viewerEvent,
        teams: [],
        pool: virtualPool(eventId, event.participants.map(({ user_id }) => user_id)),
        participants,
        etag: null,
      };
    }
    const placed = new Set([
      ...aggregate.pool.map(({ userId }) => userId),
      ...aggregate.teams.flatMap((team) => team.members.map(({ userId }) => userId)),
    ]);
    const additions = virtualPool(
      eventId,
      event.participants.map(({ user_id }) => user_id).filter((userId) => !placed.has(userId)),
    );
    return {
      war: aggregate.war,
      event: viewerEvent,
      teams: aggregate.teams,
      pool: [...aggregate.pool, ...additions],
      participants,
      etag: activeEtag(aggregate.war),
    };
  }

  concludedEventIds(): Promise<readonly string[]> {
    return this.dependencies.store.concludedEventIds();
  }

  async saveTeams(
    context: RequestContext,
    input: SaveTeamsInput,
    ifMatch?: string,
  ): Promise<Readonly<{ ok: true }>> {
    const actor = context.authorization.require(PERMISSION_ID.GUILD_WAR_TEAMS_EDIT);
    const event = await this.dependencies.events.getGuildWarTarget(context, input.event_id);
    const participantIds = new Set(event.participants.map(({ user_id }) => user_id));
    const nonParticipant = [
      ...input.teams.flatMap((team) => team.members.map(({ user_id }) => user_id)),
      ...input.pool_members.map(({ user_id }) => user_id),
    ].find((userId) => !participantIds.has(userId));
    if (nonParticipant) throw validation("Guild war roster members must be event participants", { user_id: nonParticipant });
    const aggregate = await this.ensureActive(context, input.event_id, event.event.title, actor.userId);
    assertEtag(ifMatch, aggregate.war);
    const existingTeamIds = new Set(aggregate.teams.map(({ id }) => id));
    for (const team of input.teams) {
      if (team.id && !existingTeamIds.has(team.id)) {
        throw validation("Team does not belong to this guild war event", { team_id: team.id });
      }
    }
    const teams: RosterTeamInput[] = input.teams.map((team) => ({
      id: team.id ?? this.createId(),
      teamName: team.team_name.trim(),
      sortOrder: team.sort_order,
      notes: team.notes?.trim() || null,
      isLocked: team.is_locked ?? false,
      members: team.members.map((member) => ({
        id: this.createId(),
        userId: member.user_id,
        roleTag: member.role_tag?.trim() || null,
        sortOrder: member.sort_order,
      })),
    }));
    const pool: RosterPoolInput[] = input.pool_members.map((member, sortOrder) => ({
      id: this.createId(),
      userId: member.user_id,
      sortOrder,
    }));
    const audit = createAuditMutation(context, {
      entityType: "guild_war",
      entityId: input.event_id,
      action: "save_teams",
      summary: event.event.title,
      details: { team_count: teams.length, member_count: teams.reduce((sum, team) => sum + team.members.length, 0) },
    });
    const changed = await this.dependencies.store.replaceRoster({
      warId: aggregate.war.id,
      eventId: input.event_id,
      expectedVersion: aggregate.war.rosterVersion,
      actorUserId: actor.userId,
      now: context.now,
      teams,
      pool,
      audit,
    });
    if (!changed) throw conflict();
    this.publish(input.event_id, "teams_saved", context.now);
    return { ok: true };
  }

  async moveMembers(
    context: RequestContext,
    eventId: string,
    moves: readonly Readonly<{ user_id: string; to: string }>[],
    ifMatch?: string,
  ): Promise<Readonly<{ ok: true }>> {
    const actor = context.authorization.require(PERMISSION_ID.GUILD_WAR_TEAMS_EDIT);
    const removesParticipants = moves.some(({ to }) => to === "remove");
    if (removesParticipants) context.authorization.require(PERMISSION_ID.EVENTS_EDIT);
    const event = await this.dependencies.events.getGuildWarTarget(context, eventId);
    const participantIds = new Set(event.participants.map(({ user_id }) => user_id));
    const nonParticipant = moves.find(({ user_id, to }) => to !== "pool" && !participantIds.has(user_id));
    if (nonParticipant) throw validation("Guild war roster members must be event participants", { user_id: nonParticipant.user_id });
    const participantAdditions = new Set(
      moves.filter(({ user_id, to }) => to === "pool" && !participantIds.has(user_id)).map(({ user_id }) => user_id),
    );
    const aggregate = await this.ensureActive(context, eventId, event.event.title, actor.userId);
    assertEtag(ifMatch, aggregate.war);
    const teamIds = new Set(aggregate.teams.map(({ id }) => id));
    const invalid = moves.find(({ to }) => to !== "pool" && to !== "remove" && !teamIds.has(to));
    if (invalid) throw notFound("Target team not found");
    const audit = createAuditMutation(context, {
      entityType: "guild_war",
      entityId: eventId,
      action: "move_member",
      summary: event.event.title,
      details: { moves: moves.map((move) => ({ user_id: move.user_id, to: move.to })) },
    });
    const changed = await this.dependencies.eventRoster.moveMembers({
      warId: aggregate.war.id,
      eventId,
      expectedVersion: aggregate.war.rosterVersion,
      actorUserId: actor.userId,
      now: context.now,
      moves: moves.map((move) => ({
        id: this.createId(),
        userId: move.user_id,
        to: move.to,
        participantId: participantAdditions.has(move.user_id) ? this.createId() : null,
      })),
      audit,
    });
    if (!changed) throw conflict();
    this.publish(eventId, "members_moved", context.now);
    if (participantAdditions.size > 0) {
      this.publish(eventId, "participants_added_by_moderator", context.now, "event");
    }
    if (removesParticipants) {
      this.publish(eventId, "participants_removed_by_moderator", context.now, "event");
    }
    return { ok: true };
  }

  async setRoleTags(
    context: RequestContext,
    eventId: string,
    updates: readonly Readonly<{ user_id: string; role_tag: string | null }>[],
  ): Promise<Readonly<{ ok: true; updated: number }>> {
    const actor = context.authorization.require(PERMISSION_ID.GUILD_WAR_TEAMS_EDIT);
    const event = await this.dependencies.events.getGuildWarTarget(context, eventId);
    const aggregate = await this.ensureActive(context, eventId, event.event.title, actor.userId);
    const teamMemberIds = new Set(aggregate.teams.flatMap((team) => team.members.map(({ userId }) => userId)));
    const missing = updates.find(({ user_id }) => !teamMemberIds.has(user_id));
    if (missing) throw notFound("Member not found in active teams", { user_id: missing.user_id });
    const normalized = updates.map((update) => ({ userId: update.user_id, roleTag: update.role_tag?.trim() || null }));
    const audit = createAuditMutation(context, {
      entityType: "guild_war",
      entityId: eventId,
      action: "set_role_tag",
      summary: event.event.title,
      details: { count: normalized.length },
    });
    const changed = await this.dependencies.store.setRoleTags({
      warId: aggregate.war.id,
      expectedVersion: aggregate.war.rosterVersion,
      actorUserId: actor.userId,
      now: context.now,
      updates: normalized,
      audit,
    });
    if (!changed) throw conflict();
    this.publish(eventId, "role_tags_updated", context.now);
    return { ok: true, updated: updates.length };
  }

  async conclude(
    context: RequestContext,
    eventId: string,
    warInfo: WarInfoInput,
    memberStats: readonly Readonly<{ user_id: string; stats: MemberStats }>[] = [],
  ): Promise<Readonly<{ war_history_id: string }>> {
    const actor = context.authorization.require(PERMISSION_ID.GUILD_WAR_TEAMS_EDIT);
    const event = await this.dependencies.events.getGuildWarTarget(context, eventId);
    const current = await this.dependencies.store.getByEvent(eventId);
    if (current?.war.status === "concluded") return { war_history_id: current.war.id };
    const aggregate = current ?? await this.ensureActive(context, eventId, event.event.title, actor.userId);
    const teamMemberIds = new Set(aggregate.teams.flatMap((team) => team.members.map(({ userId }) => userId)));
    const missing = memberStats.find(({ user_id }) => !teamMemberIds.has(user_id));
    if (missing) throw notFound("Team member not found in selected guild war", { user_id: missing.user_id });
    const audit = createAuditMutation(context, {
      entityType: "guild_war_history",
      entityId: aggregate.war.id,
      action: "conclude",
      summary: event.event.title,
      details: { event_id: eventId, result: warInfo.result, member_count: teamMemberIds.size },
    });
    const changed = await this.dependencies.store.conclude({
      warId: aggregate.war.id,
      expectedVersion: aggregate.war.rosterVersion,
      actorUserId: actor.userId,
      now: context.now,
      enemyName: warInfo.enemy_name?.trim() || null,
      result: warInfo.result,
      ownStats: warInfo.own_stats ?? null,
      enemyStats: warInfo.enemy_stats ?? null,
      durationMinutes: warInfo.duration_minutes ?? null,
      memberStats: memberStats.map((row) => ({ userId: row.user_id, stats: row.stats })),
      audit,
    });
    if (!changed) {
      const raced = await this.dependencies.store.getByEvent(eventId);
      if (raced?.war.status === "concluded") return { war_history_id: raced.war.id };
      throw conflict();
    }
    this.publish(eventId, "war_concluded", context.now);
    return { war_history_id: aggregate.war.id };
  }

  listHistory(context: RequestContext, query: HistoryListQuery) {
    void context;
    assertPage(query);
    return this.dependencies.store.listHistory(query);
  }

  async historyDetail(context: RequestContext, warId: string): Promise<GuildWarAggregate> {
    void context;
    return this.requireHistory(warId);
  }

  async historyBatch(context: RequestContext, warIds: readonly string[]): Promise<readonly GuildWarAggregate[]> {
    void context;
    const ids = uniqueIds(warIds);
    if (ids.length > MAX_HISTORY_BATCH) throw validation(`Maximum ${MAX_HISTORY_BATCH} ids per batch request`);
    return this.dependencies.store.getHistoryMany(ids);
  }

  async createHistory(context: RequestContext, input: HistoryInput): Promise<GuildWarRecord> {
    const actor = context.authorization.require(PERMISSION_ID.GUILD_WAR_HISTORY_EDIT);
    if (input.event_id) {
      await this.dependencies.events.getGuildWarHistoryTarget(context, input.event_id);
      const conflictRow = await this.dependencies.store.getByEvent(input.event_id);
      if (conflictRow) throw eventHistoryConflict(conflictRow.war.id);
    }
    const id = this.createId();
    const record: GuildWarRecord = {
      id,
      eventId: input.event_id ?? null,
      status: "concluded",
      warName: input.war_name.trim(),
      enemyName: input.enemy_name?.trim() || null,
      result: input.result,
      ownStats: input.own_stats ?? null,
      enemyStats: input.enemy_stats ?? null,
      durationMinutes: input.duration_minutes ?? null,
      notes: input.notes?.trim() || null,
      rosterVersion: 0,
      concludedAt: context.now,
      createdBy: actor.userId,
      updatedBy: null,
      createdAt: context.now,
      updatedAt: context.now,
    };
    const audit = createAuditMutation(context, {
      entityType: "guild_war_history",
      entityId: id,
      action: "create",
      summary: record.warName,
    });
    const created = await this.dependencies.store.createHistory({ record, audit });
    if (!created) {
      const conflictRow = record.eventId ? await this.dependencies.store.getByEvent(record.eventId) : null;
      if (conflictRow) throw eventHistoryConflict(conflictRow.war.id);
      throw conflict();
    }
    this.publish(id, "history_created", context.now);
    return record;
  }

  async updateHistory(context: RequestContext, warId: string, input: HistoryUpdateInput): Promise<GuildWarRecord> {
    const actor = context.authorization.require(PERMISSION_ID.GUILD_WAR_HISTORY_EDIT);
    const existing = await this.requireHistory(warId);
    if (input.event_id !== undefined) {
      await this.dependencies.events.getGuildWarHistoryTarget(context, input.event_id);
      const conflicting = await this.dependencies.store.getByEvent(input.event_id);
      if (conflicting && conflicting.war.id !== warId) throw eventHistoryConflict(conflicting.war.id);
    }
    const patch: HistoryPatch = {
      ...(input.event_id === undefined ? {} : { eventId: input.event_id }),
      ...(input.war_name === undefined ? {} : { warName: input.war_name.trim() }),
      ...(input.enemy_name === undefined ? {} : { enemyName: input.enemy_name.trim() || null }),
      ...(input.result === undefined ? {} : { result: input.result }),
      ...(input.own_stats === undefined ? {} : { ownStats: input.own_stats }),
      ...(input.enemy_stats === undefined ? {} : { enemyStats: input.enemy_stats }),
      ...(input.duration_minutes === undefined ? {} : { durationMinutes: input.duration_minutes }),
      ...(input.notes === undefined ? {} : { notes: input.notes.trim() || null }),
    };
    const audit = createAuditMutation(context, {
      entityType: "guild_war_history",
      entityId: warId,
      action: "update",
      summary: input.war_name ?? existing.war.warName,
    });
    const changed = await this.dependencies.store.updateHistory({
      warId,
      expectedVersion: existing.war.rosterVersion,
      actorUserId: actor.userId,
      now: context.now,
      patch,
      audit,
    });
    if (!changed) throw conflict();
    this.publish(warId, "history_updated", context.now);
    return (await this.requireHistory(warId)).war;
  }

  async deleteHistory(context: RequestContext, warId: string): Promise<Readonly<{ ok: true }>> {
    context.authorization.require(PERMISSION_ID.GUILD_WAR_HISTORY_EDIT);
    const existing = await this.requireHistory(warId);
    const audit = createAuditMutation(context, {
      entityType: "guild_war_history",
      entityId: warId,
      action: "delete",
      summary: existing.war.warName,
    });
    const changed = await this.dependencies.store.deleteHistory({
      warId,
      expectedVersion: existing.war.rosterVersion,
      audit,
    });
    if (!changed) throw conflict();
    this.publish(warId, "history_deleted", context.now);
    return { ok: true };
  }

  async deleteHistoryBatch(context: RequestContext, warIds: readonly string[]) {
    context.authorization.require(PERMISSION_ID.GUILD_WAR_HISTORY_EDIT);
    const ids = uniqueIds(warIds);
    if (ids.length > MAX_HISTORY_BATCH) throw validation(`Maximum ${MAX_HISTORY_BATCH} ids per batch delete`);
    const rows = await this.dependencies.store.getMany(ids);
    const mutations = rows
      .filter(({ war }) => war.status === "concluded")
      .map(({ war }) => ({
        warId: war.id,
        expectedVersion: war.rosterVersion,
        audit: createAuditMutation(context, {
          entityType: "guild_war_history",
          entityId: war.id,
          action: "delete",
          summary: war.warName,
        }),
      }));
    const deletedIds = await this.dependencies.store.deleteHistories({ rows: mutations });
    for (const warId of deletedIds) this.publish(warId, "history_deleted", context.now);
    return { ok: true as const, deleted: deletedIds.length };
  }

  async updateMemberStats(
    context: RequestContext,
    warId: string,
    updates: readonly Readonly<{ user_id: string; data: MemberStatsUpdate }>[],
  ): Promise<readonly WarMemberRecord[]> {
    const actor = context.authorization.require(PERMISSION_ID.GUILD_WAR_HISTORY_EDIT);
    const existing = await this.requireHistory(warId);
    const members = existing.teams.flatMap((team) => team.members);
    const memberIds = new Set(members.map(({ userId }) => userId));
    const missing = updates.find(({ user_id }) => !memberIds.has(user_id));
    if (missing) throw notFound("Team member not found in selected war history", { user_id: missing.user_id });
    const audit = createAuditMutation(context, {
      entityType: "guild_war_member_stats",
      entityId: updates.length === 1 ? `${warId}:${updates[0]!.user_id}` : warId,
      action: updates.length === 1 ? "update" : "batch_update",
      summary: existing.war.warName,
      details: { user_ids: updates.map(({ user_id }) => user_id) },
    });
    const changed = await this.dependencies.store.updateMemberStats({
      warId,
      expectedVersion: existing.war.rosterVersion,
      actorUserId: actor.userId,
      now: context.now,
      updates: updates.map((update) => ({ userId: update.user_id, ...update.data })),
      audit,
    });
    if (!changed) throw conflict();
    const refreshed = await this.requireHistory(warId);
    const requested = new Set(updates.map(({ user_id }) => user_id));
    return refreshed.teams.flatMap((team) => team.members).filter(({ userId }) => requested.has(userId));
  }

  async analytics(
    context: RequestContext,
    warIdsInput: readonly string[],
    userIdsInput: readonly string[],
  ): Promise<GuildWarAnalytics> {
    void context;
    const warIds = uniqueIds(warIdsInput);
    const userIds = uniqueIds(userIdsInput);
    if (warIds.length > MAX_ANALYTICS_WARS) throw validation(`Maximum ${MAX_ANALYTICS_WARS} war_ids`);
    if (userIds.length > MAX_ANALYTICS_USERS) throw validation(`Maximum ${MAX_ANALYTICS_USERS} user_ids`);
    const [settings, rows] = await Promise.all([
      this.dependencies.analyticsSettings.read(),
      this.dependencies.store.readAnalytics(warIds, userIds),
    ]);
    return {
      wars: rows.wars.map((war) => {
        const teamSize = rows.teamSizes.get(war.id) ?? 0;
        const modifier = computeModifier(war, settings);
        return { ...war, teamSize, modifier: modifier.value, modifierBreakdown: modifier.breakdown };
      }),
      memberStats: rows.memberStats,
      settings,
    };
  }

  async export(
    context: RequestContext,
    format: "csv" | "json",
    filters: Readonly<{ eventId?: string; dateFrom?: string; dateTo?: string }>,
  ): Promise<Readonly<{ content: string; contentType: string; filename: string }>> {
    context.authorization.require(PERMISSION_ID.GUILD_WAR_HISTORY_EDIT);
    const rows = await this.dependencies.store.exportHistory(filters);
    const stamp = context.now.slice(0, 10);
    if (format === "json") {
      return {
        content: JSON.stringify(rows.map(historyWireRecord), null, 2),
        contentType: "application/json; charset=utf-8",
        filename: `guild-war-history-${stamp}.json`,
      };
    }
    return {
      content: historyCsv(rows),
      contentType: "text/csv; charset=utf-8",
      filename: `guild-war-history-${stamp}.csv`,
    };
  }

  private async ensureActive(
    context: RequestContext,
    eventId: string,
    warName: string,
    actorUserId: string,
  ): Promise<GuildWarAggregate> {
    const existing = await this.dependencies.store.getByEvent(eventId);
    if (existing) {
      if (existing.war.status !== "active") throw eventHistoryConflict(existing.war.id);
      return existing;
    }
    const id = this.createId();
    const audit = createAuditMutation(context, {
      entityType: "guild_war",
      entityId: eventId,
      action: "init",
      summary: warName,
    });
    await this.dependencies.store.createActive({ id, eventId, warName, actorUserId, now: context.now, audit });
    const created = await this.dependencies.store.getByEvent(eventId);
    if (!created) throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Failed to initialize guild war" });
    if (created.war.status !== "active") throw eventHistoryConflict(created.war.id);
    return created;
  }

  private async requireHistory(warId: string): Promise<GuildWarAggregate> {
    const row = await this.dependencies.store.getById(warId);
    if (!row || row.war.status !== "concluded") throw notFound("War history not found");
    return row;
  }

  private publish(
    entityId: string,
    hint: PushHint,
    updatedAt: string,
    entityType: "event" | "guild_war" = "guild_war",
  ): void {
    this.dependencies.deferred.defer(() => this.dependencies.notifications.publish({
      type: "entity_changed",
      entity_type: entityType,
      entity_id: entityId,
      updated_at: updatedAt,
      hint,
    }));
  }
}

function emptyActive(): GuildWarActiveView {
  return { war: null, event: null, teams: [], pool: [], participants: [], etag: null };
}

function virtualPool(eventId: string, userIds: readonly string[]): WarMemberRecord[] {
  return userIds.map((userId, sortOrder) => ({
    id: `virtual:${userId}`,
    warId: `virtual:${eventId}`,
    teamId: null,
    userId,
    username: userId,
    roleTag: null,
    sortOrder,
    stats: null,
    note: null,
  }));
}

function assertPage(query: HistoryListQuery): void {
  if (!Number.isInteger(query.page) || query.page < 1 || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_PAGE_SIZE) {
    throw validation("Invalid history pagination");
  }
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) throw validation("Invalid history date range");
  assertPortableLikeSearch(query.search, "History search");
}

function activeEtag(war: GuildWarRecord): string {
  return `"active-${war.eventId ?? war.id}-${war.rosterVersion}"`;
}

function assertEtag(ifMatch: string | undefined, war: GuildWarRecord): void {
  if (ifMatch && ifMatch !== "*" && ifMatch !== activeEtag(war)) throw conflict();
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function computeModifier(
  war: Pick<GuildWarRecord, "ownStats" | "enemyStats">,
  settings: SiteAnalyticsSettings,
): Readonly<{ value: number; breakdown: readonly ModifierBreakdown[] }> {
  const valid = Object.entries(settings.modifier_weights)
    .filter(([, weight]) => weight > 0)
    .flatMap(([factor, weight]) => {
      const own = war.ownStats?.[factor as keyof TeamStats] ?? null;
      const enemy = war.enemyStats?.[factor as keyof TeamStats] ?? null;
      return own === null || enemy === null ? [] : [{ factor, weight, ratio: enemy / Math.max(own, 1) }];
    });
  if (valid.length === 0) return { value: 1, breakdown: [] };
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  let value = 0;
  const breakdown = valid.map((item) => {
    const weight = item.weight / totalWeight;
    const contribution = weight * item.ratio;
    value += contribution;
    return {
      factor: item.factor,
      ratio: rounded(item.ratio, 4),
      weight: rounded(weight, 4),
      contribution: rounded(contribution, 4),
    };
  });
  return { value: rounded(value, 4), breakdown };
}

function historyWireRecord(war: GuildWarRecord) {
  return {
    id: war.id,
    event_id: war.eventId,
    war_name: war.warName,
    enemy_name: war.enemyName,
    result: war.result,
    own_stats: war.ownStats,
    enemy_stats: war.enemyStats,
    duration_minutes: war.durationMinutes,
    notes: war.notes,
    created_by: war.createdBy,
    updated_by: war.updatedBy,
    created_at: war.createdAt,
    updated_at: war.updatedAt,
  };
}

function historyCsv(rows: readonly GuildWarRecord[]): string {
  const headers = [
    "id", "event_id", "war_name", "enemy_name", "result", "duration_minutes", "notes",
    "own_kills", "own_towers", "own_base_hp", "own_credits", "own_distance",
    "enemy_kills", "enemy_towers", "enemy_base_hp", "enemy_credits", "enemy_distance",
    "created_by", "updated_by", "created_at", "updated_at",
  ];
  const values = rows.map((war) => [
    war.id, war.eventId, war.warName, war.enemyName, war.result, war.durationMinutes, war.notes,
    war.ownStats?.kills, war.ownStats?.towers, war.ownStats?.base_hp, war.ownStats?.credits, war.ownStats?.distance,
    war.enemyStats?.kills, war.enemyStats?.towers, war.enemyStats?.base_hp, war.enemyStats?.credits, war.enemyStats?.distance,
    war.createdBy, war.updatedBy, war.createdAt, war.updatedAt,
  ]);
  return [headers, ...values].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function rounded(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function validation(message: string, details?: unknown): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message, ...(details === undefined ? {} : { details }) });
}

function notFound(message: string, details?: unknown): AppError {
  return new AppError({ code: "NOT_FOUND", status: 404, message, ...(details === undefined ? {} : { details }) });
}

function conflict(): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message: "Guild war changed, refresh and retry" });
}

function eventHistoryConflict(warId: string): AppError {
  return new AppError({
    code: "CONFLICT",
    status: 409,
    message: "This guild war event already has a history record",
    details: { war_history_id: warId },
  });
}
