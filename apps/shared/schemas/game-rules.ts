import {
  GUILD_WAR_RESULT_DEFINITIONS,
  type GuildWarResultDefinition,
} from "../constants/guild-war";

export const GAME_RULE_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export const GAME_RULE_ICONS = [
  "calendar",
  "target",
  "swords",
  "users",
  "poll",
  "gift",
] as const;

export type GameRuleLabel = {
  en: string;
  zh: string;
};

export type GameRuleIcon = (typeof GAME_RULE_ICONS)[number];
export type EventBehavior = "standard" | "guild_war" | "poll" | "raffle";

export type GameEventTypeDefinition = {
  id: string;
  labels: GameRuleLabel;
  behavior: EventBehavior;
  icon: GameRuleIcon;
  color: string;
  enabled: boolean;
};

export type GuildWarTeamStatDefinition = {
  key: string;
  name: string;
  dashboard: "primary" | "internal" | "hidden";
};

export type GuildWarMemberStatDefinition = {
  key: string;
  name: string;
  lower_is_better: boolean;
  mvp: boolean;
};

export type GameRules = {
  events: {
    types: GameEventTypeDefinition[];
  };
  guild_war: {
    team_stats: GuildWarTeamStatDefinition[];
    member_stats: GuildWarMemberStatDefinition[];
    default_member_stat_key: string;
  };
};

/**
 * Fixed source-owned domain rules. These are deliberately not part of Site
 * Config and are never read from or written to D1.
 */
export const DEFAULT_GAME_RULES: GameRules = {
  events: {
    types: [
      { id: "weekly_mission", labels: { en: "Weekly Mission", zh: "周常任务" }, behavior: "standard", icon: "target", color: "#15AABF", enabled: true },
      { id: "guild_war", labels: { en: "Guild War", zh: "公会战" }, behavior: "guild_war", icon: "swords", color: "#FA5252", enabled: true },
      { id: "social", labels: { en: "Social", zh: "社交" }, behavior: "standard", icon: "users", color: "#BE4BDB", enabled: true },
      { id: "poll", labels: { en: "Poll", zh: "投票" }, behavior: "poll", icon: "poll", color: "#12B886", enabled: true },
      { id: "raffle", labels: { en: "Raffle", zh: "抽奖" }, behavior: "raffle", icon: "gift", color: "#E64980", enabled: true },
      { id: "other", labels: { en: "Other", zh: "其他" }, behavior: "standard", icon: "calendar", color: "#868E96", enabled: true },
    ],
  },
  guild_war: {
    team_stats: [
      { key: "kills", name: "Kills", dashboard: "primary" },
      { key: "towers", name: "Towers", dashboard: "internal" },
      { key: "base_hp", name: "Base HP", dashboard: "internal" },
      { key: "credits", name: "Credits", dashboard: "internal" },
      { key: "distance", name: "Distance", dashboard: "internal" },
    ],
    member_stats: [
      { key: "kills", name: "Kills", lower_is_better: false, mvp: false },
      { key: "deaths", name: "Deaths", lower_is_better: true, mvp: false },
      { key: "assists", name: "Assists", lower_is_better: false, mvp: false },
      { key: "damage", name: "Damage", lower_is_better: false, mvp: true },
      { key: "healing", name: "Healing", lower_is_better: false, mvp: true },
      { key: "building_damage", name: "Building Damage", lower_is_better: false, mvp: true },
      { key: "credits", name: "Credits", lower_is_better: false, mvp: false },
      { key: "damage_taken", name: "Damage Taken", lower_is_better: true, mvp: true },
    ],
    default_member_stat_key: "damage",
  },
};

export function getLocalizedGameRuleLabel(labels: GameRuleLabel, locale: string): string {
  return locale.toLowerCase().startsWith("zh") ? labels.zh : labels.en;
}

export function findEventTypeDefinition(rules: GameRules, id: string): GameEventTypeDefinition | undefined {
  return rules.events.types.find((item) => item.id === id);
}

export function getEventBehavior(rules: GameRules, id: string): EventBehavior | undefined {
  return findEventTypeDefinition(rules, id)?.behavior;
}

export function findGuildWarResultDefinition(id: string): GuildWarResultDefinition | undefined;
export function findGuildWarResultDefinition(_rules: GameRules, id: string): GuildWarResultDefinition | undefined;
export function findGuildWarResultDefinition(
  rulesOrId: GameRules | string,
  id?: string,
): GuildWarResultDefinition | undefined {
  const resultId = typeof rulesOrId === "string" ? rulesOrId : id;
  return GUILD_WAR_RESULT_DEFINITIONS.find((item) => item.id === resultId);
}

export function findGuildWarTeamStatDefinition(rules: GameRules, key: string): GuildWarTeamStatDefinition | undefined {
  return rules.guild_war.team_stats.find((item) => item.key === key);
}

export function findGuildWarMemberStatDefinition(rules: GameRules, key: string): GuildWarMemberStatDefinition | undefined {
  return rules.guild_war.member_stats.find((item) => item.key === key);
}

export function evaluateKda(stats: Record<string, number | null | undefined>): number {
  const finiteValue = (key: string): number => {
    const value = stats[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const result = (finiteValue("kills") + finiteValue("assists")) / Math.max(finiteValue("deaths"), 1);
  if (!Number.isFinite(result)) return 0;
  return Object.is(result, -0) ? 0 : result;
}
