/** Event types have behavior and SQL checks attached; they are an API contract. */
export const EVENT_TYPES = [
  "weekly_mission",
  "guild_war",
  "social",
  "poll",
  "raffle",
  "other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
