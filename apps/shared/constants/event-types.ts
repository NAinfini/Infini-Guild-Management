import { activeGame } from "../games";

export const EVENT_TYPES = activeGame.eventTypes.map((e) => e.id) as unknown as readonly [string, ...string[]];

export type EventType = (typeof EVENT_TYPES)[number];
