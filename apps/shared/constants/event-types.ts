export const EVENT_TYPES = ["weekly_mission", "guild_war", "social", "other"] as const;

export type EventType = (typeof EVENT_TYPES)[number];
