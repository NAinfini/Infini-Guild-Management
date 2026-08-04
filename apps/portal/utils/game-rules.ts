import {
  DEFAULT_GAME_RULES,
  GUILD_WAR_KDA_KEY,
  evaluateKda,
  findEventTypeDefinition,
  findGuildWarMemberStatDefinition,
  findGuildWarResultDefinition,
  findGuildWarTeamStatDefinition,
  getEventBehavior,
  getLocalizedGameRuleLabel,
  type GameRules,
} from "@guild/shared";
import { usePreferencesStore } from "@portal/stores/preferences";

export type EventBehavior = "standard" | "guild_war" | "poll" | "raffle";

export function getCurrentGameRules(): GameRules {
  return DEFAULT_GAME_RULES;
}

function currentRuleLanguage(): "en" | "zh" {
  return usePreferencesStore.getState().locale;
}

function languageForRules(language: string = currentRuleLanguage()): "en" | "zh" {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function eventHasBehavior(eventTypeId: string, behavior: EventBehavior, rules = getCurrentGameRules()): boolean {
  return getEventBehavior(rules, eventTypeId) === behavior;
}

export function getEventTypeLabel(eventTypeId: string, language: string = currentRuleLanguage(), rules = getCurrentGameRules()): string {
  const definition = findEventTypeDefinition(rules, eventTypeId);
  return definition
    ? getLocalizedGameRuleLabel(definition.labels, languageForRules(language))
    : eventTypeId;
}

export function getEventTypeColor(eventTypeId: string, rules = getCurrentGameRules()): string {
  return findEventTypeDefinition(rules, eventTypeId)?.color ?? "#82C91E";
}

export function getGuildWarResultLabel(resultId: string, language: string = currentRuleLanguage(), rules = getCurrentGameRules()): string {
  const definition = findGuildWarResultDefinition(rules, resultId);
  return definition
    ? getLocalizedGameRuleLabel(definition.labels, languageForRules(language))
    : resultId;
}

export function getGuildWarResultColor(resultId: string | null | undefined, rules = getCurrentGameRules()): string {
  const tone = resultId ? findGuildWarResultDefinition(rules, resultId)?.tone : undefined;
  if (tone === "success") return "green";
  if (tone === "danger") return "red";
  return "gray";
}

export function getGuildWarTeamStatLabel(statKey: string, _language?: string, rules = getCurrentGameRules()): string {
  const definition = findGuildWarTeamStatDefinition(rules, statKey);
  return definition?.name ?? statKey;
}

export function getGuildWarMemberStatLabel(statKey: string, _language?: string, rules = getCurrentGameRules()): string {
  if (statKey === GUILD_WAR_KDA_KEY) return "KDA";
  const definition = findGuildWarMemberStatDefinition(rules, statKey);
  return definition?.name ?? statKey;
}

export function getGuildWarMetricValue(
  stats: Record<string, number | null> | null | undefined,
  metric: string,
  _rules = getCurrentGameRules(),
): number {
  if (metric === GUILD_WAR_KDA_KEY) {
    return evaluateKda(stats ?? {});
  }
  return stats?.[metric] ?? 0;
}

export function getGuildWarMetricValueOrNull(
  stats: Record<string, number | null> | null | undefined,
  metric: string,
  _rules = getCurrentGameRules(),
): number | null {
  if (metric === GUILD_WAR_KDA_KEY) {
    const dependencies = ["kills", "assists", "deaths"];
    if (!dependencies.some((key) => stats?.[key] !== null && stats?.[key] !== undefined)) return null;
    return evaluateKda(stats ?? {});
  }
  const value = stats?.[metric];
  return value === null || value === undefined ? null : value;
}
