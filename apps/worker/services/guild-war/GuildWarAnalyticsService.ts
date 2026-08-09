import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { siteAnalyticsSettingsSchema } from "@guild/shared";
import { siteConfig, warHistory, warTeamMembers, warTeams } from "../../db/schema";
import type { AnalyticsSettings } from "../AdminService";
import { ok, type ServiceResult } from "../result";
import {
  GuildWarCoreService,
  WAR_HISTORY_FIELDS,
  WAR_TEAM_MEMBER_STAT_FIELDS,
  toMemberStats,
  toWarHistoryPayload,
  type DrizzleDb,
  type GuildWarServiceDeps,
} from "./GuildWarCoreService";

type ModifierBreakdown = { factor: string; ratio: number; weight: number; contribution: number };

function computeWarModifier(
  war: { own_stats: Partial<Record<string, number | null>> | null; enemy_stats: Partial<Record<string, number | null>> | null },
  _ownTeamSize: number,
  settings: AnalyticsSettings,
): { value: number; breakdown: ModifierBreakdown[] } {
  const factors = Object.entries(settings.modifier_weights)
    .filter(([, weight]) => weight > 0)
    .map(([key, weight]) => {
      return { key, weight, ownVal: war.own_stats?.[key] ?? null, enemyVal: war.enemy_stats?.[key] ?? null };
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
    const [row] = await this.db
      .select({
        referenceDurationMinutes: siteConfig.analyticsReferenceDurationMinutes,
        killsWeight: siteConfig.analyticsKillsWeight,
        towersWeight: siteConfig.analyticsTowersWeight,
        baseHpWeight: siteConfig.analyticsBaseHpWeight,
        creditsWeight: siteConfig.analyticsCreditsWeight,
        distanceWeight: siteConfig.analyticsDistanceWeight,
      })
      .from(siteConfig)
      .where(eq(siteConfig.id, "default"))
      .limit(1);
    if (!row) throw new Error('Required site_config singleton "default" is missing');
    return siteAnalyticsSettingsSchema.parse({
      reference_duration_minutes: row.referenceDurationMinutes,
      modifier_weights: {
        kills: row.killsWeight,
        towers: row.towersWeight,
        base_hp: row.baseHpWeight,
        credits: row.creditsWeight,
        distance: row.distanceWeight,
      },
    });
  }

  async getAnalytics(warIds: string[], userIds: string[]): Promise<ServiceResult<{ wars: unknown[]; member_stats: unknown[]; analytics_settings: AnalyticsSettings }>> {
    const analyticsSettings = await this.readAnalyticsSettings();
    const warFilters: SQL<unknown>[] = [];
    if (warIds.length > 0) warFilters.push(inArray(warHistory.id, warIds));
    const wars = await this.db
      .select(WAR_HISTORY_FIELDS)
      .from(warHistory)
      .where(warFilters.length > 0 ? and(...warFilters) : undefined)
      .orderBy(desc(warHistory.createdAt), desc(warHistory.id))
      .limit(200);
    const historyIds = wars.map((w) => w.id);
    if (historyIds.length === 0) return ok({ wars: [], member_stats: [], analytics_settings: analyticsSettings });

    const teamSizeCounts = await this.db
      .select({ warHistoryId: warTeams.warHistoryId, memberCount: sql<number>`count(${warTeamMembers.id})`.as("member_count") })
      .from(warTeamMembers)
      .innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId))
      .where(inArray(warTeams.warHistoryId, historyIds))
      .groupBy(warTeams.warHistoryId);
    const teamSizeMap = new Map<string, number>();
    for (const row of teamSizeCounts) if (row.warHistoryId) teamSizeMap.set(row.warHistoryId, row.memberCount);

    const warsWithModifier = wars.map((war) => {
      const teamSize = teamSizeMap.get(war.id) ?? 0;
      const payload = toWarHistoryPayload(war);
      const modifier = computeWarModifier(payload, teamSize, analyticsSettings);
      return { ...payload, team_size: teamSize, modifier: modifier.value, modifier_breakdown: modifier.breakdown };
    });

    const memberFilters: SQL<unknown>[] = [inArray(warTeams.warHistoryId, historyIds)];
    if (userIds.length > 0) memberFilters.push(inArray(warTeamMembers.userId, userIds));
    const members = await this.db
      .select({ userId: warTeamMembers.userId, ...WAR_TEAM_MEMBER_STAT_FIELDS })
      .from(warTeamMembers)
      .innerJoin(warTeams, eq(warTeams.id, warTeamMembers.warTeamId))
      .where(and(...memberFilters));
    const aggregate = new Map<string, { user_id: string; stats: Record<string, number> }>();
    for (const row of members) {
      const current = aggregate.get(row.userId) ?? { user_id: row.userId, stats: {} };
      for (const [key, val] of Object.entries(toMemberStats(row) ?? {})) {
        if (val !== null) current.stats[key] = (current.stats[key] ?? 0) + val;
      }
      aggregate.set(row.userId, current);
    }
    return ok({ wars: warsWithModifier, member_stats: Array.from(aggregate.values()), analytics_settings: analyticsSettings });
  }
}
