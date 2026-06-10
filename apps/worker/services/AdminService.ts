import {
  HIGH_RISK_PERMISSIONS,
  PERMISSIONS,
  BUILTIN_ROLES,
  adminRoleSchema,
  inviteLinkSchema,
  inviteLinkStatsSchema,
  type Permission,
  type AdminRole,
} from "@guild/shared";
import type { AuditAction } from "@guild/shared/constants/audit";
import type { WriteAuditLogInput as AuditLogInput } from "./audit";
import { activeGame } from "@guild/shared/games";
import { and, desc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { inviteLinks, rolePermissions, roles, sessions, userAuthPassword, users } from "../db/schema";
import { ok, err, type ServiceResult, type ServiceErr } from "./result";
import type { MediaLike } from "./AdminAuditService";
import { clearPermissionCache } from "./auth";

export type { MediaLike } from "./AdminAuditService";

type DrizzleDb = ReturnType<typeof drizzle>;

export type AnalyticsSettings = {
  reference_duration_minutes: number;
  modifier_weights: Record<string, number>;
};

const ANALYTICS_SETTINGS_KEY = "config/analytics-settings.json";

function emptyPermissionRecord(): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, false])) as Record<Permission, boolean>;
}

function parsePermissionRecord(
  permissionRows: Array<{ permission: string; granted: boolean }>,
): Record<Permission, boolean> {
  const record = emptyPermissionRecord();
  for (const row of permissionRows) {
    const perm = row.permission as Permission;
    if (!PERMISSIONS.includes(perm)) continue;
    record[perm] = row.granted;
  }
  return record;
}

async function replaceRolePermissions(
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

export function defaultAnalyticsSettings(): AnalyticsSettings {
  return {
    reference_duration_minutes: 30,
    modifier_weights: { ...activeGame.war.modifierWeights },
  };
}

function normalizeAnalyticsWeights(settings: AnalyticsSettings): AnalyticsSettings {
  const weights = settings.modifier_weights;
  const weightSum = Object.values(weights).reduce((s, v) => s + v, 0);
  if (weightSum <= 0) return settings;
  const normalized: Record<string, number> = {};
  for (const [key, val] of Object.entries(weights)) {
    normalized[key] = Number((val / weightSum).toFixed(4));
  }
  return { ...settings, modifier_weights: normalized };
}

function parseAnalyticsInput(record: Record<string, unknown>): AnalyticsSettings {
  const defaults = defaultAnalyticsSettings();
  const rawWeights = record.modifier_weights;
  const modifier_weights: Record<string, number> = { ...defaults.modifier_weights };
  if (typeof rawWeights === "object" && rawWeights !== null) {
    for (const [key, val] of Object.entries(rawWeights as Record<string, unknown>)) {
      if (typeof val === "number") modifier_weights[key] = val;
    }
  }
  return {
    reference_duration_minutes:
      typeof record.reference_duration_minutes === "number" && record.reference_duration_minutes > 0
        ? record.reference_duration_minutes : defaults.reference_duration_minutes,
    modifier_weights,
  };
}

type AdminServiceDeps = {
  db: DrizzleDb;
  media: MediaLike;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  writeAuditLogDurable: (input: AuditLogInput) => Promise<void>;
  createPasswordHash: (password: string) => Promise<{ passwordHash: string; salt: string }>;
  generateId: () => string;
  generateInviteCode: () => string;
  generateTemporaryPassword: () => string;
  rawDb: D1Database;
  ws?: unknown;
  now?: () => Date;
};

function buildRoleDiff(
  existing: { name: string; level: number; color: string | null },
  input: { name?: string; level?: number; color?: string | null; permissions?: Record<string, boolean> },
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (input.name !== undefined && input.name.trim() !== existing.name) diff.name = { from: existing.name, to: input.name.trim() };
  if (input.level !== undefined && input.level !== existing.level) diff.level = { from: existing.level, to: input.level };
  if (input.color !== undefined && (input.color ?? null) !== existing.color) diff.color = { from: existing.color, to: input.color ?? null };
  if (input.permissions !== undefined) diff.permissions = { from: "changed", to: "changed" };
  return Object.keys(diff).length > 0 ? diff : null;
}

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

    const newRole = (await this.deps.db.select({ id: roles.id, level: roles.level }).from(roles).where(eq(roles.id, newRoleId)).limit(1))[0];
    if (!newRole) return err("NOT_FOUND", "Role not found");
    const guard = await this.assertBatchActionAllowed(actorId, targetIds);
    if (!guard.ok) return guard.error;
    const { actorRole, existingUsers } = guard;
    if (newRole.level >= actorRole.level) return err("FORBIDDEN", "Cannot assign a role at or above your own level");
    if (actorRole.roleId !== "admin" && await this.roleHasHighRiskPermissions(newRoleId)) return err("FORBIDDEN", "Only admin can assign roles containing high-risk permissions");
    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map((r) => r.id);
      await this.deps.db.update(users).set({ role: newRoleId, updatedAt: this.now().toISOString() }).where(inArray(users.id, existingIds));
      await this.deps.db.delete(sessions).where(inArray(sessions.userId, existingIds));
    }
    const usernames = existingUsers.map((r) => r.username);
    await this.deps.writeAuditLogDurable({ entityType: "user", action: "batch_role_update", actorId, entityId: "batch", diffTitle: usernames.join(", "), detailText: JSON.stringify({ user_ids: targetIds, usernames, new_role: newRoleId, count: existingUsers.length }) });
    return ok({ updated: existingUsers.length });
  }

  async batchDeactivate(actorId: string, userIds: string[]): Promise<ServiceResult<{ updated: number }>> {
    return this.executeBatchAction(actorId, userIds, {
      action: "batch_deactivate",
      guarded: true, clearSessions: true, durable: true,
      update: (ids, now) => this.deps.db.update(users).set({ isActive: false, updatedAt: now }).where(inArray(users.id, ids)),
    });
  }

  async batchReactivate(actorId: string, userIds: string[]): Promise<ServiceResult<{ updated: number }>> {
    return this.executeBatchAction(actorId, userIds, {
      action: "batch_reactivate",
      guarded: false, clearSessions: false, durable: false,
      update: (ids, now) => this.deps.db.update(users).set({ isActive: true, updatedAt: now }).where(inArray(users.id, ids)),
    });
  }

  async batchDelete(actorId: string, userIds: string[]): Promise<ServiceResult<{ updated: number }>> {
    return this.executeBatchAction(actorId, userIds, {
      action: "batch_delete",
      guarded: true, clearSessions: true, durable: true,
      update: (ids, now) => this.deps.db.update(users).set({ isActive: false, deletedAt: now, updatedAt: now }).where(inArray(users.id, ids)),
    });
  }

  private async executeBatchAction(
    actorId: string,
    userIds: string[],
    opts: {
      action: AuditAction;
      guarded: boolean;
      clearSessions: boolean;
      durable: boolean;
      update: (ids: string[], now: string) => Promise<unknown>;
    },
  ): Promise<ServiceResult<{ updated: number }>> {
    const targetIds = userIds.filter((id) => id !== actorId);
    if (targetIds.length === 0) return ok({ updated: 0 });

    let existingUsers: { id: string; username: string }[];
    if (opts.guarded) {
      const guard = await this.assertBatchActionAllowed(actorId, targetIds);
      if (!guard.ok) return guard.error;
      existingUsers = guard.existingUsers;
    } else {
      existingUsers = await this.deps.db.select({ id: users.id, username: users.username }).from(users).where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));
    }

    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map((r) => r.id);
      await opts.update(existingIds, this.now().toISOString());
      if (opts.clearSessions) {
        await this.deps.db.delete(sessions).where(inArray(sessions.userId, existingIds));
      }
    }

    const usernames = existingUsers.map((r) => r.username);
    const writeLog = opts.durable ? this.deps.writeAuditLogDurable : this.deps.writeAuditLog;
    await writeLog({ entityType: "user", action: opts.action, actorId, entityId: "batch", diffTitle: usernames.join(", "), detailText: JSON.stringify({ user_ids: targetIds, usernames, count: existingUsers.length }) });
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
    await this.deps.writeAuditLog({ entityType: "user", action: "admin_create_member", actorId, entityId: userId, diffTitle: username, detailText: JSON.stringify({ username }) });
    return ok({ user_id: userId, username, temporary_password: temporaryPassword });
  }

  async updateUserRole(actorId: string, targetUserId: string, newRoleId: string): Promise<ServiceResult<void>> {
    if (targetUserId === actorId) return err("CONFLICT", "You cannot change your own role");
    if (newRoleId === "admin") return err("FORBIDDEN", "Cannot assign builtin admin role via API");

    const actorRole = await this.getActorRoleLevel(actorId);
    if (!actorRole) return err("FORBIDDEN", "Could not resolve actor role");
    const newRole = (await this.deps.db.select({ id: roles.id, level: roles.level }).from(roles).where(eq(roles.id, newRoleId)).limit(1))[0];
    if (!newRole) return err("NOT_FOUND", "Role not found");
    if (newRole.level >= actorRole.level) return err("FORBIDDEN", "Cannot assign a role at or above your own level");
    if (actorRole.roleId !== "admin" && await this.roleHasHighRiskPermissions(newRoleId)) return err("FORBIDDEN", "Only admin can assign roles containing high-risk permissions");
    const target = (await this.deps.db.select({ id: users.id, role: users.role, deletedAt: users.deletedAt, username: users.username }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    const targetCurrentRole = (await this.deps.db.select({ level: roles.level }).from(roles).where(eq(roles.id, target.role)).limit(1))[0];
    if (targetCurrentRole && targetCurrentRole.level >= actorRole.level) return err("FORBIDDEN", "Cannot change the role of a user at or above your own level");
    await this.deps.db.update(users).set({ role: newRoleId, updatedAt: this.now().toISOString() }).where(eq(users.id, targetUserId));
    await this.deps.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    await this.deps.writeAuditLogDurable({ entityType: "user", action: "update_role", actorId, entityId: targetUserId, diffTitle: target.username, detailText: JSON.stringify({ role: { from: target.role, to: newRoleId } }) });
    return ok(undefined);
  }

  async deactivateUser(actorId: string, targetUserId: string, reason?: string): Promise<ServiceResult<void>> {
    if (targetUserId === actorId) return err("CONFLICT", "You cannot deactivate yourself");
    const actorRole = await this.getActorRoleLevel(actorId);
    if (!actorRole) return err("FORBIDDEN", "Could not resolve actor role");
    const target = (await this.deps.db.select({ id: users.id, isActive: users.isActive, deletedAt: users.deletedAt, username: users.username, role: users.role }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    const targetRoleLevel = (await this.deps.db.select({ level: roles.level }).from(roles).where(eq(roles.id, target.role)).limit(1))[0];
    if (targetRoleLevel && targetRoleLevel.level >= actorRole.level) return err("FORBIDDEN", "Cannot deactivate a user at or above your own level");
    if (!target.isActive) return err("CONFLICT", "User already deactivated");
    const nowIso = this.now().toISOString();
    await this.deps.rawDb.batch([
      this.deps.rawDb.prepare("UPDATE users SET is_active = 0, updated_at = ?1 WHERE id = ?2").bind(nowIso, targetUserId),
      this.deps.rawDb.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(targetUserId),
    ]);
    await this.deps.writeAuditLogDurable({ entityType: "user", action: "deactivate", actorId, entityId: targetUserId, diffTitle: target.username, detailText: JSON.stringify({ reason: reason ?? null }) });
    return ok(undefined);
  }

  async reactivateUser(actorId: string, targetUserId: string, reason?: string): Promise<ServiceResult<void>> {
    const target = (await this.deps.db.select({ id: users.id, isActive: users.isActive, deletedAt: users.deletedAt, username: users.username }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    if (target.isActive) return err("CONFLICT", "User is already active");
    await this.deps.db.update(users).set({ isActive: true, updatedAt: this.now().toISOString() }).where(eq(users.id, targetUserId));
    await this.deps.writeAuditLog({ entityType: "user", action: "reactivate", actorId, entityId: targetUserId, diffTitle: target.username, detailText: JSON.stringify({ reason: reason ?? null }) });
    return ok(undefined);
  }

  async resetPassword(actorId: string, targetUserId: string, temporaryPasswordInput?: string): Promise<ServiceResult<{ temporary_password: string }>> {
    const temporaryPassword = temporaryPasswordInput ?? this.deps.generateTemporaryPassword();
    if (temporaryPassword.length < 8) return err("VALIDATION_ERROR", "temporary_password must be at least 8 characters");
    const actorRole = await this.getActorRoleLevel(actorId);
    if (!actorRole) return err("FORBIDDEN", "Could not resolve actor role");
    const target = (await this.deps.db.select({ id: users.id, deletedAt: users.deletedAt, username: users.username, role: users.role }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    const targetRoleLevel = (await this.deps.db.select({ level: roles.level }).from(roles).where(eq(roles.id, target.role)).limit(1))[0];
    if (targetRoleLevel && targetRoleLevel.level >= actorRole.level) return err("FORBIDDEN", "Cannot reset password for a user at or above your own level");
    const passwordHash = await this.deps.createPasswordHash(temporaryPassword);
    await this.deps.db.update(userAuthPassword).set({ passwordHash: passwordHash.passwordHash, salt: passwordHash.salt, updatedAt: this.now().toISOString() }).where(eq(userAuthPassword.userId, targetUserId));
    await this.deps.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    await this.deps.writeAuditLogDurable({ entityType: "user_auth", action: "reset_password", actorId, entityId: targetUserId, diffTitle: target.username });
    return ok({ temporary_password: temporaryPassword });
  }

  async listRoles(): Promise<ServiceResult<unknown[]>> {
    const roleRows = await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin, createdAt: roles.createdAt, updatedAt: roles.updatedAt }).from(roles).orderBy(desc(roles.level), roles.name);
    const roleIds = roleRows.map((r) => r.id);
    const permissionRows = roleIds.length > 0 ? await this.deps.db.select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds)) : [];
    const assignedRows = await this.deps.db.select({ roleId: users.role, count: sql<number>`count(*)` }).from(users).where(isNull(users.deletedAt)).groupBy(users.role);
    const assignedCountByRole = new Map<string, number>(assignedRows.map((r) => [r.roleId, Number(r.count ?? 0)]));
    return ok(roleRows.map((r) => adminRoleSchema.parse({ id: r.id, name: r.name, level: r.level, color: r.color, is_builtin: r.isBuiltin, created_at: r.createdAt, updated_at: r.updatedAt, permissions: parsePermissionRecord(permissionRows.filter((p) => p.roleId === r.id).map((p) => ({ permission: p.permission, granted: p.granted }))), assigned_user_count: assignedCountByRole.get(r.id) ?? 0 })));
  }

  async createRole(actorId: string, input: { id?: string; name: string; level: number; color?: string; permissions?: Record<string, boolean> }): Promise<ServiceResult<unknown>> {
    const roleId = (input.id?.trim() || `custom_${this.deps.generateId().toLowerCase()}`).toLowerCase();
    if ((BUILTIN_ROLES as readonly string[]).includes(roleId)) return err("CONFLICT", "Built-in role ids are reserved");
    const actorRole = await this.getActorRoleLevel(actorId);
    if (!actorRole) return err("FORBIDDEN", "Could not resolve actor role");
    if (input.level >= actorRole.level) return err("VALIDATION_ERROR", `Role level must be below your own (${actorRole.level})`);

    const existing = (await this.deps.db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (existing) return err("CONFLICT", "Role id already exists");
    await this.deps.db.insert(roles).values({ id: roleId, name: input.name.trim(), level: input.level, color: input.color ?? null, isBuiltin: false });
    const permissionRecord = emptyPermissionRecord();
    for (const perm of PERMISSIONS) permissionRecord[perm] = Boolean(input.permissions?.[perm]);
    if (actorRole.roleId !== "admin") permissionRecord["admin.roles.manage"] = false;
    await replaceRolePermissions(this.deps.rawDb, roleId, permissionRecord);
    clearPermissionCache(roleId);
    await this.deps.writeAuditLogDurable({ entityType: "role", action: "create", actorId, entityId: roleId, diffTitle: input.name.trim(), detailText: JSON.stringify({ name: input.name.trim(), level: input.level, color: input.color ?? null, permissions: permissionRecord }) });
    const created = (await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin, createdAt: roles.createdAt, updatedAt: roles.updatedAt }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (!created) return err("SERVER_ERROR", "Failed to create role");
    return ok(adminRoleSchema.parse({ id: created.id, name: created.name, level: created.level, color: created.color, is_builtin: created.isBuiltin, created_at: created.createdAt, updated_at: created.updatedAt, permissions: permissionRecord, assigned_user_count: 0 }));
  }

  async updateRole(actorId: string, roleId: string, input: { name?: string; level?: number; color?: string | null; permissions?: Record<string, boolean> }): Promise<ServiceResult<AdminRole>> {

    const existing = (await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Role not found");
    const actorRole = await this.getActorRoleLevel(actorId);
    if (!actorRole) return err("FORBIDDEN", "Could not resolve actor role");
    if (existing.level >= actorRole.level && !existing.isBuiltin) return err("FORBIDDEN", "Cannot edit a role at or above your own level");
    if (existing.isBuiltin) {
      if (input.name !== undefined) return err("CONFLICT", "Built-in role name is fixed");
      if (input.level !== undefined && input.level !== existing.level) return err("CONFLICT", "Built-in role level is fixed");
      if (input.permissions) return err("CONFLICT", "Built-in role permissions are fixed");
    }
    if (!existing.isBuiltin && input.level !== undefined) {
      if (input.level >= actorRole.level) return err("VALIDATION_ERROR", `Role level must be below your own (${actorRole.level})`);
    }
    const roleUpdatePayload: { name?: string; level?: number; color?: string | null; updatedAt: string } = { updatedAt: this.now().toISOString() };
    if (input.name !== undefined) roleUpdatePayload.name = input.name.trim();
    if (input.level !== undefined) roleUpdatePayload.level = input.level;
    if (input.color !== undefined) roleUpdatePayload.color = input.color ?? null;
    if (Object.keys(roleUpdatePayload).length > 1) await this.deps.db.update(roles).set(roleUpdatePayload).where(eq(roles.id, roleId));
    if (input.permissions) {
      const currentPermissionRows = await this.deps.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      const nextPermissionRecord = parsePermissionRecord(currentPermissionRows);
      for (const perm of PERMISSIONS) if (Object.prototype.hasOwnProperty.call(input.permissions, perm)) nextPermissionRecord[perm] = Boolean(input.permissions[perm]);
      if (actorRole.roleId !== "admin") nextPermissionRecord["admin.roles.manage"] = false;
      await replaceRolePermissions(this.deps.rawDb, roleId, nextPermissionRecord);
      clearPermissionCache(roleId);
    }
    const [updatedRole] = await this.deps.db.select({ id: roles.id, name: roles.name, level: roles.level, color: roles.color, isBuiltin: roles.isBuiltin, createdAt: roles.createdAt, updatedAt: roles.updatedAt }).from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!updatedRole) return err("SERVER_ERROR", "Failed to load updated role");
    const permissionRows = await this.deps.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    const assignedCountRow = (await this.deps.db.select({ count: sql<number>`count(*)` }).from(users).where(and(eq(users.role, roleId), isNull(users.deletedAt))).limit(1))[0];
    const assignedCount = Number(assignedCountRow?.count ?? 0);
    const roleDiff = buildRoleDiff(existing, input);
    await this.deps.writeAuditLogDurable({ entityType: "role", action: "update", actorId, entityId: roleId, diffTitle: updatedRole.name, detailText: roleDiff ? JSON.stringify(roleDiff) : null });
    return ok(adminRoleSchema.parse({ id: updatedRole.id, name: updatedRole.name, level: updatedRole.level, color: updatedRole.color, is_builtin: updatedRole.isBuiltin, created_at: updatedRole.createdAt, updated_at: updatedRole.updatedAt, permissions: parsePermissionRecord(permissionRows), assigned_user_count: assignedCount }));
  }

  async deleteRole(actorId: string, roleId: string): Promise<ServiceResult<void>> {

    const existing = (await this.deps.db.select({ id: roles.id, isBuiltin: roles.isBuiltin, name: roles.name, level: roles.level }).from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Role not found");
    if (existing.isBuiltin) return err("CONFLICT", "Built-in roles cannot be deleted");
    const actorRole = await this.getActorRoleLevel(actorId);
    if (!actorRole) return err("FORBIDDEN", "Could not resolve actor role");
    if (existing.level >= actorRole.level) return err("FORBIDDEN", "Cannot delete a role at or above your own level");
    const assignedCountRow = (await this.deps.db.select({ count: sql<number>`count(*)` }).from(users).where(and(eq(users.role, roleId), isNull(users.deletedAt))).limit(1))[0];
    const assignedCount = Number(assignedCountRow?.count ?? 0);
    if (assignedCount > 0) return err("CONFLICT", "Role is assigned to users", { assigned_user_count: assignedCount });
    await this.deps.db.delete(roles).where(eq(roles.id, roleId));
    clearPermissionCache(roleId);
    await this.deps.writeAuditLogDurable({ entityType: "role", action: "delete", actorId, entityId: roleId, diffTitle: existing.name });
    return ok(undefined);
  }

  async getStatus(): Promise<ServiceResult<{ db: string; r2: string; ws: string; crons: string; db_checks: Record<string, string> }>> {
    let dbStatus = "ok";
    let r2Status = "ok";
    const dbChecks: Record<string, string> = {};
    const requiredTables = ["users", "member_profiles", "roles", "role_permissions"] as const;

    const dbCheck = (async () => {
      try {
        const rows = await this.deps.rawDb
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'member_profiles', 'roles', 'role_permissions')")
          .all<{ name: string }>();
        const found = new Set(rows.results.map((r) => r.name));
        for (const table of requiredTables) dbChecks[table] = found.has(table) ? "ok" : "missing";
        if (requiredTables.some((t) => dbChecks[t] !== "ok")) dbStatus = "error";
      } catch {
        dbStatus = "error";
        for (const table of requiredTables) dbChecks[table] = "error";
      }
    })();

    const r2Check = (async () => {
      try {
        await this.deps.media.head(ANALYTICS_SETTINGS_KEY);
      } catch {
        r2Status = "error";
      }
    })();

    await Promise.all([dbCheck, r2Check]);
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
    const previous = await this.getAnalyticsSettings();
    const settings = normalizeAnalyticsWeights(parseAnalyticsInput(input));
    await this.deps.media.put(ANALYTICS_SETTINGS_KEY, JSON.stringify(settings), { httpMetadata: { contentType: "application/json" } });
    const oldSettings = previous.ok ? previous.data : null;
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (oldSettings) {
      for (const key of Object.keys(settings) as (keyof AnalyticsSettings)[]) {
        const oldVal = oldSettings[key];
        const newVal = settings[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) diff[key] = { from: oldVal, to: newVal };
      }
    }
    await this.deps.writeAuditLog({ entityType: "analytics_settings", action: "update", actorId, entityId: "default", diffTitle: "Analytics", detailText: Object.keys(diff).length > 0 ? JSON.stringify(diff) : null });
    return ok(settings);
  }

  private async assertBatchActionAllowed(
    actorId: string,
    targetIds: string[],
  ): Promise<
    | { ok: true; actorRole: { level: number; roleId: string }; existingUsers: { id: string; username: string; role: string }[] }
    | { ok: false; error: ServiceErr }
  > {
    const actorRole = await this.getActorRoleLevel(actorId);
    if (!actorRole) return { ok: false, error: err("FORBIDDEN", "Could not resolve actor role") };

    const existingUsers = await this.deps.db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));

    const userRoleIds = [...new Set(existingUsers.map((u) => u.role))];
    const userRoleLevels = userRoleIds.length > 0
      ? await this.deps.db.select({ id: roles.id, level: roles.level }).from(roles).where(inArray(roles.id, userRoleIds))
      : [];
    const roleLevelMap = new Map(userRoleLevels.map((r) => [r.id, r.level]));
    const protectedUsers = existingUsers.filter((u) => (roleLevelMap.get(u.role) ?? 0) >= actorRole.level);

    if (protectedUsers.length > 0) {
      return { ok: false, error: err("FORBIDDEN", "Cannot modify users at or above your own level") };
    }

    return { ok: true, actorRole, existingUsers };
  }

  private async getActorRoleLevel(actorId: string): Promise<{ roleId: string; level: number } | null> {
    const row = (await this.deps.db.select({ roleId: roles.id, level: roles.level }).from(roles).innerJoin(users, eq(users.role, roles.id)).where(eq(users.id, actorId)).limit(1))[0];
    return row ?? null;
  }

  private async roleHasHighRiskPermissions(roleId: string): Promise<boolean> {
    const rows = await this.deps.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    return rows.some((r) => r.granted && (HIGH_RISK_PERMISSIONS as readonly string[]).includes(r.permission));
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }
}
