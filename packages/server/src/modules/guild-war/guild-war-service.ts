import { AppError, type RequestContext } from "@guild/kernel";
import { formatCsvCell, type AuditChange, type SiteAnalyticsSettings } from "@guild/shared";
import type { PushHint } from "@guild/shared/constants/push-hints";
import type { WarResult } from "@guild/shared/constants/guild-war";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { nanoid } from "nanoid";
import { createAuditEvent } from "@guild/server/modules/audit";
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

function monotonicTimestamp(now: string, previous: string): string {
  if (Date.parse(now) > Date.parse(previous)) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

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

type HistoryUpdateInput = Readonly<Partial<Omit<HistoryInput, "event_id" | "duration_minutes">> & {
  event_id?: string | null;
  duration_minutes?: number | null;
}>;

type MemberStatsUpdate = Readonly<{ stats?: MemberStats; note?: string | null }>;

export function guildWarHistoryEtag(
  war: Pick<GuildWarRecord, "id" | "rosterVersion">,
): string {
  return `"history-${war.id}-${war.rosterVersion}"`;
}

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
    /* 报名记录会留着，但停用的账号登不进来也打不了仗。名册和候补池只呈现还能上场的人，
       否则指挥会把位置排给一个根本来不了的人。报名本身不删：账号一旦恢复就照常归队。 */
    const eligible = new Set(
      await this.dependencies.store.listRosterEligible(event.participants.map(({ user_id }) => user_id)),
    );
    const eligibleIds = event.participants
      .map(({ user_id }) => user_id)
      .filter((userId) => eligible.has(userId));
    const participants = eligibleIds.map((user_id) => ({ user_id }));
    if (!aggregate || aggregate.war.status !== "active") {
      return {
        war: null,
        event: viewerEvent,
        teams: [],
        pool: virtualPool(eventId, eligibleIds),
        participants,
        etag: null,
      };
    }
    const placed = new Set([
      ...aggregate.pool.map(({ userId }) => userId),
      ...aggregate.teams.flatMap((team) => team.members.map(({ userId }) => userId)),
    ]);
    const additions = virtualPool(eventId, eligibleIds.filter((userId) => !placed.has(userId)));
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
    const audit = createAuditEvent(context, {
      subjectType: "guild_war",
      subjectId: input.event_id,
      subjectLabel: event.event.title,
      action: "save_teams",
      context: [
        { field: "team_count", value: { type: "number", value: teams.length } },
        {
          field: "member_count",
          value: {
            type: "number",
            value: pool.length + teams.reduce((sum, team) => sum + team.members.length, 0),
          },
        },
      ],
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
    const normalizedMoves = [...new Map(moves.map((move) => [move.user_id, move])).values()];
    const removesParticipants = normalizedMoves.some(({ to }) => to === "remove");
    if (removesParticipants) context.authorization.require(PERMISSION_ID.EVENTS_EDIT);
    const event = await this.dependencies.events.getGuildWarTarget(context, eventId);
    const participantIds = new Set(event.participants.map(({ user_id }) => user_id));
    const nonParticipant = normalizedMoves.find(({ user_id, to }) => to !== "pool" && !participantIds.has(user_id));
    if (nonParticipant) throw validation("Guild war roster members must be event participants", { user_id: nonParticipant.user_id });
    const participantAdditions = new Set(
      normalizedMoves.filter(({ user_id, to }) => to === "pool" && !participantIds.has(user_id)).map(({ user_id }) => user_id),
    );
    const aggregate = await this.ensureActive(context, eventId, event.event.title, actor.userId);
    assertEtag(ifMatch, aggregate.war);
    const teamIds = new Set(aggregate.teams.map(({ id }) => id));
    const invalid = normalizedMoves.find(({ to }) => to !== "pool" && to !== "remove" && !teamIds.has(to));
    if (invalid) throw notFound("Target team not found");
    const teamNamesById = new Map(aggregate.teams.map(({ id, teamName }) => [id, teamName]));
    const audit = createAuditEvent(context, {
      subjectType: "guild_war",
      subjectId: eventId,
      subjectLabel: event.event.title,
      action: "move_member",
      context: [{
        field: "destinations",
        value: {
          type: "list",
          value: normalizedMoves.map(({ to }) => to === "pool" || to === "remove"
            ? ({ type: "code" as const, value: to })
            : ({ type: "reference" as const, value: { id: to, label: teamNamesById.get(to)! } })),
        },
      }],
    });
    const changed = await this.dependencies.eventRoster.moveMembers({
      warId: aggregate.war.id,
      eventId,
      expectedVersion: aggregate.war.rosterVersion,
      expectedEventUpdatedAt: event.event.updatedAt,
      updatedEventAt: monotonicTimestamp(context.now, event.event.updatedAt),
      actorUserId: actor.userId,
      now: context.now,
      moves: normalizedMoves.map((move) => ({
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
    const teamMembers = aggregate.teams.flatMap((team) => team.members);
    const teamMemberIds = new Set(teamMembers.map(({ userId }) => userId));
    const usernamesById = new Map(teamMembers.map(({ userId, display_name }) => [userId, display_name]));
    const missing = updates.find(({ user_id }) => !teamMemberIds.has(user_id));
    if (missing) throw notFound("Member not found in active teams", { user_id: missing.user_id });
    const normalized = [...new Map(updates.map((update) => [update.user_id, {
      userId: update.user_id,
      roleTag: update.role_tag?.trim() || null,
    }])).values()];
    const audit = createAuditEvent(context, {
      subjectType: "guild_war",
      subjectId: eventId,
      subjectLabel: event.event.title,
      action: "set_role_tag",
      context: [
        { field: "member_count", value: { type: "number", value: normalized.length } },
        {
          field: "user_ids",
          value: {
            type: "list",
            value: normalized.map(({ userId }) => ({
              type: "reference" as const,
              value: { id: userId, label: usernamesById.get(userId)! },
            })),
          },
        },
        {
          field: "role_tags",
          value: {
            type: "list",
            value: normalized.map(({ roleTag }) => roleTag === null
              ? ({ type: "null" as const, value: null })
              : ({ type: "code" as const, value: roleTag })),
          },
        },
      ],
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
    return { ok: true, updated: normalized.length };
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
    const audit = createAuditEvent(context, {
      subjectType: "guild_war_history",
      subjectId: aggregate.war.id,
      subjectLabel: event.event.title,
      action: "conclude",
      context: [
        {
          field: "event_id",
          value: { type: "reference", value: { id: eventId, label: event.event.title } },
        },
        { field: "result", value: { type: "code", value: warInfo.result } },
        { field: "member_count", value: { type: "number", value: teamMemberIds.size } },
      ],
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
    let eventLabel: string | null = null;
    if (input.event_id) {
      eventLabel = (await this.dependencies.events.getGuildWarHistoryTarget(context, input.event_id)).event.title;
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
    const audit = createAuditEvent(context, {
      subjectType: "guild_war_history",
      subjectId: id,
      subjectLabel: record.warName,
      action: "create",
      context: [
        {
          field: "result",
          value: record.result === null
            ? { type: "null", value: null }
            : { type: "code", value: record.result },
        },
        ...(record.eventId === null ? [] : [{
          field: "event_id" as const,
          value: { type: "reference" as const, value: { id: record.eventId, label: eventLabel } },
        }]),
      ],
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
    let nextEventLabel: string | null = null;
    let previousEventLabel: string | null = null;
    if (input.event_id !== undefined) {
      if (input.event_id !== null) {
        nextEventLabel = (await this.dependencies.events.getGuildWarHistoryTarget(context, input.event_id)).event.title;
        const conflicting = await this.dependencies.store.getByEvent(input.event_id);
        if (conflicting && conflicting.war.id !== warId) throw eventHistoryConflict(conflicting.war.id);
      }
      if (existing.war.eventId !== null && existing.war.eventId !== input.event_id) {
        previousEventLabel = (
          await this.dependencies.events.getGuildWarHistoryTarget(context, existing.war.eventId)
        ).event.title;
      }
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
    const changes: AuditChange[] = [];
    if (patch.warName !== undefined && patch.warName !== existing.war.warName) changes.push({
      field: "title",
      before: { type: "text", value: existing.war.warName },
      after: { type: "text", value: patch.warName },
    });
    if (patch.result !== undefined && patch.result !== existing.war.result) changes.push({
      field: "result",
      before: existing.war.result === null
        ? { type: "null", value: null }
        : { type: "code", value: existing.war.result },
      after: { type: "code", value: patch.result },
    });
    if (patch.eventId !== undefined && patch.eventId !== existing.war.eventId) changes.push({
      field: "event_id",
      before: existing.war.eventId === null
        ? { type: "null", value: null }
        : { type: "reference", value: { id: existing.war.eventId, label: previousEventLabel } },
      after: patch.eventId === null
        ? { type: "null", value: null }
        : { type: "reference", value: { id: patch.eventId, label: nextEventLabel } },
    });
    const sectionKeys = [
      input.enemy_name !== undefined && (input.enemy_name.trim() || null) !== existing.war.enemyName ? "enemy_name" : null,
      input.own_stats !== undefined && JSON.stringify(input.own_stats) !== JSON.stringify(existing.war.ownStats) ? "own_stats" : null,
      input.enemy_stats !== undefined && JSON.stringify(input.enemy_stats) !== JSON.stringify(existing.war.enemyStats) ? "enemy_stats" : null,
      input.duration_minutes !== undefined && input.duration_minutes !== existing.war.durationMinutes ? "duration_minutes" : null,
      input.notes !== undefined && (input.notes.trim() || null) !== existing.war.notes ? "notes" : null,
    ].filter((value): value is string => value !== null);
    const audit = createAuditEvent(context, {
      subjectType: "guild_war_history",
      subjectId: warId,
      subjectLabel: patch.warName ?? existing.war.warName,
      action: "update",
      changes,
      context: sectionKeys.length === 0 ? [] : [{
        field: "changed_sections",
        value: { type: "list", value: sectionKeys.map((value) => ({ type: "code", value })) },
      }],
    });
    const updated = await this.dependencies.store.updateHistory({
      warId,
      expectedVersion: existing.war.rosterVersion,
      actorUserId: actor.userId,
      now: context.now,
      patch,
      audit,
    });
    if (!updated) throw conflict();
    this.publish(warId, "history_updated", context.now);
    return updated;
  }

  async deleteHistory(context: RequestContext, warId: string): Promise<Readonly<{ ok: true }>> {
    context.authorization.require(PERMISSION_ID.GUILD_WAR_HISTORY_EDIT);
    const existing = await this.requireHistory(warId);
    const audit = createAuditEvent(context, {
      subjectType: "guild_war_history",
      subjectId: warId,
      subjectLabel: existing.war.warName,
      action: "delete",
      // A deleted record leaves no other trace, so the log keeps the outcome it carried.
      context: [{
        field: "result",
        value: existing.war.result === null
          ? { type: "null", value: null }
          : { type: "code", value: existing.war.result },
      }],
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
        audit: createAuditEvent(context, {
          subjectType: "guild_war_history",
          subjectId: war.id,
          subjectLabel: war.warName,
          action: "delete",
          // A deleted record leaves no other trace, so the log keeps the outcome it carried.
          context: [{
            field: "result" as const,
            value: war.result === null
              ? { type: "null" as const, value: null }
              : { type: "code" as const, value: war.result },
          }],
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
    ifMatch?: string,
  ): Promise<readonly WarMemberRecord[]> {
    const actor = context.authorization.require(PERMISSION_ID.GUILD_WAR_HISTORY_EDIT);
    const existing = await this.requireHistory(warId);
    if (ifMatch !== guildWarHistoryEtag(existing.war)) throw conflict();
    const members = existing.teams.flatMap((team) => team.members);
    const memberIds = new Set(members.map(({ userId }) => userId));
    const normalized = [...new Map(updates.map((update) => [update.user_id, update])).values()];
    const missing = normalized.find(({ user_id }) => !memberIds.has(user_id));
    if (missing) throw notFound("Team member not found in selected war history", { user_id: missing.user_id });
    const usernamesById = new Map(members.map(({ userId, display_name }) => [userId, display_name]));
    const audit = createAuditEvent(context, {
      subjectType: "guild_war_member_stats",
      subjectId: normalized.length === 1 ? `${warId}:${normalized[0]!.user_id}` : warId,
      subjectLabel: existing.war.warName,
      action: normalized.length === 1 ? "update" : "batch_update",
      context: [
        { field: "member_count", value: { type: "number", value: normalized.length } },
        {
          field: "user_ids",
          value: {
            type: "list",
            value: normalized.map(({ user_id: id }) => ({
              type: "reference" as const,
              value: { id, label: usernamesById.get(id)! },
            })),
          },
        },
      ],
    });
    const updatedMembers = await this.dependencies.store.updateMemberStats({
      warId,
      expectedVersion: existing.war.rosterVersion,
      actorUserId: actor.userId,
      now: context.now,
      updates: normalized.map((update) => ({ userId: update.user_id, ...update.data })),
      audit,
    });
    if (!updatedMembers) throw conflict();
    const requested = new Set(normalized.map(({ user_id }) => user_id));
    return updatedMembers.filter(({ userId }) => requested.has(userId));
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
    filters: Readonly<{
      historyId?: string;
      eventId?: string;
      dateFrom?: string;
      dateTo?: string;
    }>,
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
    const audit = createAuditEvent(context, {
      subjectType: "guild_war",
      subjectId: eventId,
      subjectLabel: warName,
      action: "init",
      context: [],
    });
    const created = await this.dependencies.store.createActive({ id, eventId, warName, actorUserId, now: context.now, audit });
    if (created) {
      if (created.war.status !== "active") throw eventHistoryConflict(created.war.id);
      return created;
    }
    const raced = await this.dependencies.store.getByEvent(eventId);
    if (!raced) throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Failed to initialize guild war" });
    if (raced.war.status !== "active") throw eventHistoryConflict(raced.war.id);
    return raced;
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
    display_name: userId,
    avatarMediaId: null,
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
  return [headers, ...values]
    .map((row) => row.map((value) => formatCsvCell(value, { alwaysQuote: true })).join(","))
    .join("\r\n");
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
