import { isNull, lte, or, type SQL } from "drizzle-orm";
import { events } from "../../db/schema";

export function eventPublicVisibilityFilter(nowIso: string): SQL<unknown> {
  return or(isNull(events.visibleAt), lte(events.visibleAt, nowIso))!;
}

export function isEventPubliclyVisible(
  visibleAt: string | null | undefined,
  nowIso: string,
): boolean {
  if (!visibleAt) return true;
  const visibleAtTime = Date.parse(visibleAt);
  const nowTime = Date.parse(nowIso);
  return Number.isFinite(visibleAtTime) && Number.isFinite(nowTime) && visibleAtTime <= nowTime;
}
