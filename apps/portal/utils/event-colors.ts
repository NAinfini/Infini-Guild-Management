import { getEventTypeColor } from "./game-rules";

/** Unknown IDs are rendered as an obvious data anomaly instead of a valid type. */
export const UNKNOWN_EVENT_TYPE_COLOR = "#82C91E";

export function eventTypeColor(eventTypeId: string): string {
  return getEventTypeColor(eventTypeId);
}
