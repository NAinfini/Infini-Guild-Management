import {
  AppError,
  type AuthenticatedActor,
  type DeferredTasks,
  type NotificationPublisher,
  type RequestContext,
} from "@guild/kernel";
import { PERMISSIONS, PERMISSION_ID, type Permission } from "@guild/shared/constants/roles";
import { isReservedSystemTestIdentityName } from "@guild/shared/config/system-test";
import { createAuditEvent } from "../audit/public.js";
import { assertRoleAssignable, assertTargetBelowActor, requirePermission } from "./authorization";
import {
  createOpaqueToken,
  createPasswordHash,
  digestToken,
  PASSWORD_HASH_ITERATIONS,
  requireSafePasswordIterations,
  verifyPassword,
  type InviteTokenCodec,
} from "./crypto";
import type {
  AuthStore,
  AccountProvisioningStore,
  GuardedAuthMutationResult,
  InviteCursor,
  InviteRecord,
  InviteStats,
  InviteVisibility,
  ManagedUserTarget,
  RoleRecord,
  LoginLockState,
} from "./auth-types";
import { assertPortableLikeSearch } from "../../portable-search.js";
import { projectLoginLock } from "./login-lock";

const MAX_MANAGED_USER_BATCH = 50;
const TEMPORARY_PASSWORD_TTL_MS = 15 * 60 * 1_000;

type InviteWithCode = InviteRecord & Readonly<{ code: string }>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function inviteStatus(invite: InviteRecord, now: string): "active" | "expired" | "fully_used" | "revoked" {
  if (invite.revokedAt !== null) return "revoked";
  if (invite.usedCount >= invite.maxUses) return "fully_used";
  if (invite.expiresAt !== null && invite.expiresAt <= now) return "expired";
  return "active";
}

function inviteSnapshot(invite: InviteRecord, now: string, includeStatus = true) {
  return [
    { field: "role_id" as const, value: {
      type: "reference" as const, value: { id: invite.roleId, label: invite.roleName },
    } },
    { field: "role_name" as const, value: { type: "text" as const, value: invite.roleName } },
    { field: "max_uses" as const, value: { type: "number" as const, value: invite.maxUses } },
    { field: "used_count" as const, value: { type: "number" as const, value: invite.usedCount } },
    { field: "expires_at" as const, value: invite.expiresAt === null
      ? { type: "null" as const, value: null }
      : { type: "datetime" as const, value: invite.expiresAt } },
    ...(includeStatus ? [{
      field: "status" as const,
      value: { type: "code" as const, value: inviteStatus(invite, now) },
    }] : []),
  ];
}

function requireExistingTargets(
  requestedIds: readonly string[],
  targets: readonly ManagedUserTarget[],
): readonly ManagedUserTarget[] {
  const found = new Set(targets.map((target) => target.id));
  const missing = requestedIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new AppError({
      code: "NOT_FOUND",
      status: 404,
      message: "One or more users were not found",
      details: { user_ids: missing },
    });
  }
  return targets;
}

function parseCursor(value: string | undefined): InviteCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/"))) as Record<string, unknown>;
    return typeof parsed.created_at === "string" && typeof parsed.id === "string"
      ? { createdAt: parsed.created_at, id: parsed.id }
      : null;
  } catch {
    throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Invalid invite cursor" });
  }
}

function encodeCursor(cursor: InviteCursor | null): string | null {
  if (!cursor) return null;
  return btoa(JSON.stringify({ created_at: cursor.createdAt, id: cursor.id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export type IdentityAdminServiceOptions = Readonly<{
  store: AuthStore;
  provisioning: AccountProvisioningStore;
  inviteTokens: InviteTokenCodec;
  passwordIterations?: number;
  generateId?: () => string;
  generateTemporaryPassword?: () => string;
  generateTemporaryLoginName?: () => string;
  notifications?: NotificationPublisher;
  deferred?: DeferredTasks;
}>;

export class IdentityAdminService {
  private readonly generateId: () => string;
  private readonly generateTemporaryPassword: () => string;
  private readonly generateTemporaryLoginName: () => string;
  private readonly passwordIterations: number;

  constructor(private readonly options: IdentityAdminServiceOptions) {
    this.passwordIterations = requireSafePasswordIterations(options.passwordIterations ?? PASSWORD_HASH_ITERATIONS);
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.generateTemporaryPassword = options.generateTemporaryPassword ?? (() => createOpaqueToken(18));
    this.generateTemporaryLoginName = options.generateTemporaryLoginName
      ?? (() => `recovery_${createOpaqueToken(12).replaceAll("-", "_")}`);
  }

  async listInvites(context: RequestContext, input: Readonly<{
    visibility: InviteVisibility;
    limit: number;
    cursor?: string;
    search?: string;
  }>): Promise<Readonly<{ data: readonly InviteWithCode[]; nextCursor: string | null; total: number }>> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_INVITE_VIEW);
    const suppliedSearch = input.search?.trim() ?? "";
    const exactCode = suppliedSearch ? this.options.inviteTokens.normalize(suppliedSearch) : null;
    const exactTokenDigest = exactCode ? await digestToken(exactCode) : null;
    const search = exactTokenDigest ? "" : suppliedSearch.toLowerCase();
    if (!exactTokenDigest) assertPortableLikeSearch(search, "Invite search");
    const page = await this.options.store.listInvites({
      visibility: input.visibility,
      limit: input.limit,
      cursor: parseCursor(input.cursor),
      search,
      ...(exactTokenDigest ? { exactTokenDigest } : {}),
      now: context.now,
    });
    return {
      data: await Promise.all(page.data.map(async (invite) => ({
        ...invite,
        code: await this.options.inviteTokens.encode(invite.id),
      }))),
      nextCursor: encodeCursor(page.nextCursor),
      total: page.total,
    };
  }

  getInviteStats(context: RequestContext): Promise<InviteStats> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_INVITE_VIEW);
    return this.options.store.getInviteStats(context.now);
  }

  async createInvite(context: RequestContext, input: Readonly<{
    roleId: string;
    maxUses: number;
    expiresAt: string | null;
  }>): Promise<InviteWithCode> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_INVITE_MANAGE);
    const role = await this.requireAssignableRole(actor, input.roleId);
    const id = this.generateId();
    const code = await this.options.inviteTokens.encode(id);
    const invite = await this.options.store.createInvite({
      id,
      tokenDigest: await digestToken(code),
      createdBy: actor.userId,
      roleId: role.id,
      maxUses: input.maxUses,
      expiresAt: input.expiresAt,
      now: context.now,
    }, createAuditEvent(context, {
      subjectType: "invite_link",
      subjectId: id,
      subjectLabel: role.name,
      action: "create",
      context: [
        { field: "role_id", value: { type: "reference", value: { id: role.id, label: role.name } } },
        { field: "role_name", value: { type: "text", value: role.name } },
        { field: "max_uses", value: { type: "number", value: input.maxUses } },
        { field: "used_count", value: { type: "number", value: 0 } },
        { field: "expires_at", value: input.expiresAt === null
          ? { type: "null", value: null }
          : { type: "datetime", value: input.expiresAt } },
        { field: "status", value: { type: "code", value: "active" } },
      ],
    }));
    return { ...invite, code };
  }

  async revokeInvite(context: RequestContext, inviteId: string): Promise<{ ok: true }> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_INVITE_MANAGE);
    const invite = await this.options.store.findInvite(inviteId);
    if (!invite) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Invite link not found" });
    const changed = await this.options.store.revokeInvite(inviteId, context.now, createAuditEvent(context, {
      subjectType: "invite_link",
      subjectId: inviteId,
      subjectLabel: invite.roleName,
      action: "revoke",
      changes: [{
        field: "status",
        before: { type: "code", value: inviteStatus(invite, context.now) },
        after: { type: "code", value: "revoked" },
      }],
      context: inviteSnapshot(invite, context.now, false),
    }));
    if (!changed) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Invite link not found" });
    return { ok: true };
  }

  async deleteInvite(context: RequestContext, inviteId: string): Promise<{ ok: true }> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_INVITE_MANAGE);
    const invite = await this.options.store.findInvite(inviteId);
    if (!invite) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Invite link not found" });
    const changed = await this.options.store.deleteInvite(inviteId, createAuditEvent(context, {
      subjectType: "invite_link",
      subjectId: inviteId,
      subjectLabel: invite.roleName,
      action: "delete",
      context: inviteSnapshot(invite, context.now),
    }));
    if (!changed) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Invite link not found" });
    return { ok: true };
  }

  async createMember(context: RequestContext, input: Readonly<{
    loginName: string;
    displayName: string;
    roleId: string;
  }>): Promise<Readonly<{
    ok: true;
    userId: string;
    displayName: string;
    temporaryLoginName: string;
    temporaryPassword: string;
  }>> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_EDIT);
    if (isReservedSystemTestIdentityName(input.loginName) || isReservedSystemTestIdentityName(input.displayName)) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Name is reserved" });
    }
    const destinationRole = await this.requireAssignableRole(actor, input.roleId);
    const id = this.generateId();
    const temporaryPassword = this.generateTemporaryPassword();
    const outcome = await this.options.provisioning.createManagedUser({
      id,
      loginName: input.loginName.trim(),
      displayName: input.displayName.trim(),
      roleId: input.roleId,
      passwordHash: await createPasswordHash(temporaryPassword, this.passwordIterations),
      temporaryPasswordExpiresAt: new Date(Date.parse(context.now) + TEMPORARY_PASSWORD_TTL_MS).toISOString(),
      destinationRole,
      now: context.now,
    }, createAuditEvent(context, {
      subjectType: "user",
      subjectId: id,
      subjectLabel: input.displayName.trim(),
      action: "admin_create_member",
      context: [{ field: "role_id", value: {
        type: "reference", value: { id: destinationRole.id, label: destinationRole.name },
      } }],
    }));
    if (outcome === "login_name_taken" || outcome === "display_name_taken") {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Name already taken" });
    }
    if (outcome === "conflict") this.throwConcurrentAuthorizationChange();
    this.signalInboxChanged();
    return {
      ok: true,
      userId: id,
      displayName: input.displayName.trim(),
      temporaryLoginName: input.loginName.trim(),
      temporaryPassword,
    };
  }

  async updateUserRole(context: RequestContext, targetUserId: string, roleId: string): Promise<{ ok: true }> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_ROLE);
    const target = await this.requireTarget(actor, targetUserId, false);
    const [currentRole, role] = await Promise.all([
      this.requireRole(target.roleId),
      this.requireAssignableRole(actor, roleId),
    ]);
    if (!role.permissions.has(PERMISSION_ID.ADMIN_ROLES_MANAGE)) await this.assertRoleManagersRemain([target.id]);
    this.handleGuardedMutation(await this.options.store.setUsersRole({ targets: [target], destinationRole: role, now: context.now }, createAuditEvent(context, {
      subjectType: "user",
      subjectId: target.id,
      subjectLabel: target.displayName,
      action: "update_role",
      changes: [{
        field: "role_id",
        before: { type: "reference", value: { id: target.roleId, label: currentRole.name } },
        after: { type: "reference", value: { id: role.id, label: role.name } },
      }],
    })));
    return { ok: true };
  }

  async setUserActive(
    context: RequestContext,
    targetUserId: string,
    active: boolean,
    reason?: string,
  ): Promise<{ ok: true }> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_ACTIVATE);
    const target = await this.requireTarget(actor, targetUserId, false);
    if (target.isActive === active) {
      throw new AppError({ code: "CONFLICT", status: 409, message: active ? "User is already active" : "User already deactivated" });
    }
    if (!active) await this.assertRoleManagersRemain([target.id]);
    this.handleGuardedMutation(await this.options.store.setUsersActive({ targets: [target], active, now: context.now }, createAuditEvent(context, {
      subjectType: "user",
      subjectId: target.id,
      subjectLabel: target.displayName,
      action: active ? "reactivate" : "deactivate",
      changes: [{
        field: "active",
        before: { type: "boolean", value: target.isActive },
        after: { type: "boolean", value: active },
      }],
      context: reason === undefined ? [] : [{ field: "reason", value: { type: "text", value: reason } }],
    })));
    return { ok: true };
  }

  async resetPassword(
    context: RequestContext,
    targetUserId: string,
    currentPassword: string,
  ): Promise<Readonly<{ ok: true; temporaryLoginName: string; temporaryPassword: string }>> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_PASSWORD);
    const actorCredential = await this.options.store.findCredentialRecord(actor.userId);
    if (!actorCredential || !(await verifyPassword(currentPassword, actorCredential.passwordHash))) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Current password is incorrect" });
    }
    const target = await this.requireTarget(actor, targetUserId, false);
    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await createPasswordHash(temporaryPassword, this.passwordIterations);
    const expiresAt = new Date(Date.parse(context.now) + TEMPORARY_PASSWORD_TTL_MS).toISOString();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const temporaryLoginName = this.generateTemporaryLoginName();
      const outcome = await this.options.store.setTemporaryPassword({
        target,
        actorUserId: actor.userId,
        expectedActorAuthRevision: actorCredential.authRevision,
        temporaryLoginName,
        passwordHash,
        expiresAt,
        now: context.now,
        audit: createAuditEvent(context, {
          subjectType: "user_auth",
          subjectId: target.id,
          subjectLabel: target.displayName,
          action: "reset_password",
        }),
      });
      if (outcome === "updated") return { ok: true, temporaryLoginName, temporaryPassword };
      if (outcome === "conflict") this.throwConcurrentAuthorizationChange();
    }
    throw new AppError({ code: "CONFLICT", status: 409, message: "Could not issue temporary login credentials" });
  }

  async getLoginLock(context: RequestContext, targetUserId: string): Promise<LoginLockState> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_PASSWORD);
    const target = await this.requireTarget(actor, targetUserId, false);
    return projectLoginLock(await this.options.store.readLoginFailure(target.loginName.toLowerCase()), context.now);
  }

  async resetLoginLock(context: RequestContext, targetUserId: string): Promise<LoginLockState & { ok: true }> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_PASSWORD);
    const target = await this.requireTarget(actor, targetUserId, false);
    const outcome = await this.options.store.resetUserLoginLock(target, createAuditEvent(context, {
      subjectType: "user_auth",
      subjectId: target.id,
      subjectLabel: target.displayName,
      action: "reset_login_lock",
    }));
    if (outcome.outcome === "conflict") this.throwConcurrentAuthorizationChange();
    return { ok: true, ...projectLoginLock(outcome.previous, context.now) };
  }

  batchUpdateRole(context: RequestContext, userIds: readonly string[], roleId: string): Promise<Readonly<{ ok: true; updated: number }>> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_ROLE);
    return this.batchRole(context, userIds, roleId);
  }

  batchDeactivate(context: RequestContext, userIds: readonly string[]): Promise<Readonly<{ ok: true; updated: number }>> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_ACTIVATE);
    return this.batchLifecycle(context, userIds, "deactivate");
  }

  batchReactivate(context: RequestContext, userIds: readonly string[]): Promise<Readonly<{ ok: true; updated: number }>> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_ACTIVATE);
    return this.batchLifecycle(context, userIds, "reactivate");
  }

  batchDelete(context: RequestContext, userIds: readonly string[]): Promise<Readonly<{ ok: true; updated: number }>> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_DELETE);
    return this.batchLifecycle(context, userIds, "delete");
  }

  async listRoles(context: RequestContext): Promise<readonly RoleRecord[]> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_ROLES_VIEW);
    return this.options.store.listRoles();
  }

  async createRole(context: RequestContext, input: Readonly<{
    id?: string;
    name: string;
    level: number;
    color?: string | null;
    permissions?: Readonly<Record<Permission, boolean>>;
  }>): Promise<RoleRecord> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_ROLES_MANAGE);
    const id = input.id?.trim().toLowerCase() || `custom_${this.generateId().toLowerCase()}`;
    const permissions = new Set(PERMISSIONS.filter((permission) => input.permissions?.[permission] === true));
    assertRoleAssignable(actor, { id, level: input.level, permissions });
    const outcome = await this.options.store.createRole({
      id,
      name: input.name.trim(),
      level: input.level,
      color: input.color ?? null,
      permissions: [...permissions],
      now: context.now,
    }, createAuditEvent(context, {
      subjectType: "role",
      subjectId: id,
      subjectLabel: input.name.trim(),
      action: "create",
      context: [
        { field: "level", value: { type: "number", value: input.level } },
        { field: "permissions", value: { type: "list", value: [...permissions].map((value) => ({
          type: "code" as const, value,
        })) } },
      ],
    }));
    if (outcome === "conflict") throw new AppError({ code: "CONFLICT", status: 409, message: "Role already exists" });
    return this.requireRole(id);
  }

  async updateRole(context: RequestContext, roleId: string, input: Readonly<{
    name?: string;
    level?: number;
    color?: string | null;
    permissions?: Readonly<Record<Permission, boolean>>;
  }>): Promise<RoleRecord> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_ROLES_MANAGE);
    const existing = await this.requireRole(roleId);
    const isOwnRole = existing.id === actor.roleId;
    if (!isOwnRole && existing.level >= actor.roleLevel) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "You cannot edit a role at or above your level" });
    }
    if (input.level !== undefined) {
      if (isOwnRole && input.level > existing.level) {
        throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "You cannot raise your own role level" });
      }
      if (!isOwnRole && input.level >= actor.roleLevel) {
        throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Role level must be below your own" });
      }
    }

    const nextPermissions = new Set(existing.permissions);
    if (input.permissions) {
      for (const permission of PERMISSIONS) {
        if (Object.prototype.hasOwnProperty.call(input.permissions, permission)) {
          input.permissions[permission] ? nextPermissions.add(permission) : nextPermissions.delete(permission);
        }
      }
    }
    const escalated = [...nextPermissions].filter((permission) => !actor.permissions.has(permission));
    if (escalated.length > 0) {
      throw new AppError({
        code: "FORBIDDEN",
        status: 403,
        message: `You cannot grant permissions you do not hold: ${escalated.join(", ")}`,
        details: { permissions: escalated },
      });
    }

    const add = [...nextPermissions].filter((permission) => !existing.permissions.has(permission));
    const remove = [...existing.permissions].filter((permission) => !nextPermissions.has(permission));
    const outcome = await this.options.store.updateRole({
      id: roleId,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.level === undefined ? {} : { level: input.level }),
      ...(input.color === undefined ? {} : { color: input.color }),
      permissionDelta: { add, remove },
      expectedRevisionToken: existing.revisionToken,
      expectedPermissions: [...existing.permissions],
      now: context.now,
    }, createAuditEvent(context, {
      subjectType: "role",
      subjectId: roleId,
      subjectLabel: input.name?.trim() ?? existing.name,
      action: "update",
      changes: [
        ...(input.name === undefined ? [] : [{
          field: "name" as const,
          before: { type: "text" as const, value: existing.name },
          after: { type: "text" as const, value: input.name.trim() },
        }]),
        ...(input.level === undefined ? [] : [{
          field: "level" as const,
          before: { type: "number" as const, value: existing.level },
          after: { type: "number" as const, value: input.level },
        }]),
        ...(input.color === undefined ? [] : [{
          field: "color" as const,
          before: existing.color === null
            ? { type: "null" as const, value: null }
            : { type: "text" as const, value: existing.color },
          after: input.color === null
            ? { type: "null" as const, value: null }
            : { type: "text" as const, value: input.color },
        }]),
      ],
      context: [
        { field: "permissions_added", value: { type: "list", value: add.map((value) => ({
          type: "code" as const, value,
        })) } },
        { field: "permissions_removed", value: { type: "list", value: remove.map((value) => ({
          type: "code" as const, value,
        })) } },
      ],
    }));
    this.handleGuardedMutation(outcome);
    return this.requireRole(roleId);
  }

  async deleteRole(context: RequestContext, roleId: string): Promise<{ ok: true }> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_ROLES_MANAGE);
    const role = await this.requireRole(roleId);
    if (role.level >= actor.roleLevel) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "You cannot delete a role at or above your level" });
    }
    const outcome = await this.options.store.deleteRole(role, createAuditEvent(context, {
      subjectType: "role",
      subjectId: roleId,
      subjectLabel: role.name,
      action: "delete",
      context: [
        { field: "level", value: { type: "number", value: role.level } },
        { field: "color", value: role.color === null
          ? { type: "null", value: null }
          : { type: "text", value: role.color } },
        { field: "permissions", value: { type: "list", value: [...role.permissions].sort().map((value) => ({
          type: "code" as const,
          value,
        })) } },
        { field: "assigned_user_count", value: { type: "number", value: role.assignedUserCount } },
      ],
    }));
    if (outcome === "referenced") throw new AppError({ code: "CONFLICT", status: 409, message: "Role is still referenced" });
    if (outcome === "not_found") throw new AppError({ code: "NOT_FOUND", status: 404, message: "Role not found" });
    if (outcome === "last_role_manager") this.throwLastRoleManager();
    if (outcome === "conflict") this.throwConcurrentAuthorizationChange();
    return { ok: true };
  }

  private async batchRole(context: RequestContext, inputIds: readonly string[], roleId: string) {
    const actor = context.authorization.requireAuthenticated();
    this.assertBatchSize(inputIds);
    const userIds = unique(inputIds);
    if (userIds.length === 0) return { ok: true as const, updated: 0 };
    const [targets, role] = await Promise.all([
      this.options.store.findManagedUsers(userIds),
      this.requireAssignableRole(actor, roleId),
    ]);
    requireExistingTargets(userIds, targets);
    this.requireNotDeleted(targets);
    for (const target of targets) assertTargetBelowActor(actor, {
      userId: target.id, roleId: target.roleId, roleLevel: target.roleLevel,
    }, { allowSelf: false });
    if (!role.permissions.has(PERMISSION_ID.ADMIN_ROLES_MANAGE)) await this.assertRoleManagersRemain(userIds);
    const outcome = await this.options.store.setUsersRole({ targets, destinationRole: role, now: context.now }, createAuditEvent(context, {
      subjectType: "user",
      subjectId: "batch",
      subjectLabel: null,
      action: "batch_role_update",
      context: [
        { field: "user_ids", value: { type: "list", value: targets.map((target) => ({
          type: "reference" as const, value: { id: target.id, label: target.displayName },
        })) } },
        { field: "role_id", value: { type: "reference", value: { id: role.id, label: role.name } } },
        { field: "count", value: { type: "number", value: targets.length } },
      ],
    }));
    this.handleGuardedMutation(outcome);
    return { ok: true as const, updated: targets.length };
  }

  private async batchLifecycle(
    context: RequestContext,
    inputIds: readonly string[],
    action: "deactivate" | "reactivate" | "delete",
  ) {
    const actor = context.authorization.requireAuthenticated();
    this.assertBatchSize(inputIds);
    const userIds = unique(inputIds);
    if (userIds.length === 0) return { ok: true as const, updated: 0 };
    const targets = requireExistingTargets(userIds, await this.options.store.findManagedUsers(userIds));
    this.requireNotDeleted(targets);
    for (const target of targets) assertTargetBelowActor(actor, {
      userId: target.id, roleId: target.roleId, roleLevel: target.roleLevel,
    }, { allowSelf: false });
    if (action !== "delete") {
      const desiredActive = action === "reactivate";
      if (targets.some((target) => target.isActive === desiredActive)) {
        throw new AppError({
          code: "CONFLICT",
          status: 409,
          message: desiredActive ? "One or more users are already active" : "One or more users are already deactivated",
        });
      }
    }
    if (action !== "reactivate") await this.assertRoleManagersRemain(userIds);
    const auditAction = action === "delete" ? "batch_delete" : action === "deactivate" ? "batch_deactivate" : "batch_reactivate";
    const audit = createAuditEvent(context, {
      subjectType: "user",
      subjectId: "batch",
      subjectLabel: null,
      action: auditAction,
      context: [
        { field: "user_ids", value: { type: "list", value: targets.map((target) => ({
          type: "reference" as const, value: { id: target.id, label: target.displayName },
        })) } },
        { field: "count", value: { type: "number", value: targets.length } },
      ],
    });
    const outcome = action === "delete"
      ? await this.options.store.softDeleteUsers({ targets, now: context.now }, audit)
      : await this.options.store.setUsersActive({ targets, active: action === "reactivate", now: context.now }, audit);
    this.handleGuardedMutation(outcome);
    return { ok: true as const, updated: targets.length };
  }

  private async requireTarget(actor: AuthenticatedActor, userId: string, allowSelf: boolean): Promise<ManagedUserTarget> {
    const target = (await this.options.store.findManagedUsers([userId]))[0];
    if (!target || target.deletedAt !== null) {
      throw new AppError({ code: "NOT_FOUND", status: 404, message: "User not found" });
    }
    assertTargetBelowActor(actor, {
      userId: target.id, roleId: target.roleId, roleLevel: target.roleLevel,
    }, { allowSelf });
    return target;
  }

  private async requireAssignableRole(actor: AuthenticatedActor, roleId: string): Promise<RoleRecord> {
    const role = await this.requireRole(roleId);
    assertRoleAssignable(actor, role);
    return role;
  }

  private async requireRole(roleId: string): Promise<RoleRecord> {
    const role = await this.options.store.findRole(roleId);
    if (!role) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Role not found" });
    return role;
  }

  private async assertRoleManagersRemain(userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const [total, affected] = await Promise.all([
      this.options.store.countActiveRoleManagers(),
      this.options.store.countActiveRoleManagersAmong(userIds),
    ]);
    if (affected > 0 && total <= affected) this.throwLastRoleManager();
  }

  private throwLastRoleManager(): never {
    throw new AppError({
      code: "CONFLICT",
      status: 409,
      message: "At least one active role manager is required",
    });
  }

  private assertBatchSize(inputIds: readonly string[]): void {
    if (inputIds.length > MAX_MANAGED_USER_BATCH) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: `User batches cannot contain more than ${MAX_MANAGED_USER_BATCH} users`,
      });
    }
  }

  private requireNotDeleted(targets: readonly ManagedUserTarget[]): void {
    const deleted = targets.filter(({ deletedAt }) => deletedAt !== null).map(({ id }) => id);
    if (deleted.length > 0) {
      throw new AppError({ code: "NOT_FOUND", status: 404, message: "One or more users were not found", details: { user_ids: deleted } });
    }
  }

  private handleGuardedMutation(outcome: GuardedAuthMutationResult): void {
    if (outcome === "last_role_manager") this.throwLastRoleManager();
    if (outcome === "conflict") this.throwConcurrentAuthorizationChange();
  }

  private throwConcurrentAuthorizationChange(): never {
    throw new AppError({
      code: "CONFLICT",
      status: 409,
      message: "Authorization data changed while the request was being processed",
    });
  }

  private signalInboxChanged(): void {
    const { deferred, notifications } = this.options;
    if (!deferred || !notifications) return;
    deferred.defer(() => notifications.publish({ type: "inbox_changed" }));
  }
}
