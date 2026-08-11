import type { BadgeAssignment, CursorResponse, MemberBadge } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { apiRequest } from "../client";

export function fetchBadges(): Promise<MemberBadge[]> {
  return apiRequest<MemberBadge[]>("/api/badges");
}

export async function fetchBadgeAssignments(badgeId: string): Promise<BadgeAssignment[]> {
  const assignments: BadgeAssignment[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: String(LIMITS.pagination.badgeAssignments) });
    if (cursor) query.set("cursor", cursor);
    const page = await apiRequest<CursorResponse<BadgeAssignment>>(
      `/api/badges/${badgeId}/assignments?${query.toString()}`,
    );
    assignments.push(...page.data);
    cursor = page.next_cursor;
    if (cursor && seenCursors.has(cursor)) throw new Error("Badge assignment cursor did not advance");
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return assignments;
}
