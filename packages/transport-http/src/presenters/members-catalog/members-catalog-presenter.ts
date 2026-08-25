import {
  assignBadgeResponseSchema,
  badgeAssignmentSchema,
  badgeAssignmentsCursorResponseSchema,
  classCatalogDeletedResponseSchema,
  classCatalogItemSchema,
  classCatalogListSchema,
  classTagDeletedResponseSchema,
  classTagListSchema,
  classTagSchema,
  memberBadgeDeletedResponseSchema,
  memberBadgeListSchema,
  memberBadgeSchema,
  unassignBadgeResponseSchema,
} from "@guild/shared";

export type BadgeAssignmentRecord = Readonly<{
  badgeId: string;
  userId: string;
  display_name: string | null;
  assignedBy: string;
  assignedByUsername: string | null;
  assignedAt: string;
}>;

export function presentBadgeAssignment(assignment: BadgeAssignmentRecord) {
  return badgeAssignmentSchema.parse({
    badge_id: assignment.badgeId,
    user_id: assignment.userId,
    display_name: assignment.display_name,
    assigned_by: assignment.assignedBy,
    assigned_by_display_name: assignment.assignedByUsername,
    assigned_at: assignment.assignedAt,
  });
}

export function presentBadgeAssignments(page: Readonly<{
  data: readonly BadgeAssignmentRecord[];
  next_cursor: string | null;
}>) {
  return badgeAssignmentsCursorResponseSchema.parse({
    data: page.data.map(presentBadgeAssignment),
    next_cursor: page.next_cursor,
  });
}

export const presentClass = (value: unknown) => classCatalogItemSchema.parse(value);
export const presentClasses = (value: unknown) => classCatalogListSchema.parse(value);
export const presentClassDeleted = (value: unknown) => classCatalogDeletedResponseSchema.parse(value);
export const presentClassTag = (value: unknown) => classTagSchema.parse(value);
export const presentClassTags = (value: unknown) => classTagListSchema.parse(value);
export const presentClassTagDeleted = (value: unknown) => classTagDeletedResponseSchema.parse(value);
export const presentBadge = (value: unknown) => memberBadgeSchema.parse(value);
export const presentBadges = (value: unknown) => memberBadgeListSchema.parse(value);
export const presentBadgeDeleted = (value: unknown) => memberBadgeDeletedResponseSchema.parse(value);
export const presentBadgeAssigned = (value: unknown) => assignBadgeResponseSchema.parse(value);
export const presentBadgeUnassigned = (value: unknown) => unassignBadgeResponseSchema.parse(value);
