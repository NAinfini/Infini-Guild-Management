import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { warHistory, warTeamMembers, warTeams } from "../../db/schema";
import { type AnalyticsSettings, defaultAnalyticsSettings } from "../AdminService";
import { ok, type ServiceResult } from "../result";
import {
  GuildWarCoreService,
  toWarHistoryPayload,
  type DrizzleDb,
  type GuildWarServiceDeps,
} from "./GuildWarCoreService";

const ANALYTICS_SETTINGS_KEY = "config/analytics-settings.json";

type ModifierBreakdown = { factor: string; ratio: number; weight: number; contribution: number };

function computeWarModifier(
  war: { ownStats: Record<string, number | null> | null; enemyStats: Record<string, number | null> | null },
  _ownTeamSize: number,
  settings: AnalyticsSettings,
): { value: number; breakdown: ModifierBreakdown[] } {
  const factors = Object.entries(settings.modifier_weights)
    .filter(([, weight]) => weight > 0)
    .map(([key, weight]) => {
      const objectiveKey = key === "basehp" ? "base_hp" : key === "kda" ? "kills" : key;
      return { key, weight, ownVal: war.ownStats?.[objectiveKey] ?? null, enemyVal: war.enemyStats?.[objectiveKey] ?? null };
    });
  const valid = factors
    .filter((f): f is { key: string; weight: number; ownVal: number; enemyVal: number } => f.ownVal !== null && f.enemyVal !== null)
    .map((f) => ({ key: f.key, weight: f.weight, ratio: f.enemyVal / Math.max(f.ownVal, 1) }));
  if (valid.length === 0) return { value: 1.0, breakdown: [] };

  const totalWeight = valid.reduce((sum, f) => sum + f.weight, 0);
  let modifier = 0;
  const breakdown = valid.map((f) => {
    const weight = f.weight / totalWeight;
    const contribution = weight * f.ratio;
    modifier += contribution;
    return {
      factor: f.key,
      ratio: Number(f.ratio.toFixed(4)),
      weight: Number(weight.toFixed(4)),
      contribution: Number(contribution.toFixed(4)),
    };
  });
  return { value: Number(modifier.toFixed(4)), breakdown };
}

export class GuildWarAnalyticsService extends GuildWarCoreService {
  constructor(db: DrizzleDb, deps: GuildWarServiceDeps) {
    super(db, deps);
  }

  private async readAnalyticsSettings(): Promise<AnalyticsSettings> {
    const object = await this.deps.media.get(ANALYTICS_SETTINGS_KEY);
    if (!object) return defaultAnalyticsSettings();
    try {
      const parsed = JSON.parse(await object.text()) as unknown;
      const defaults = defaultAnalyticsSettings();
      if (typeof parsed !== "object" || parsed === null) return defaults;
      const record = parsed as Record<string, unknown>;
      const rawWeights = record.modifier_weights;
      const modifier_weights: Record<string, number> = { ...defaults.modifier_weights };
      if (typeof rawWeights === "object" && rawWeights !== null) {
        for (const [key, val] of Object.entries(rawWeights as Record<string, unknown>)) {
          if (typeof val === "number") modifier_weights[key] = val;
        }
      }
      return {
        reference_duration_minutes: typeof record.reference_duration_minutes === "number" && record.reference_duration_minutes > 0 ? record.reference_duration_minutes : defaults.reference_duration_minutes,
        modifier_weights,
      };
    } catch {
      return defaultAnalyticsSettings();
    }
  }

  async getAnalytics(warIds: string[], userIds: string[]): Promise<ServiceResult<{ wars: unknown[]; member_stats: unknown[]; analytics_settings: AnalyticsSettings }>> {
    const warFilters: SQL<unknown>[] = [];
    if (warIds.length > 0) warFilters.push(inArray(warHistory.id, warIds));
    const wars = await this.db
      .select({ id: warHistory.id, eventId: warHistory.eventId, warName: warHistory.warName, enemyName: warHistory.enemyName, result: warHistory.result, ownStats: warHistory.ownStats, enemyStats: warHistory.enemyStats, durationMinutes: warHistory.durationMinutes, notes: warHistory.notes, createdBy: warHistory.createdBy, updatedBy: warHistory.updatedBy, createdAt: warHistory.createdAt, updatedAt: warHistory.updatedAt })
      .from(warHistory)
      .where(warFilters.length > 0 ? and(...warFilters) : undefined)
      .orderBy(desc(warHistory.createdAt), desc(warHistory.id))
      .limit(200);
    const historyIds = wars.map((w) => w.id);
    if (historyIds.length === 0) return ok({ wars: [], member_stats: [], analytics_settings: defaultAnalyticsSettings() });

    const teamSizeCounts = await this.db
      .select({ warHistoryId: warTeams.warHistoryId, memberCount: sql<number>`count(${warTeamMembers.id})`.as("member_count") })
      .from(warTeamMembers)
      .innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId))
      .where(inArray(warTeams.warHistoryId, historyIds))
      .groupBy(warTeams.warHistoryId);
    const teamSizeMap = new Map<string, number>();
    for (const row of teamSizeCounts) if (row.warHistoryId) teamSizeMap.set(row.warHistoryId, row.memberCount);

    const analyticsSettings = await this.readAnalyticsSettings();
    const warsWithModifier = wars.map((war) => {
      const teamSize = teamSizeMap.get(war.id) ?? 0;
      const modifier = computeWarModifier(war, teamSize, analyticsSettings);
      return { ...toWarHistoryPayload(war), team_size: teamSize, modifier: modifier.value, modifier_breakdown: modifier.breakdown };
    });

    const memberFilters: SQL<unknown>[] = [inArray(warTeams.warHistoryId, historyIds)];
    if (userIds.length > 0) memberFilters.push(inArray(warTeamMembers.userId, userIds));
    const members = await this.db
      .select({ userId: warTeamMembers.userId, stats: warTeamMembers.stats })
      .from(warTeamMembers)
      .innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId))
      .where(and(...memberFilters));
    const aggregate = new Map<string, { user_id: string; stats: Record<string, number> }>();
    for (const row of members) {
      const current = aggregate.get(row.userId) ?? { user_id: row.userId, stats: {} };
      for (const [key, val] of Object.entries(row.stats ?? {})) {
        current.stats[key] = (current.stats[key] ?? 0) + (val ?? 0);
      }
      aggregate.set(row.userId, current);
    }
    return ok({ wars: warsWithModifier, member_stats: Array.from(aggregate.values()), analytics_settings: analyticsSettings });
  }
}
