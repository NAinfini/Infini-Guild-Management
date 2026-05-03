import {
  MODERATOR_DEFAULT_PERMISSIONS,
  MEMBER_DEFAULT_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  adminRoleSchema,
  inviteLinkSchema,
  inviteLinkStatsSchema,
  type Permission,
  type Role,
  type AdminRole,
} from "@guild/shared";
import { and, desc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { inviteLinks, rolePermissions, roles, sessions, userAuthPassword, users } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import type { MediaLike } from "./AdminAuditService";

export type { MediaLike } from "./AdminAuditService";

type DrizzleDb = ReturnType<typeof drizzle>;

export type AnalyticsSettings = {
  reference_duration_minutes: number;
  modifier_weight_kda: number;
  modifier_weight_towers: number;
  modifier_weight_credits: number;
  modifier_weight_distance: number;
  modifier_weight_basehp: number;
};

const ANALYTICS_SETTINGS_KEY = "config/analytics-settings.json";
const D1_SAFE_VARIABLE_LIMIT = 90;
const ROLE_PERMISSION_INSERT_BATCH_SIZE = Math.max(1, Math.floor(D1_SAFE_VARIABLE_LIMIT / 3));

const BUILTIN_ROLE_DEFAULTS: Record<Role, { name: string; level: number; color: string }> = {
  admin: { name: "Admin", level: 3, color: "red" },
  moderator: { name: "Moderator", level: 2, color: "blue" },
  member: { name: "Member", level: 1, color: "gray" },
};

export function defaultPermissionGranted(roleId: string, permission: Permission): boolean {
  if (roleId === "admin") return true;
  if (roleId === "moderator") return MODERATOR_DEFAULT_PERMISSIONS.has(permission);
  if (roleId === "member") return MEMBER_DEFAULT_PERMISSIONS.has(permission);
  return false;
}

export function emptyPermissionRecord(): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, false])) as Record<Permission, boolean>;
}

export function fullAdminPermissionRecord(): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, true])) as Record<Permission, boolean>;
}

export function parsePermissionRecord(
  roleId: string,
  permissionRows: Array<{ permission: string; granted: boolean }>,
): Record<Permission, boolean> {
  const record = roleId === "admin" ? fullAdminPermissionRecord() : emptyPermissionRecord();
  for (const row of permissionRows) {
    const perm = row.permission as Permission;
    if (!PERMISSIONS.includes(perm)) continue;
    record[perm] = roleId === "admin" ? true : row.granted;
  }
  return record;
}

export async function insertRolePermissionRows(
  db: DrizzleDb,
  rows: Array<{ roleId: string; permission: string; granted: boolean }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += ROLE_PERMISSION_INSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + ROLE_PERMISSION_INSERT_BATCH_SIZE);
    await db.insert(rolePermissions).values(chunk);
  }
}

export async function replaceRolePermissions(
  rawDb: D1Database,
  roleId: string,
  permissionRecord: Record<Permission, boolean>,
): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  stmts.push(rawDb.prepare("DELETE FROM role_permissions WHERE role_id = ?1").bind(roleId));
  for (const perm of PERMISSIONS) {
    stmts.push(rawDb.prepare("INSERT INTO role_permissions (role_id, permission, granted) VALUES (?1, ?2, ?3)").bind(roleId, perm, permissionRecord[perm] ? 1 : 0));
  }
  await rawDb.batch(stmts);
}

export async function ensureBuiltinRolesAndPermissions(db: DrizzleDb): Promise<void> {
  const existingRoleRows = await db
    .select({ id: roles.id }).from(roles).where(inArray(roles.id, [...ROLES]));
  const existingRoleSet = new Set(existingRoleRows.map((r) => r.id));

  for (const roleId of ROLES) {
    if (existingRoleSet.has(roleId)) continue;
    const defaults = BUILTIN_ROLE_DEFAULTS[roleId];
    await db.insert(roles).values({ id: roleId, name: defaults.name, level: defaults.level, color: defaults.color, isBuiltin: true });
  }

  const permissionRows = await db
    .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
    .from(rolePermissions).where(inArray(rolePermissions.roleId, [...ROLES]));
  const existingPermSet = new Set(permissionRows.map((r) => `${r.roleId}:${r.permission}`));
  const missingRows: Array<{ roleId: string; permission: string; granted: boolean }> = [];
  for (const roleId of ROLES) {
    for (const perm of PERMISSIONS) {
      if (!existingPermSet.has(`${roleId}:${perm}`)) {
        missingRows.push({ roleId, permission: perm, granted: defaultPermissionGranted(roleId, perm) });
      }
    }
  }
  if (missingRows.length > 0) {
    await insertRolePermissionRows(db, missingRows);
  }
}

export function defaultAnalyticsSettings(): AnalyticsSettings {
  return {
    reference_duration_minutes: 30,
    modifier_weight_kda: 0.30,
    modifier_weight_towers: 0.10,
    modifier_weight_credits: 0.30,
    modifier_weight_distance: 0.15,
    modifier_weight_basehp: 0.15,
  };
}

export function normalizeAnalyticsWeights(settings: AnalyticsSettings): AnalyticsSettings {
  const weightSum = settings.modifier_weight_kda + settings.modifier_weight_towers +
    settings.modifier_weight_credits + settings.modifier_weight_distance + settings.modifier_weight_basehp;
  if (weightSum <= 0) return settings;
  return {
    ...settings,
    modifier_weight_kda: Number((settings.modifier_weight_kda / weightSum).toFixed(4)),
    modifier_weight_towers: Number((settings.modifier_weight_towers / weightSum).toFixed(4)),
    modifier_weight_credits: Number((settings.modifier_weight_credits / weightSum).toFixed(4)),
    modifier_weight_distance: Number((settings.modifier_weight_distance / weightSum).toFixed(4)),
    modifier_weight_basehp: Number((settings.modifier_weight_basehp / weightSum).toFixed(4)),
  };
}

export function parseAnalyticsInput(record: Record<string, unknown>): AnalyticsSettings {
  const defaults = defaultAnalyticsSettings();
  return {
    reference_duration_minutes:
      typeof record.reference_duration_minutes === "number" && record.reference_duration_minutes > 0
        ? record.reference_duration_minutes : defaults.reference_duration_minutes,
    modifier_weight_kda: typeof record.modifier_weight_kda === "number" ? record.modifier_weight_kda : defaults.modifier_weight_kda,
    modifier_weight_towers: typeof record.modifier_weight_towers === "number" ? record.modifier_weight_towers : defaults.modifier_weight_towers,
    modifier_weight_credits: typeof record.modifier_weight_credits === "number" ? record.modifier_weight_credits : defaults.modifier_weight_credits,
    modifier_weight_distance: typeof record.modifier_weight_distance === "number" ? record.modifier_weight_distance : defaults.modifier_weight_distance,
    modifier_weight_basehp: typeof record.modifier_weight_basehp === "number" ? record.modifier_weight_basehp : defaults.modifier_weight_basehp,
  };
}

type AuditLogInput = {
  entityType: string;
  action: string;
  actorId: string;
  entityId: string;
  diffTitle?: string | null;
  detailText?: string | null;
};

type AdminServiceDeps = {
  db: DrizzleDb;
  media: MediaLike;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  createPasswordHash: (password: string) => Promise<{ passwordHash: string; salt: string }>;
  generateId: () => string;
  generateInviteCode: () => string;
  generateTemporaryPassword: () => string;
  rawDb: D1Database;
  ws?: unknown;
  now?: () => Date;
};

export class AdminService {
  private readonly deps: AdminServiceDeps;

  constructor(deps: AdminServiceDeps) {
    this.deps = deps;
  }

  async listInviteLinks(includeExpired: boolean, includeRevoked: boolean): Promise<ServiceResult<unknown[]>> {
    const nowIso = this.now().toISOString();
    const filters: SQL<unknown>[] = [];
    if (!includeRevoked) filters.push(isNull(inviteLinks.revokedAt));
    if (!includeExpired) filters.push(or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, nowIso))!);
    const rows = await this.deps.db.select({ id: inviteLinks.id, code: inviteLinks.code, createdBy: inviteLinks.createdBy, maxUses: inviteLinks.maxUses, usedCount: inviteLinks.usedCount, expiresAt: inviteLinks.expiresAt, createdAt: inviteLinks.createdAt, revokedAt: inviteLinks.revokedAt }).from(inviteLinks).where(and(...filters)).orderBy(desc(inviteLinks.createdAt)).limit(100);
    return ok(rows.map((r) => inviteLinkSchema.parse({ id: r.id, code: r.code, created_by: r.createdBy, max_uses: r.maxUses, used_count: r.usedCount, expires_at: r.expiresAt, created_at: r.createdAt, revoked_at: r.revokedAt })));
  }

  async getInviteLinkStats(): Promise<ServiceResult<{ total: number; active: number; revoked: number; expired: number; data: unknown[] }>> {
    const nowIso = this.now().toISOString();
    const rows = await this.deps.db.select({ id: inviteLinks.id, usedCount: inviteLinks.usedCount, maxUses: inviteLinks.maxUses, expiresAt: inviteLinks.expiresAt, revokedAt: inviteLinks.revokedAt }).from(inviteLinks).limit(100);
    const stats = rows.map((r) => inviteLinkStatsSchema.parse({ id: r.id, used_count: r.usedCount, max_uses: r.maxUses, expires_at: r.expiresAt, revoked_at: r.revokedAt }));
    const revoked = stats.filter((s) => s.revoked_at !== null).length;
    const expired = stats.filter((s) => s.expires_at !== null && s.expires_at <= nowIso).length;
    const active = stats.filter((s) => s.revoked_at === null && (s.expires_at === null || s.expires_at > nowIso) && s.used_count < s.max_uses).length;
    return ok({ total: stats.length, active, revoked, expired, data: stats });
  }

  async createInviteLink(actorId: string, maxUses: number, expiresAt: string | null): Promise<ServiceResult<unknown>> {
    const inviteId = this.deps.generateId();
    const code = this.deps.generateInviteCode();
    await this.deps.db.insert(inviteLinks).values({ id: inviteId, code, createdBy: actorId, maxUses, usedCount: 0, expiresAt, revokedAt: null });
    const created = (await this.deps.db.select({ id: inviteLinks.id, code: inviteLinks.code, createdBy: inviteLinks.createdBy, maxUses: inviteLinks.maxUses, usedCount: inviteLinks.usedCount, expiresAt: inviteLinks.expiresAt, createdAt: inviteLinks.createdAt, revokedAt: inviteLinks.revokedAt }).from(inviteLinks).where(eq(inviteLinks.id, inviteId)).limit(1))[0];
    if (!created) return err("SERVER_ERROR", "Failed to create invite link");
    await this.deps.writeAuditLog({ entityType: "invite_link", action: "create", actorId, entityId: inviteId, diffTitle: code, detailText: JSON.stringify({ max_uses: maxUses, expires_at: expiresAt }) });
    return ok(inviteLinkSchema.parse({ id: created.id, code: created.code, created_by: created.createdBy, max_uses: created.maxUses, used_count: created.usedCount, expires_at: created.expiresAt, created_at: created.createdAt, revoked_at: created.revokedAt }));
  }

  async revokeInviteLink(actorId: string, inviteId: string): Promise<ServiceResult<void>> {
    const existing = (await this.deps.db.select({ id: inviteLinks.id, code: inviteLinks.code, revokedAt: inviteLinks.revokedAt }).from(inviteLinks).where(eq(inviteLinks.id, inviteId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Invite link not found");
    if (existing.revokedAt !== null) return err("CONFLICT", "Invite link already revoked");
    await this.deps.db.update(inviteLinks).set({ revokedAt: this.now().toISOString() }).where(eq(inviteLinks.id, inviteId));
    await this.deps.writeAuditLog({ entityType: "invite_link", action: "revoke", actorId, entityId: inviteId, diffTitle: existing.code });
    return ok(undefined);
  }

  async deleteInviteLink(actorId: string, inviteId: string): Promise<ServiceResult<void>> {
    const existing = (await this.deps.db.select({ id: inviteLinks.id, code: inviteLinks.code }).from(inviteLinks).where(eq(inviteLinks.id, inviteId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Invite link not found");
    await this.deps.db.delete(inviteLinks).where(eq(inviteLinks.id, inviteId));
    await this.deps.writeAuditLog({ entityType: "invite_link", action: "delete", actorId, entityId: inviteId, diffTitle: existing.code });
    return ok(undefined);
  }

  async batchUpdateRole(actorId: string, userIds: string[], newRoleId: string): Promise<ServiceResult<{ updated: number }>> {
    const targetIds = userIds.filter((id) => id !== actorId);
    if (targetIds.length === 0) return ok({ updated: 0 });
    if (newRoleId === "admin") return err("FORBIDDEN", "Cannot assign builtin admin role via API");
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const roleExists = (await this.deps.db.select({ id: roles.id }).from(roles).where(eq(roles.id, newRoleId)).limit(1))[0];
    if (!roleExists) return err("NOT_FOUND", "Role not found");
    const existingUsers = await this.deps.db.select({ id: users.id }).from(users).where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));
    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map((r) => r.id);
      await this.deps.db.update(users).set({ role: newRoleId, updatedAt: this.now().toISOString() }).where(inArray(users.id, existingIds));
      await this.deps.db.delete(sessions).where(inArray(sessions.userId, existingIds));
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "batch_role_update", actorId, entityId: "batch", detailText: JSON.stringify({ user_ids: targetIds, new_role: newRoleId }) });
    return ok({ updated: existingUsers.length });
  }

  async batchDeactivate(actorId: string, userIds: string[]): Promise<ServiceResult<{ updated: number }>> {
    const targetIds = userIds.filter((id) => id !== actorId);
    if (targetIds.length === 0) return ok({ updated: 0 });
    const existingUsers = await this.deps.db.select({ id: users.id }).from(users).where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));
    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map((r) => r.id);
      await this.deps.db.update(users).set({ isActive: false, updatedAt: this.now().toISOString() }).where(inArray(users.id, existingIds));
      await this.deps.db.delete(sessions).where(inArray(sessions.userId, existingIds));
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "batch_deactivate", actorId, entityId: "batch", detailText: JSON.stringify({ user_ids: targetIds }) });
    return ok({ updated: existingUsers.length });
  }

  async batchReactivate(actorId: string, userIds: string[]): Promise<ServiceResult<{ updated: number }>> {
    const targetIds = userIds.filter((id) => id !== actorId);
    if (targetIds.length === 0) return ok({ updated: 0 });
    const existingUsers = await this.deps.db.select({ id: users.id }).from(users).where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));
    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map((r) => r.id);
      await this.deps.db.update(users).set({ isActive: true, updatedAt: this.now().toISOString() }).where(inArray(users.id, existingIds));
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "batch_reactivate", actorId, entityId: "batch", detailText: JSON.stringify({ user_ids: targetIds }) });
    return ok({ updated: existingUsers.length });
  }

  async batchDelete(actorId: string, userIds: string[]): Promise<ServiceResult<{ updated: number }>> {
    const targetIds = userIds.filter((id) => id !== actorId);
    if (targetIds.length === 0) return ok({ updated: 0 });
    const existingUsers = await this.deps.db.select({ id: users.id }).from(users).where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));
    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map((r) => r.id);
      const now = this.now().toISOString();
      await this.deps.db.update(users).set({ isActive: false, deletedAt: now, updatedAt: now }).where(inArray(users.id, existingIds));
      await this.deps.db.delete(sessions).where(inArray(sessions.userId, existingIds));
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "batch_delete", actorId, entityId: "batch", detailText: JSON.stringify({ user_ids: targetIds }) });
    return ok({ updated: existingUsers.length });
  }

  async createMember(actorId: string, username: string): Promise<ServiceResult<{ user_id: string; username: string; temporary_password: string }>> {
    const existing = (await this.deps.db.select({ id: users.id, deletedAt: users.deletedAt }).from(users).where(eq(users.username, username)).limit(1))[0];
    if (existing && existing.deletedAt === null) return err("CONFLICT", "Username already taken");
    const userId = this.deps.generateId();
    const temporaryPassword = this.deps.generateTemporaryPassword();
    const passwordHash = await this.deps.createPasswordHash(temporaryPassword);
    const profileId = this.deps.generateId();
    const nowIso = this.now().toISOString();
    try {
      await this.deps.rawDb.batch([
        this.deps.rawDb.prepare("INSERT INTO users (id, username, role, is_active, deleted_at, created_at, updated_at) VALUES (?1, ?2, 'member', 1, NULL, ?3, ?3)").bind(userId, username, nowIso),
        this.deps.rawDb.prepare("INSERT INTO user_auth_password (user_id, password_hash, salt) VALUES (?1, ?2, ?3)").bind(userId, passwordHash.passwordHash, passwordHash.salt),
        this.deps.rawDb.prepare("INSERT INTO member_profiles (id, user_id, power, classes, images, video_urls) VALUES (?1, ?2, 0, '[]', '[]', '[]')").bind(profileId, userId),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.username")) return err("CONFLICT", "Username already taken");
      throw error;
    }
    await this.deps.writeAuditLog({ entityType: "user", action: "admin_create_member", actorId, entityId: userId, detailText: JSON.stringify({ username }) });
    return ok({ user_id: userId, username, temporary_password: temporaryPassword });
  }

  async updateUserRole(actorId: string, targetUserId: string, newRoleId: string): Promise<ServiceResult<void>> {
    if (targetUserId === actorId) return err("CONFLICT", "You cannot change your own role");
    if (newRoleId === "admin") return err("FORBIDDEN", "Cannot assign builtin admin role via API");
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const roleExists = (await this.deps.db.select({ id: roles.id }).from(roles).where(eq(roles.id, newRoleId)).limit(1))[0];
    if (!roleExists) return err("NOT_FOUND", "Role not found");
    const target = (await this.deps.db.select({ id: users.id, role: users.role, deletedAt: users.deletedAt }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    await this.deps.db.update(users).set({ role: newRoleId, updatedAt: this.now().toISOString() }).where(eq(users.id, targetUserId));
    await this.deps.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    await this.deps.writeAuditLog({ entityType: "user", action: "update_role", actorId, entityId: targetUserId, detailText: JSON.stringify({ from: target.role, to: newRoleId }) });
    return ok(undefined);
  }

  async deactivateUser(actorId: string, targetUserId: string, reason?: string): Promise<ServiceResult<void>> {
    if (targetUserId === actorId) return err("CONFLICT", "You cannot deactivate yourself");
    const target = (await this.deps.db.select({ id: users.id, isActive: users.isActive, deletedAt: users.deletedAt }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    if (!target.isActive) return err("CONFLICT", "User already deactivated");
    const nowIso = this.now().toISOString();
    await this.deps.rawDb.batch([
      this.deps.rawDb.prepare("UPDATE users SET is_active = 0, updated_at = ?1 WHERE id = ?2").bind(nowIso, targetUserId),
      this.deps.rawDb.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(targetUserId),
    ]);
    await this.deps.writeAuditLog({ entityType: "user", action: "deactivate", actorId, entityId: targetUserId, detailText: JSON.stringify({ reason: reason ?? null }) });
    return ok(undefined);
  }

  async reactivateUser(actorId: string, targetUserId: string, reason?: string): Promise<ServiceResult<void>> {
    const target = (await this.deps.db.select({ id: users.id, isActive: users.isActive, deletedAt: users.deletedAt }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    if (target.isActive) return err("CONFLICT", "User is already active");
    await this.deps.db.update(users).set({ isActive: true, updatedAt: this.now().toISOString() }).where(eq(users.id, targetUserId));
    await this.deps.writeAuditLog({ entityType: "user", action: "reactivate", actorId, entityId: targetUserId, detailText: JSON.stringify({ reason: reason ?? null }) });
    return ok(undefined);
  }

  async resetPassword(actorId: string, targetUserId: string, temporaryPasswordInput?: string): Promise<ServiceResult<{ temporary_password: string }>> {
    const temporaryPassword = temporaryPasswordInput ?? this.deps.generateTemporaryPassword();
    if (temporaryPassword.length < 8) return err("VALIDATION_ERROR", "temporary_password must be at least 8 characters");
    const target = (await this.deps.db.select({ id: users.id, deletedAt: users.deletedAt }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    const passwordHash = await this.deps.createPasswordHash(temporaryPassword);
    await this.deps.db.update(userAuthPassword).set({ passwordHash: passwordHash.passwordHash, salt: passwordHash.salt, updatedAt: this.now().toISOString() }).where(eq(userAuthPassword.userId, targetUserId));
    await this.deps.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    await this.deps.writeAuditLog({ entityType: "user_auth", action: "reset_password", actorId, entityId: targetUserId });
    return ok({ temporary_password: temporaryPassword });
  }

  async listRoles(): Promise<ServiceResult<unknown[]>> {
    const roleRows = await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin, createdAt: roles.createdAt, updatedAt: roles.updatedAt }).from(roles).orderBy(desc(roles.level), roles.name);
    const roleIds = roleRows.map((r) => r.id);
    const permissionRows = roleIds.length > 0 ? await this.deps.db.select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds)) : [];
    const assignedRows = await this.deps.db.select({ roleId: users.role, count: sql<number>`count(*)` }).from(users).where(isNull(users.deletedAt)).groupBy(users.role);
    const assignedCountByRole = new Map<string, number>(assignedRows.map((r) => [r.roleId, Number(r.count ?? 0)]));
    return ok(roleRows.map((r) => adminRoleSchema.parse({ id: r.id, name: r.name, level: r.level, color: r.color, is_builtin: r.isBuiltin, created_at: r.createdAt, updated_at: r.updatedAt, permissions: parsePermissionRecord(r.id, permissionRows.filter((p) => p.roleId === r.id).map((p) => ({ permission: p.permission, granted: p.granted }))), assigned_user_count: assignedCountByRole.get(r.id) ?? 0 })));
  }

  async createRole(actorId: string, input: { id?: string; name: string; level: number; color?: string; permissions?: Record<string, boolean> }): Promise<ServiceResult<unknown>> {
    const roleId = (input.id?.trim() || `custom_${this.deps.generateId().toLowerCase()}`).toLowerCase();
    if ((ROLES as readonly string[]).includes(roleId)) return err("CONFLICT", "Built-in role ids are reserved");
    if (input.level > 2) return err("VALIDATION_ERROR", "Custom role level must be 1 or 2");
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const existing = (await this.deps.db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (existing) return err("CONFLICT", "Role id already exists");
    await this.deps.db.insert(roles).values({ id: roleId, name: input.name.trim(), level: input.level, color: input.color ?? null, isBuiltin: false });
    const permissionRecord = emptyPermissionRecord();
    for (const perm of PERMISSIONS) permissionRecord[perm] = Boolean(input.permissions?.[perm]);
    await replaceRolePermissions(this.deps.rawDb, roleId, permissionRecord);
    await this.deps.writeAuditLog({ entityType: "role", action: "create", actorId, entityId: roleId, detailText: JSON.stringify({ name: input.name.trim(), level: input.level, color: input.color ?? null, permissions: permissionRecord }) });
    const created = (await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin, createdAt: roles.createdAt, updatedAt: roles.updatedAt }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (!created) return err("SERVER_ERROR", "Failed to create role");
    return ok(adminRoleSchema.parse({ id: created.id, name: created.name, level: created.level, color: created.color, is_builtin: created.isBuiltin, created_at: created.createdAt, updated_at: created.updatedAt, permissions: permissionRecord, assigned_user_count: 0 }));
  }

  async updateRole(actorId: string, roleId: string, input: { name?: string; level?: number; color?: string | null; permissions?: Record<string, boolean> }): Promise<ServiceResult<AdminRole>> {
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const existing = (await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Role not found");
    if (existing.isBuiltin && input.level !== undefined && input.level !== existing.level) return err("CONFLICT", "Built-in role level is fixed");
    if (!existing.isBuiltin && input.level !== undefined && input.level > 2) return err("VALIDATION_ERROR", "Custom role level must be 1 or 2");
    const roleUpdatePayload: { name?: string; level?: number; color?: string | null; updatedAt: string } = { updatedAt: this.now().toISOString() };
    if (input.name !== undefined) roleUpdatePayload.name = input.name.trim();
    if (input.level !== undefined) roleUpdatePayload.level = input.level;
    if (input.color !== undefined) roleUpdatePayload.color = input.color ?? null;
    if (Object.keys(roleUpdatePayload).length > 1) await this.deps.db.update(roles).set(roleUpdatePayload).where(eq(roles.id, roleId));
    if (roleId === "admin") await replaceRolePermissions(this.deps.rawDb, roleId, fullAdminPermissionRecord());
    else if (input.permissions) {
      const currentPermissionRows = await this.deps.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      const nextPermissionRecord = parsePermissionRecord(roleId, currentPermissionRows);
      for (const perm of PERMISSIONS) if (Object.prototype.hasOwnProperty.call(input.permissions, perm)) nextPermissionRecord[perm] = Boolean(input.permissions[perm]);
      await replaceRolePermissions(this.deps.rawDb, roleId, nextPermissionRecord);
    }
    const [updatedRole] = await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin, createdAt: roles.createdAt, updatedAt: roles.updatedAt }).from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!updatedRole) return err("SERVER_ERROR", "Failed to load updated role");
    const permissionRows = await this.deps.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    const assignedCountRow = (await this.deps.db.select({ count: sql<number>`count(*)` }).from(users).where(and(eq(users.role, roleId), isNull(users.deletedAt))).limit(1))[0];
    const assignedCount = Number(assignedCountRow?.count ?? 0);
    await this.deps.writeAuditLog({ entityType: "role", action: "update", actorId, entityId: roleId, detailText: JSON.stringify({ fields: input, assigned_user_count: assignedCount }) });
    return ok(adminRoleSchema.parse({ id: updatedRole.id, name: updatedRole.name, level: updatedRole.level, color: updatedRole.color, is_builtin: updatedRole.isBuiltin, created_at: updatedRole.createdAt, updated_at: updatedRole.updatedAt, permissions: parsePermissionRecord(roleId, permissionRows), assigned_user_count: assignedCount }));
  }

  async deleteRole(actorId: string, roleId: string): Promise<ServiceResult<void>> {
    await ensureBuiltinRolesAndPermissions(this.deps.db);
    const existing = (await this.deps.db.select({ id: roles.id, isBuiltin: roles.isBuiltin }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Role not found");
    if (existing.isBuiltin) return err("CONFLICT", "Built-in roles cannot be deleted");
    const assignedCountRow = (await this.deps.db.select({ count: sql<number>`count(*)` }).from(users).where(and(eq(users.role, roleId), isNull(users.deletedAt))).limit(1))[0];
    const assignedCount = Number(assignedCountRow?.count ?? 0);
    if (assignedCount > 0) return err("CONFLICT", "Role is assigned to users", { assigned_user_count: assignedCount });
    await this.deps.db.delete(roles).where(eq(roles.id, roleId));
    await this.deps.writeAuditLog({ entityType: "role", action: "delete", actorId, entityId: roleId });
    return ok(undefined);
  }

  async getStatus(): Promise<ServiceResult<{ db: string; r2: string; ws: string; crons: string; db_checks: Record<string, string> }>> {
    let dbStatus = "ok";
    let r2Status = "ok";
    const dbChecks: Record<string, string> = {};
    const requiredTables = ["users", "member_profiles", "roles", "role_permissions"] as const;
    try {
      for (const table of requiredTables) {
        const row = await this.deps.rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1").bind(table).first<{ name: string }>();
        dbChecks[table] = row?.name ? "ok" : "missing";
      }
      if (requiredTables.some((t) => dbChecks[t] !== "ok")) dbStatus = "error";
    } catch {
      dbStatus = "error";
      for (const table of requiredTables) dbChecks[table] = "error";
    }
    try {
      await this.deps.media.head(ANALYTICS_SETTINGS_KEY);
    } catch {
      r2Status = "error";
    }
    return ok({ db: dbStatus, r2: r2Status, ws: this.deps.ws ? "ok" : "missing", crons: "ok", db_checks: dbChecks });
  }

  async getAnalyticsSettings(): Promise<ServiceResult<AnalyticsSettings>> {
    const object = await this.deps.media.get(ANALYTICS_SETTINGS_KEY);
    if (!object) return ok(defaultAnalyticsSettings());
    try {
      const parsed = JSON.parse(await object.text()) as AnalyticsSettings;
      return ok({ ...defaultAnalyticsSettings(), ...parsed });
    } catch {
      return ok(defaultAnalyticsSettings());
    }
  }

  async updateAnalyticsSettings(actorId: string, input: Record<string, unknown>): Promise<ServiceResult<AnalyticsSettings>> {
    const settings = normalizeAnalyticsWeights(parseAnalyticsInput(input));
    await this.deps.media.put(ANALYTICS_SETTINGS_KEY, JSON.stringify(settings), { httpMetadata: { contentType: "application/json" } });
    await this.deps.writeAuditLog({ entityType: "analytics_settings", action: "update", actorId, entityId: "default" });
    return ok(settings);
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }
}
