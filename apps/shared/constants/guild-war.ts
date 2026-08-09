/**
 * Stable guild-war data contracts.
 *
 * These values are persisted in fixed D1 columns and API JSON objects or have code paths attached to them,
 * so changing them requires a data/API migration rather than a runtime setting.
 */
export const WAR_RESULTS = ["win", "loss", "draw"] as const;
export type WarResult = (typeof WAR_RESULTS)[number];

export const GUILD_WAR_RESULT_DEFINITIONS = [
  { id: "win", labels: { en: "Win", zh: "胜利" }, outcome: "win", tone: "success" },
  { id: "loss", labels: { en: "Loss", zh: "失败" }, outcome: "loss", tone: "danger" },
  { id: "draw", labels: { en: "Draw", zh: "平局" }, outcome: "draw", tone: "neutral" },
] as const;
export type GuildWarResultDefinition = (typeof GUILD_WAR_RESULT_DEFINITIONS)[number];

export const GUILD_WAR_KDA_KEY = "kda" as const;

export const WAR_TEAM_OBJECTIVE_KEYS = [
  "kills",
  "towers",
  "base_hp",
  "credits",
  "distance",
] as const;
export type WarTeamObjectiveKey = (typeof WAR_TEAM_OBJECTIVE_KEYS)[number];

export const WAR_MEMBER_STAT_KEYS = [
  "kills",
  "deaths",
  "assists",
  "damage",
  "healing",
  "building_damage",
  "credits",
  "damage_taken",
] as const;
export type WarMemberStatKey = (typeof WAR_MEMBER_STAT_KEYS)[number];

export const WAR_COMPUTED_STAT_KEYS = ["kda"] as const;
export type WarComputedStatKey = (typeof WAR_COMPUTED_STAT_KEYS)[number];

export const LOWER_IS_BETTER_WAR_STAT_KEYS = [
  "deaths",
  "damage_taken",
] as const satisfies readonly WarMemberStatKey[];

export const WAR_MVP_STAT_KEYS = [
  "damage",
  "healing",
  "damage_taken",
  "building_damage",
] as const satisfies readonly WarMemberStatKey[];

/** Existing rows store this exact value; changing its casing would orphan them. */
export const GUILD_WAR_CAPTAIN_ROLE_TAG = "Captain";
