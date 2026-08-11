import { AppError, type AuthenticatedActor, type RequestContext } from "@guild/kernel";
import { PERMISSIONS, PERMISSION_ID, type Permission } from "@guild/shared/constants/roles";
import { isReservedSystemTestUsername } from "@guild/shared/config/system-test";
import { createAuditMutation } from "../audit/public.js";
import { assertOwnerRoleDefinition, assertRoleAssignable, assertTargetBelowActor, requirePermission } from "./authorization";
import {
  createOpaqueToken,
  createPasswordHash,
  digestToken,
  PASSWORD_HASH_ITERATIONS,
  requireSafePasswordIterations,
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

type InviteWithCode = InviteRecord & Readonly<{ code: string }>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
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
}>;

export class IdentityAdminService {
  private readonly generateId: () => string;
  private readonly generateTemporaryPassword: () => string;
  private readonly passwordIterations: number;

  constructor(private readonly options: IdentityAdminServiceOptions) {
    this.passwordIterations = requireSafePasswordIterations(options.passwordIterations ?? PASSWORD_HASH_ITERATIONS);
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.generateTemporaryPassword = options.generateTemporaryPassword ?? (() => createOpaqueToken(18));
  }

  async listInvites(context: RequestContext, input: Readonly<{
    visibility: InviteVisibility;
    limit: number;
    cursor?: string;
    search?: string;
  }>): Promise<Readonly<{ data: readonly InviteWithCode[]; nextCursor: string | null; total: number }>> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_INVITE_VIEW);
    const suppliedSearch = input.search?.trim() ?? "";
    const exactId = suppliedSearch ? await this.options.inviteTokens.decode(suppliedSearch) : null;
    const search = exactId ? "" : suppliedSearch.toLowerCase();
    if (!exactId) assertPortableLikeSearch(search, "Invite search");
    const page = await this.options.store.listInvites({
      visibility: input.visibility,
      limit: input.limit,
      cursor: parseCursor(input.cursor),
      search,
      ...(exactId ? { exactId } : {}),
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
    }, createAuditMutation(context, {
      entityType: "invite_link",
      entityId: id,
      action: "create",
      summary: id,
      details: { role_id: role.id, max_uses: input.maxUses, expires_at: input.expiresAt },
    }));
    return { ...invite, code };
  }

  async revokeInvite(context: RequestContext, inviteId: string): Promise<{ ok: true }> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_INVITE_MANAGE);
    const changed = await this.options.store.revokeInvite(inviteId, context.now, createAuditMutation(context, {
      entityType: "invite_link",
      entityId: inviteId,
      action: "revoke",
      summary: inviteId,
    }));
    if (!changed) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Invite link not found" });
    return { ok: true };
  }

  async deleteInvite(context: RequestContext, inviteId: string): Promise<{ ok: true }> {
    requirePermission(context.authorization, PERMISSION_ID.ADMIN_INVITE_MANAGE);
    const changed = await this.options.store.deleteInvite(inviteId, createAuditMutation(context, {
      entityType: "invite_link",
      entityId: inviteId,
      action: "delete",
      summary: inviteId,
    }));
    if (!changed) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Invite link not found" });
    return { ok: true };
  }

  async createMember(context: RequestContext, input: Readonly<{
    username: string;
    roleId: string;
  }>): Promise<Readonly<{ ok: true; userId: string; username: string; temporaryPassword: string }>> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_EDIT);
    if (isReservedSystemTestUsername(input.username)) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Username is reserved" });
    }
    const destinationRole = await this.requireAssignableRole(actor, input.roleId);
    const id = this.generateId();
    const temporaryPassword = this.generateTemporaryPassword();
    const outcome = await this.options.provisioning.createManagedUser({
      id,
      username: input.username.trim(),
      roleId: input.roleId,
      passwordHash: await createPasswordHash(temporaryPassword, this.passwordIterations),
      destinationRole,
      now: context.now,
    }, createAuditMutation(context, {
      entityType: "user",
      entityId: id,
      action: "admin_create_member",
      summary: input.username.trim(),
      details: { role_id: input.roleId },
    }));
    if (outcome === "username_taken") {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Username already taken" });
    }
    if (outcome === "conflict") this.throwConcurrentAuthorizationChange();
    return { ok: true, userId: id, username: input.username.trim(), temporaryPassword };
  }

  async updateUserRole(context: RequestContext, targetUserId: string, roleId: string): Promise<{ ok: true }> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_ROLE);
    const target = await this.requireTarget(actor, targetUserId, false);
    const role = await this.requireAssignableRole(actor, roleId);
    if (!role.permissions.has(PERMISSION_ID.ADMIN_OWNERS_MANAGE)) await this.assertOwnersRemain([target.id]);
    this.handleGuardedMutation(await this.options.store.setUsersRole({ targets: [target], destinationRole: role, now: context.now }, createAuditMutation(context, {
      entityType: "user",
      entityId: target.id,
      action: "update_role",
      summary: target.username,
      details: { role: { from: target.roleId, to: role.id } },
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
    if (!active) await this.assertOwnersRemain([target.id]);
    this.handleGuardedMutation(await this.options.store.setUsersActive({ targets: [target], active, now: context.now }, createAuditMutation(context, {
      entityType: "user",
      entityId: target.id,
      action: active ? "reactivate" : "deactivate",
      summary: target.username,
      details: { reason: reason ?? null },
    })));
    return { ok: true };
  }

  async resetPassword(
    context: RequestContext,
    targetUserId: string,
    suppliedPassword?: string,
  ): Promise<Readonly<{ ok: true; temporaryPassword: string }>> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_PASSWORD);
    const target = await this.requireTarget(actor, targetUserId, false);
    const temporaryPassword = suppliedPassword ?? this.generateTemporaryPassword();
    const outcome = await this.options.store.resetUserPassword(
      target,
      await createPasswordHash(temporaryPassword, this.passwordIterations),
      context.now,
      createAuditMutation(context, {
        entityType: "user_auth",
        entityId: target.id,
        action: "reset_password",
        summary: target.username,
      }),
    );
    if (outcome === "conflict") this.throwConcurrentAuthorizationChange();
    return { ok: true, temporaryPassword };
  }

  async getLoginLock(context: RequestContext, targetUserId: string): Promise<LoginLockState> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_PASSWORD);
    const target = await this.requireTarget(actor, targetUserId, false);
    return projectLoginLock(await this.options.store.readLoginFailure(target.username.toLowerCase()), context.now);
  }

  async resetLoginLock(context: RequestContext, targetUserId: string): Promise<LoginLockState & { ok: true }> {
    const actor = requirePermission(context.authorization, PERMISSION_ID.ADMIN_USERS_PASSWORD);
    const target = await this.requireTarget(actor, targetUserId, false);
    const outcome = await this.options.store.resetUserLoginLock(target, createAuditMutation(context, {
      entityType: "user_auth",
      entityId: target.id,
      action: "reset_login_lock",
      summary: target.username,
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
    }, createAuditMutation(context, {
      entityType: "role",
      entityId: id,
      action: "create",
      summary: input.name.trim(),
      details: { level: input.level, permissions: [...permissions] },
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
    assertOwnerRoleDefinition({ id: existing.id, level: input.level ?? existing.level, permissions: nextPermissions });
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
    }, createAuditMutation(context, {
      entityType: "role",
      entityId: roleId,
      action: "update",
      summary: input.name?.trim() ?? existing.name,
      details: { permissions_added: add, permissions_removed: remove },
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
    const outcome = await this.options.store.deleteRole(role, createAuditMutation(context, {
      entityType: "role",
      entityId: roleId,
      action: "delete",
      summary: role.name,
    }));
    if (outcome === "referenced") throw new AppError({ code: "CONFLICT", status: 409, message: "Role is still referenced" });
    if (outcome === "not_found") throw new AppError({ code: "NOT_FOUND", status: 404, message: "Role not found" });
    if (outcome === "last_owner") this.throwLastOwner();
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
    }, { allowSelf: false, allowOwnerPeer: true });
    if (!role.permissions.has(PERMISSION_ID.ADMIN_OWNERS_MANAGE)) await this.assertOwnersRemain(userIds);
    const outcome = await this.options.store.setUsersRole({ targets, destinationRole: role, now: context.now }, createAuditMutation(context, {
      entityType: "user",
      entityId: "batch",
      action: "batch_role_update",
      summary: targets.map((target) => target.username).join(", ").slice(0, 200),
      details: { user_ids: userIds, new_role: role.id, count: targets.length },
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
    }, { allowSelf: false, allowOwnerPeer: true });
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
    if (action !== "reactivate") await this.assertOwnersRemain(userIds);
    const auditAction = action === "delete" ? "batch_delete" : action === "deactivate" ? "batch_deactivate" : "batch_reactivate";
    const audit = createAuditMutation(context, {
      entityType: "user",
      entityId: "batch",
      action: auditAction,
      summary: targets.map((target) => target.username).join(", ").slice(0, 200),
      details: { user_ids: userIds, count: targets.length },
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
    }, { allowSelf, allowOwnerPeer: true });
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

  private async assertOwnersRemain(userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const [total, affected] = await Promise.all([
      this.options.store.countActiveOwners(),
      this.options.store.countActiveOwnersAmong(userIds),
    ]);
    if (affected > 0 && total <= affected) this.throwLastOwner();
  }

  private throwLastOwner(): never {
    throw new AppError({
      code: "CONFLICT",
      status: 409,
      message: "At least one active site owner is required",
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
    if (outcome === "last_owner") this.throwLastOwner();
    if (outcome === "conflict") this.throwConcurrentAuthorizationChange();
  }

  private throwConcurrentAuthorizationChange(): never {
    throw new AppError({
      code: "CONFLICT",
      status: 409,
      message: "Authorization data changed while the request was being processed",
    });
  }
}
