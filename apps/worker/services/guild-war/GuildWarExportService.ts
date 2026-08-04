import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { warHistory, warTeams } from "../../db/schema";
import { neutralizeSpreadsheetFormula } from "../../utils/csv";
import { ok, type ServiceResult } from "../result";
import {
  GuildWarCoreService,
  toMemberPayload,
  toTeamPayload,
  toWarHistoryPayload,
  type DrizzleDb,
  type GuildWarServiceDeps,
  type WarHistoryRow,
} from "./GuildWarCoreService";

function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const safe = neutralizeSpreadsheetFormula(text);
  return `"${safe.replaceAll('"', '""')}"`;
}

function buildWarHistoryCsv(rows: WarHistoryRow[], creatorMap: Map<string, string>, teamStatKeys: string[]): string {
  const statHeaders = teamStatKeys.flatMap((key) => [`own_${key}`, `enemy_${key}`]);
  const headers = ["id","event_id","war_name","enemy_name","result",...statHeaders,"duration_minutes","notes","created_by","created_by_username","created_at","updated_at"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const statCells = teamStatKeys.flatMap((key) => [toCsvCell(row.ownStats?.[key]), toCsvCell(row.enemyStats?.[key])]);
    lines.push([toCsvCell(row.id),toCsvCell(row.eventId),toCsvCell(row.warName),toCsvCell(row.enemyName),toCsvCell(row.result),...statCells,toCsvCell(row.durationMinutes),toCsvCell(row.notes),toCsvCell(row.createdBy),toCsvCell(creatorMap.get(row.createdBy ?? "") ?? row.createdBy),toCsvCell(row.createdAt),toCsvCell(row.updatedAt)].join(","));
  }
  return lines.join("\n");
}

export class GuildWarExportService extends GuildWarCoreService {
  constructor(db: DrizzleDb, deps: GuildWarServiceDeps) {
    super(db, deps);
  }

  async exportHistory(format: "csv" | "json", filters: { dateFrom?: string; dateTo?: string; eventId?: string }): Promise<ServiceResult<{ content: string; contentType: string; filename: string }>> {
    const gameRules = await this.getGameRules();
    const where: SQL<unknown>[] = [];
    if (filters.dateFrom) where.push(gte(warHistory.createdAt, filters.dateFrom));
    if (filters.dateTo) where.push(lte(warHistory.createdAt, filters.dateTo));
    if (filters.eventId) where.push(eq(warHistory.eventId, filters.eventId));
    const rows = await this.db.select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, updatedBy: warHistory.updatedBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt }).from(warHistory).where(where.length > 0 ? and(...where) : undefined).orderBy(desc(warHistory.createdAt), desc(warHistory.id)).limit(5000);
    const creatorIds = [...new Set(rows.map((r) => r.createdBy).filter(Boolean) as string[])];
    const creatorMap = await this.getUsernameMap(creatorIds);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `guild-war-history-${dateStamp}.${format}`;
    if (format === "json") {
      const warIds = rows.map((r) => r.id);
      const allTeams = warIds.length > 0 ? await this.db.select({ id: warTeams.id, warHistoryId: warTeams.warHistoryId, eventId: warTeams.eventId, teamName: warTeams.teamName, sortOrder: warTeams.sortOrder, notes: warTeams.notes, isLocked: warTeams.isLocked }).from(warTeams).where(inArray(warTeams.warHistoryId, warIds)).orderBy(asc(warTeams.sortOrder), asc(warTeams.id)) : [];
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
    return ok({
      content: buildWarHistoryCsv(rows, creatorMap, gameRules.guild_war.team_stats.map((stat) => stat.key)),
      contentType: "text/csv; charset=utf-8",
      filename,
    });
  }
}
