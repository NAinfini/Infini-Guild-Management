import type { MemberBadge, BadgeAssignment } from "@guild/shared";
import { apiRequest } from "../client";

export function fetchBadges(): Promise<MemberBadge[]> {
  return apiRequest<MemberBadge[]>("/api/badges");
}

export function fetchBadgeAssignments(badgeId: string): Promise<BadgeAssignment[]> {
  return apiRequest<BadgeAssignment[]>(`/api/badges/${badgeId}/assignments`);
}
