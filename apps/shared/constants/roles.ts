export const ROLES = ["admin", "moderator", "member"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LEVEL: Record<Role, number> = {
  admin: 3,
  moderator: 2,
  member: 1,
};

export function hasRoleAtLeast(current: Role, required: Role): boolean {
  return ROLE_LEVEL[current] >= ROLE_LEVEL[required];
}
