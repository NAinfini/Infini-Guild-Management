import { GuildWarActiveService } from "./guild-war/GuildWarActiveService";
import { GuildWarAnalyticsService } from "./guild-war/GuildWarAnalyticsService";
import {
  GuildWarCoreService,
  type CreateWarHistoryInput,
  type DrizzleDb,
  type GuildWarServiceDeps,
  type MoveMembersInput,
  type RoleTagUpdatesInput,
  type SaveTeamsInput,
  type UpdateWarHistoryInput,
} from "./guild-war/GuildWarCoreService";
import { GuildWarExportService } from "./guild-war/GuildWarExportService";
import { GuildWarHistoryService } from "./guild-war/GuildWarHistoryService";
import type { AnalyticsSettings } from "./AdminService";
import type { ServiceResult } from "./result";
import type { z } from "zod";
import type { updateMemberStatsSchema } from "@guild/shared";

export {
  buildActiveEtag,
  buildWarEtag,
  toMemberPayload,
  toTeamPayload,
  toWarHistoryPayload,
  type GuildWarServiceDeps,
  type WarHistoryRow,
  type WarTeamMemberRow,
  type WarTeamRow,
  type WarTemplateSnapshot,
} from "./guild-war/GuildWarCoreService";

export class GuildWarService {
  private readonly core: GuildWarCoreService;
  private readonly active: GuildWarActiveService;
  private readonly history: GuildWarHistoryService;
  private readonly analytics: GuildWarAnalyticsService;
  private readonly exports: GuildWarExportService;

  constructor(db: DrizzleDb, deps: GuildWarServiceDeps) {
    this.core = new GuildWarCoreService(db, deps);
    this.active = new GuildWarActiveService(db, deps, this);
    this.history = new GuildWarHistoryService(db, deps, this);
    this.analytics = new GuildWarAnalyticsService(db, deps);
    this.exports = new GuildWarExportService(db, deps);
  }

  getWarHistoryById(warId: string) {
    return this.core.getWarHistoryById(warId);
  }

  getLatestWarHistory(eventId?: string) {
    return this.core.getLatestWarHistory(eventId);
  }

  getTeamsForHistory(warHistoryId: string) {
    return this.core.getTeamsForHistory(warHistoryId);
  }

  getTeamsForEvent(eventId: string) {
    return this.core.getTeamsForEvent(eventId);
  }

  getMembersForTeams(teamIds: string[]) {
    return this.core.getMembersForTeams(teamIds);
  }

  getPoolMembers(warHistoryId: string) {
    return this.core.getPoolMembers(warHistoryId);
  }

  getPoolMembersForEvent(eventId: string) {
    return this.core.getPoolMembersForEvent(eventId);
  }

  getConcludedEventIds() {
    return this.history.getConcludedEventIds();
  }

  getActive(eventId?: string, canManage = false) {
    return this.active.getActive(eventId, canManage);
  }

  saveTeams(actorId: string, payload: SaveTeamsInput, conditionalEtag?: string) {
    return this.active.saveTeams(actorId, payload, conditionalEtag);
  }

  moveMembers(actorId: string, eventId: string, moves: MoveMembersInput, conditionalEtag?: string) {
    return this.active.moveMembers(actorId, eventId, moves, conditionalEtag);
  }

  setRoleTag(actorId: string, eventId: string, userId: string, roleTag: string | null) {
    return this.active.setRoleTag(actorId, eventId, userId, roleTag);
  }

  setRoleTags(actorId: string, eventId: string, updates: RoleTagUpdatesInput) {
    return this.active.setRoleTags(actorId, eventId, updates);
  }

  concludeWar(
    actorId: string,
    eventId: string,
    warInfo: { enemy_name?: string; result: string; duration_minutes?: number | null; own_stats?: Record<string, number | null>; enemy_stats?: Record<string, number | null> },
    memberStats?: Array<{ user_id: string; stats: Record<string, number> }>,
  ) {
    return this.history.concludeWar(actorId, eventId, warInfo, memberStats);
  }

  replaceHistoryTeams(warHistoryId: string, snapshot: Parameters<GuildWarHistoryService["replaceHistoryTeams"]>[1]) {
    return this.history.replaceHistoryTeams(warHistoryId, snapshot);
  }

  replaceEventTeams(eventId: string, snapshot: Parameters<GuildWarActiveService["replaceEventTeams"]>[1]) {
    return this.active.replaceEventTeams(eventId, snapshot);
  }

  exportHistory(format: "csv" | "json", filters: { dateFrom?: string; dateTo?: string; eventId?: string }) {
    return this.exports.exportHistory(format, filters);
  }

  listHistory(page: number, limit: number, filters: { dateFrom?: string; dateTo?: string; search?: string }) {
    return this.history.listHistory(page, limit, filters);
  }

  batchHistory(ids: string[]) {
    return this.history.batchHistory(ids);
  }

  getHistoryDetail(warId: string) {
    return this.history.getHistoryDetail(warId);
  }

  createHistory(actorId: string, input: CreateWarHistoryInput) {
    return this.history.createHistory(actorId, input);
  }

  updateHistory(actorId: string, warId: string, input: UpdateWarHistoryInput) {
    return this.history.updateHistory(actorId, warId, input);
  }

  deleteHistory(actorId: string, warId: string) {
    return this.history.deleteHistory(actorId, warId);
  }

  batchDeleteHistory(actorId: string, warIds: string[]) {
    return this.history.batchDeleteHistory(actorId, warIds);
  }

  updateMemberStats(actorId: string, warId: string, targetUserId: string, input: z.infer<typeof updateMemberStatsSchema>): Promise<ServiceResult<unknown>> {
    return this.history.updateMemberStats(actorId, warId, targetUserId, input);
  }

  batchUpdateMemberStats(actorId: string, warId: string, updates: Array<{ user_id: string; stats: unknown }>) {
    return this.history.batchUpdateMemberStats(actorId, warId, updates);
  }

  getAnalytics(warIds: string[], userIds: string[]): Promise<ServiceResult<{ wars: unknown[]; member_stats: unknown[]; analytics_settings: AnalyticsSettings }>> {
    return this.analytics.getAnalytics(warIds, userIds);
  }
}
