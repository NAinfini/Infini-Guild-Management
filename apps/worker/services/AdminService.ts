import {
  HIGH_RISK_PERMISSIONS,
  PERMISSIONS,
  BUILTIN_ROLES,
  adminRoleSchema,
  inviteLinkSchema,
  DEFAULT_SITE_ANALYTICS_SETTINGS,
  type Permission,
  type AdminRole,
} from "@guild/shared";
import { SYSTEM_TEST_USERNAME_PREFIX, isReservedSystemTestUsername } from "@guild/shared/config/system-test";
import type { AuditAction } from "@guild/shared/constants/audit";
import type { WriteAuditLogInput as AuditLogInput } from "./audit";
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { inviteLinks, rolePermissions, roles, sessions, userAuthPassword, users } from "../db/schema";
import { ok, err, type ServiceResult, type ServiceErr } from "./result";
import { escapeLikePattern, usernameEquals } from "./helpers";
import { clearLoginFailures } from "./login-lockout";
import type { MediaLike } from "./AdminAuditService";
import { SiteConfigService } from "./SiteConfigService";
import { logger } from "../utils/logger";

export type { MediaLike } from "./AdminAuditService";

type DrizzleDb = ReturnType<typeof drizzle>;

export type AnalyticsSettings = {
  reference_duration_minutes: number;
  modifier_weights: Record<string, number>;
};

export type AdminStatusReport = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
  /** 每张必需表一条：`ok`、`missing`，或 `error: <真实原因>`。 */
  db_checks: Record<string, string>;
  /** R2 探针的真实失败原因；正常时为 null。 */
  r2_reason: string | null;
};

// Keep this list focused on tables whose absence disables authentication or an
// entire production feature. Direct probes are intentional: D1 does not allow
// the sqlite_master query that would otherwise enumerate the schema.
const STATUS_REQUIRED_TABLES = [
  "users",
  "user_auth_password",
  "sessions",
  "login_failures",
  "member_profiles",
  "member_profile_classes",
  "member_profile_images",
  "roles",
  "role_permissions",
  "site_config",
  "class_catalog",
  "class_tags",
  "class_tag_members",
  "events",
  "event_attachments",
  "event_class_quotas",
  "recurring_templates",
  "recurring_template_attachments",
  "recurring_template_class_quotas",
  "media_references",
  "media_reference_backfills",
  "media_upload_leases",
  "system_test_runs",
  "system_test_artifacts",
  "storage_items",
  "storage_transactions",
] as const;

/*
 * 逐表探活。
 * 原先这里读 sqlite_master 拿表清单，但 D1 不允许读它（SQLITE_AUTH，见 index.ts
 * /api/dev/table-counts 处的同一条说明）——于是那个 catch 每次都命中，线上永远
 * 报 db: error、五张表全是 "error"，且没有任何原因被记下来：一个把真故障和
 * 「探针本身用错了 API」压成同一句话的兜底。改成直接查表本身，D1 与本地
 * miniflare 都支持；表不存在与真故障分开报，真故障连原因一起抬出来。
 * 表名来自本模块的常量数组，不是请求输入，拼接不引入注入面。
 */
async function probeTable(rawDb: D1Database, table: string): Promise<string> {
  try {
    await rawDb.prepare(`SELECT 1 FROM "${table}" LIMIT 1`).first();
    return "ok";
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (/no such table/i.test(reason)) {
      logger.error("Admin status: required table is missing", { table });
      return "missing";
    }
    logger.error("Admin status: table probe failed", { table, reason });
    return `error: ${reason}`;
  }
}

export type InviteVisibility = "active" | "expired" | "revoked";

type ListInviteLinksOptions = {
  cursor?: string;
  limit: number;
  visibility: InviteVisibility;
  search?: string;
  searchCodes: boolean;
};

type InviteCursor = {
  created_at: string;
  id: string;
};

const INVITE_CURSOR_MAX_LENGTH = 512;

function decodeInviteCursor(value: string): InviteCursor | null {
  if (
    value.length === 0
    || value.length > INVITE_CURSOR_MAX_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(value)
    || value.length % 4 === 1
  ) {
    return null;
  }
  try {
    const base64 = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const cursor = parsed as Record<string, unknown>;
    if (
      Object.keys(cursor).length !== 2
      || typeof cursor.created_at !== "string"
      || typeof cursor.id !== "string"
      || cursor.created_at.length === 0
      || cursor.created_at.length > 64
      || cursor.id.length === 0
      || cursor.id.length > 128
    ) {
      return null;
    }
    const timestamp = Date.parse(cursor.created_at);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== cursor.created_at) {
      return null;
    }
    return { created_at: cursor.created_at, id: cursor.id };
  } catch {
    return null;
  }
}

function encodeInviteCursor(cursor: InviteCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

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
  return DEFAULT_SITE_ANALYTICS_SETTINGS;
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
  envSiteName: string;
  envSiteLogoUrl: string;
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

  async listInviteLinks(
    options: ListInviteLinksOptions,
  ): Promise<ServiceResult<{ data: unknown[]; next_cursor: string | null; total: number }>> {
    const nowIso = this.now().toISOString();
    const cursor = options.cursor ? decodeInviteCursor(options.cursor) : undefined;
    if (options.cursor && !cursor) return err("VALIDATION_ERROR", "Invalid invite cursor");
    const baseFilters: SQL<unknown>[] = [];

    if (options.visibility === "revoked") {
      baseFilters.push(isNotNull(inviteLinks.revokedAt));
    } else if (options.visibility === "expired") {
      baseFilters.push(
        isNull(inviteLinks.revokedAt),
        or(
          and(isNotNull(inviteLinks.expiresAt), lte(inviteLinks.expiresAt, nowIso)),
          gte(inviteLinks.usedCount, inviteLinks.maxUses),
        )!,
      );
    } else {
      baseFilters.push(
        isNull(inviteLinks.revokedAt),
        or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, nowIso))!,
        lt(inviteLinks.usedCount, inviteLinks.maxUses),
      );
    }

    if (options.search) {
      const pattern = `%${escapeLikePattern(options.search.toLowerCase())}%`;
      const searchFilters: SQL<unknown>[] = [
        sql`lower(${inviteLinks.createdAt}) LIKE ${pattern} ESCAPE '\\'`,
        sql`lower(coalesce(${inviteLinks.expiresAt}, '')) LIKE ${pattern} ESCAPE '\\'`,
      ];
      if (options.searchCodes) {
        searchFilters.unshift(sql`lower(${inviteLinks.code}) LIKE ${pattern} ESCAPE '\\'`);
      }
      baseFilters.push(or(...searchFilters)!);
    }

    const baseWhereClause = and(...baseFilters);
    const listWhereClause = cursor
      ? and(
          baseWhereClause,
          or(
            lt(inviteLinks.createdAt, cursor.created_at),
            and(
              eq(inviteLinks.createdAt, cursor.created_at),
              lt(inviteLinks.id, cursor.id),
            ),
          ),
        )
      : baseWhereClause;
    const rows = await this.deps.db
      .select({
        id: inviteLinks.id,
        code: inviteLinks.code,
        createdBy: inviteLinks.createdBy,
        maxUses: inviteLinks.maxUses,
        usedCount: inviteLinks.usedCount,
        expiresAt: inviteLinks.expiresAt,
        createdAt: inviteLinks.createdAt,
        revokedAt: inviteLinks.revokedAt,
      })
      .from(inviteLinks)
      .where(listWhereClause)
      .orderBy(desc(inviteLinks.createdAt), desc(inviteLinks.id))
      .limit(options.limit + 1);
    const countRows = await this.deps.db
      .select({ total: sql<number>`count(*)` })
      .from(inviteLinks)
      .where(baseWhereClause);
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    const lastRow = pageRows.at(-1);

    return ok({
      data: pageRows.map((r) => inviteLinkSchema.parse({
        id: r.id,
        code: r.code,
        created_by: r.createdBy,
        max_uses: r.maxUses,
        used_count: r.usedCount,
        expires_at: r.expiresAt,
        created_at: r.createdAt,
        revoked_at: r.revokedAt,
      })),
      next_cursor: hasMore && lastRow
        ? encodeInviteCursor({ created_at: lastRow.createdAt, id: lastRow.id })
        : null,
      total: Number(countRows[0]?.total ?? 0),
    });
  }

  async getInviteLinkStats(): Promise<ServiceResult<{ total: number; active: number; revoked: number; expired: number }>> {
    const nowIso = this.now().toISOString();
    const rows = await this.deps.db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`coalesce(sum(case when ${inviteLinks.revokedAt} is null and (${inviteLinks.expiresAt} is null or ${inviteLinks.expiresAt} > ${nowIso}) and ${inviteLinks.usedCount} < ${inviteLinks.maxUses} then 1 else 0 end), 0)`,
        revoked: sql<number>`coalesce(sum(case when ${inviteLinks.revokedAt} is not null then 1 else 0 end), 0)`,
        expired: sql<number>`coalesce(sum(case when ${inviteLinks.revokedAt} is null and ((${inviteLinks.expiresAt} is not null and ${inviteLinks.expiresAt} <= ${nowIso}) or ${inviteLinks.usedCount} >= ${inviteLinks.maxUses}) then 1 else 0 end), 0)`,
      })
      .from(inviteLinks);
    const stats = rows[0];

    return ok({
      total: Number(stats?.total ?? 0),
      active: Number(stats?.active ?? 0),
      revoked: Number(stats?.revoked ?? 0),
      expired: Number(stats?.expired ?? 0),
    });
  }

  async createInviteLink(actorId: string, maxUses: number, expiresAt: string | null): Promise<ServiceResult<unknown>> {
    const inviteId = this.deps.generateId();
    const code = this.deps.generateInviteCode();
    await this.deps.db.insert(inviteLinks).values({ id: inviteId, code, createdBy: actorId, maxUses, usedCount: 0, expiresAt, revokedAt: null });
    const created = (await this.deps.db.select({ id: inviteLinks.id, code: inviteLinks.code, createdBy: inviteLinks.createdBy, maxUses: inviteLinks.maxUses, usedCount: inviteLinks.usedCount, expiresAt: inviteLinks.expiresAt, createdAt: inviteLinks.createdAt, revokedAt: inviteLinks.revokedAt }).from(inviteLinks).where(eq(inviteLinks.id, inviteId)).limit(1))[0];
    if (!created) return err("SERVER_ERROR", "Failed to create invite link");
    await this.deps.writeAuditLog({ entityType: "invite_link", action: "create", actorId, entityId: inviteId, diffTitle: inviteId, detailText: JSON.stringify({ max_uses: maxUses, expires_at: expiresAt }) });
    return ok(inviteLinkSchema.parse({ id: created.id, code: created.code, created_by: created.createdBy, max_uses: created.maxUses, used_count: created.usedCount, expires_at: created.expiresAt, created_at: created.createdAt, revoked_at: created.revokedAt }));
  }

  async revokeInviteLink(actorId: string, inviteId: string): Promise<ServiceResult<void>> {
    const existing = (await this.deps.db.select({ id: inviteLinks.id, revokedAt: inviteLinks.revokedAt }).from(inviteLinks).where(eq(inviteLinks.id, inviteId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Invite link not found");
    if (existing.revokedAt !== null) return err("CONFLICT", "Invite link already revoked");
    await this.deps.db.update(inviteLinks).set({ revokedAt: this.now().toISOString() }).where(eq(inviteLinks.id, inviteId));
    await this.deps.writeAuditLog({ entityType: "invite_link", action: "revoke", actorId, entityId: inviteId, diffTitle: inviteId });
    return ok(undefined);
  }

  async deleteInviteLink(actorId: string, inviteId: string): Promise<ServiceResult<void>> {
    const existing = (await this.deps.db.select({ id: inviteLinks.id }).from(inviteLinks).where(eq(inviteLinks.id, inviteId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Invite link not found");
    await this.deps.db.delete(inviteLinks).where(eq(inviteLinks.id, inviteId));
    await this.deps.writeAuditLog({ entityType: "invite_link", action: "delete", actorId, entityId: inviteId, diffTitle: inviteId });
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
    if (isReservedSystemTestUsername(username)) {
      return err("VALIDATION_ERROR", `Usernames beginning with "${SYSTEM_TEST_USERNAME_PREFIX}" are reserved`);
    }

    const existing = (await this.deps.db.select({ id: users.id, deletedAt: users.deletedAt }).from(users).where(usernameEquals(username)).limit(1))[0];
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
        this.deps.rawDb.prepare("INSERT INTO member_profiles (id, user_id, power, video_urls) VALUES (?1, ?2, 0, '[]')").bind(profileId, userId),
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

  /**
   * Clears the progressive login lockout for a user. The escape hatch for the
   * one unavoidable downside of account-level lockout: anyone who knows a
   * username can deliberately lock it out. Same permission and same level
   * check as a password reset — clearing a lock is strictly weaker than
   * changing the password, so it needs no separate permission.
   */
  async resetLoginLock(actorId: string, targetUserId: string): Promise<ServiceResult<{ ok: true }>> {
    const actorRole = await this.getActorRoleLevel(actorId);
    if (!actorRole) return err("FORBIDDEN", "Could not resolve actor role");
    const target = (await this.deps.db.select({ id: users.id, deletedAt: users.deletedAt, username: users.username, role: users.role }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!target || target.deletedAt !== null) return err("NOT_FOUND", "User not found");
    const targetRoleLevel = (await this.deps.db.select({ level: roles.level }).from(roles).where(eq(roles.id, target.role)).limit(1))[0];
    if (targetRoleLevel && targetRoleLevel.level >= actorRole.level) return err("FORBIDDEN", "Cannot clear the login lock for a user at or above your own level");
    await clearLoginFailures(this.deps.db, target.username);
    await this.deps.writeAuditLogDurable({ entityType: "user_auth", action: "reset_login_lock", actorId, entityId: targetUserId, diffTitle: target.username });
    return ok({ ok: true });
  }

  async listRoles(): Promise<ServiceResult<AdminRole[]>> {
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

    const permissionRecord = emptyPermissionRecord();
    for (const perm of PERMISSIONS) permissionRecord[perm] = Boolean(input.permissions?.[perm]);
    if (actorRole.roleId !== "admin") permissionRecord["admin.roles.manage"] = false;
    // Validated before the INSERT so a rejected request cannot leave a role row
    // behind with no permissions attached.
    const escalated = await this.findEscalatedGrants(actorRole.roleId, permissionRecord);
    if (escalated.length > 0) return err("FORBIDDEN", `Cannot grant permissions you do not hold: ${escalated.join(", ")}`);

    await this.deps.db.insert(roles).values({ id: roleId, name: input.name.trim(), level: input.level, color: input.color ?? null, isBuiltin: false });
    await replaceRolePermissions(this.deps.rawDb, roleId, permissionRecord);
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
    // Permissions are resolved and validated before anything is written, so a
    // rejected escalation attempt cannot leave the name/level/colour applied.
    let nextPermissionRecord: Record<Permission, boolean> | null = null;
    if (input.permissions) {
      const currentPermissionRows = await this.deps.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      const currentlyGranted = parsePermissionRecord(currentPermissionRows);
      nextPermissionRecord = parsePermissionRecord(currentPermissionRows);
      for (const perm of PERMISSIONS) if (Object.prototype.hasOwnProperty.call(input.permissions, perm)) nextPermissionRecord[perm] = Boolean(input.permissions[perm]);
      if (actorRole.roleId !== "admin") nextPermissionRecord["admin.roles.manage"] = false;
      // Only newly added grants are checked: permissions the role already had are
      // left alone so a lower-level editor is not forced to strip them.
      const addedGrants = emptyPermissionRecord();
      for (const perm of PERMISSIONS) addedGrants[perm] = nextPermissionRecord[perm] && !currentlyGranted[perm];
      const escalated = await this.findEscalatedGrants(actorRole.roleId, addedGrants);
      if (escalated.length > 0) return err("FORBIDDEN", `Cannot grant permissions you do not hold: ${escalated.join(", ")}`);
    }

    const roleUpdatePayload: { name?: string; level?: number; color?: string | null; updatedAt: string } = { updatedAt: this.now().toISOString() };
    if (input.name !== undefined) roleUpdatePayload.name = input.name.trim();
    if (input.level !== undefined) roleUpdatePayload.level = input.level;
    if (input.color !== undefined) roleUpdatePayload.color = input.color ?? null;
    if (Object.keys(roleUpdatePayload).length > 1) await this.deps.db.update(roles).set(roleUpdatePayload).where(eq(roles.id, roleId));
    if (nextPermissionRecord) {
      await replaceRolePermissions(this.deps.rawDb, roleId, nextPermissionRecord);
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
    await this.deps.writeAuditLogDurable({ entityType: "role", action: "delete", actorId, entityId: roleId, diffTitle: existing.name });
    return ok(undefined);
  }

  async getStatus(): Promise<ServiceResult<AdminStatusReport>> {
    let r2Status = "ok";
    let r2Reason: string | null = null;
    const dbChecks: Record<string, string> = {};

    const dbCheck = (async () => {
      const probes = await Promise.all(
        STATUS_REQUIRED_TABLES.map(async (table) => [table, await probeTable(this.deps.rawDb, table)] as const),
      );
      for (const [table, verdict] of probes) dbChecks[table] = verdict;
    })();

    const r2Check = (async () => {
      try {
        // head() 对不存在的对象返回 null，不抛；抛出来的只会是绑定层/网络层的真故障。
        await this.deps.media.head("__healthcheck__");
      } catch (error) {
        r2Status = "error";
        r2Reason = error instanceof Error ? error.message : String(error);
        logger.error("Admin status: R2 health probe failed", { reason: r2Reason });
      }
    })();

    await Promise.all([dbCheck, r2Check]);
    const dbStatus = STATUS_REQUIRED_TABLES.every((t) => dbChecks[t] === "ok") ? "ok" : "error";
    return ok({
      db: dbStatus,
      r2: r2Status,
      // A binding proves configuration, not that a Durable Object request or
      // scheduled invocation has recently completed. Avoid reporting an
      // unverified subsystem as healthy.
      ws: this.deps.ws ? "configured" : "missing",
      crons: "configured",
      db_checks: dbChecks,
      r2_reason: r2Reason,
    });
  }

  async getAnalyticsSettings(): Promise<ServiceResult<AnalyticsSettings>> {
    return this.getSiteConfigService().getAnalyticsSettings();
  }

  async updateAnalyticsSettings(actorId: string, input: Record<string, unknown>): Promise<ServiceResult<AnalyticsSettings>> {
    return this.getSiteConfigService().updateAnalyticsSettings(actorId, input);
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

  private async getGrantedPermissions(roleId: string): Promise<ReadonlySet<string>> {
    const rows = await this.deps.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    return new Set(rows.filter((r) => r.granted).map((r) => r.permission));
  }

  /**
   * A granter may never hand out a permission it does not hold itself.
   * `admin.roles.manage` on its own would otherwise be enough to mint a
   * lower-level role carrying capabilities the granter lacks and assign a
   * second account to it. Returns the offending permissions, empty when fine.
   * `admin` is exempt — it is the root role by definition.
   */
  private async findEscalatedGrants(
    actorRoleId: string,
    requested: Record<Permission, boolean>,
  ): Promise<Permission[]> {
    if (actorRoleId === "admin") return [];
    const held = await this.getGrantedPermissions(actorRoleId);
    return PERMISSIONS.filter((perm) => requested[perm] && !held.has(perm));
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private getSiteConfigService() {
    return new SiteConfigService(this.deps.db, {
      rawDb: this.deps.rawDb,
      writeAuditLog: this.deps.writeAuditLog,
      now: this.deps.now,
      envSiteName: this.deps.envSiteName,
      envSiteLogoUrl: this.deps.envSiteLogoUrl,
    });
  }
}
