import { loginLockErrorDetailsSchema, type MemberProfile } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import {
  AppError,
  createAuthorizationContext,
  type AuthorizationContext,
  type RateLimiter,
  type RequestContext,
} from "@guild/kernel";
import { isReservedSystemTestUsername } from "@guild/shared/config/system-test";
import { createAuditMutation, createAuditMutationForActor } from "../audit/public.js";
import {
  createOpaqueToken,
  createPasswordHash,
  digestToken,
  PASSWORD_HASH_ITERATIONS,
  readPasswordHashIterations,
  requireSafePasswordIterations,
  verifyPassword,
  type InviteTokenCodec,
} from "./crypto";
import type {
  AuthProfileReader,
  AccountProvisioningStore,
  AuthSessionResult,
  AuthStore,
  AuthUserRecord,
  ResolvedSession,
} from "./auth-types";
import { projectLoginLock } from "./login-lock";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const SESSION_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_SESSIONS_PER_USER = 3;
const LOGIN_FREE_ATTEMPTS = 3;
const LOGIN_LOCK_SECONDS = [30, 60, 300, 900, 1_800, 3_600] as const;
const LOGIN_FAILURE_RETENTION_MS = 24 * 60 * 60 * 1_000;
const LOGIN_FAILURE_PRUNE_LIMIT = 100;

function dateMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function requireProfile(profile: MemberProfile | null): MemberProfile {
  if (!profile) {
    throw new AppError({
      code: "SERVER_ERROR",
      status: 500,
      message: "Member profile is missing",
    });
  }
  return profile;
}

export type AuthServiceOptions = Readonly<{
  store: AuthStore;
  provisioning: AccountProvisioningStore;
  profiles: AuthProfileReader;
  inviteTokens: InviteTokenCodec;
  loginRateLimiter?: RateLimiter;
  passwordIterations?: number;
  generateId?: () => string;
  generateToken?: () => string;
}>;

export class AuthService {
  private readonly dummyPasswordHash: string;
  private readonly generateId: () => string;
  private readonly generateToken: () => string;
  private readonly passwordIterations: number;

  constructor(private readonly options: AuthServiceOptions) {
    this.passwordIterations = requireSafePasswordIterations(options.passwordIterations ?? PASSWORD_HASH_ITERATIONS);
    this.dummyPasswordHash = `pbkdf2-sha256$${this.passwordIterations}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.generateToken = options.generateToken ?? (() => createOpaqueToken());
  }

  async resolveAuthorization(rawToken: string | null, nowInput = new Date().toISOString()): Promise<Readonly<{
    authorization: AuthorizationContext;
    session: ResolvedSession | null;
  }>> {
    if (!rawToken) return { authorization: createAuthorizationContext(null), session: null };
    const tokenDigest = await digestToken(rawToken);
    const record = await this.options.store.findSessionAuthorization(tokenDigest);
    if (!record) return { authorization: createAuthorizationContext(null), session: null };

    const now = dateMs(nowInput);
    const invalid = !record.isActive
      || record.deletedAt !== null
      || dateMs(record.expiresAt) <= now
      || now - dateMs(record.sessionCreatedAt) > SESSION_ABSOLUTE_TTL_MS;
    if (invalid) {
      await this.options.store.deleteSession(tokenDigest);
      return { authorization: createAuthorizationContext(null), session: null };
    }

    let renewedExpiresAt: string | null = null;
    if (dateMs(record.expiresAt) - now < SESSION_TTL_MS / 2) {
      renewedExpiresAt = new Date(now + SESSION_TTL_MS).toISOString();
      await this.options.store.renewSession(tokenDigest, renewedExpiresAt);
    }

    return {
      authorization: createAuthorizationContext({
        userId: record.id,
        sessionId: record.tokenDigest,
        roleId: record.roleId,
        roleLevel: record.roleLevel,
        permissions: record.permissions,
      }),
      session: { record, renewedExpiresAt },
    };
  }

  async login(input: Readonly<{
    username: string;
    password: string;
    stayLoggedIn: boolean;
    now: string;
    clientIdentifier?: string;
  }>): Promise<AuthSessionResult> {
    const normalizedUsername = input.username.trim().toLowerCase();
    const failure = await this.options.store.readLoginFailure(normalizedUsername);
    this.throwIfLoginLocked(projectLoginLock(failure, input.now));
    await this.consumeLoginRateLimit(input.clientIdentifier, normalizedUsername);

    const account = await this.options.store.findLoginAccount(normalizedUsername);
    const usable = account?.isActive === true && account.deletedAt === null;
    const passwordValid = await verifyPassword(input.password, usable ? account.passwordHash : this.dummyPasswordHash);

    if (!account || !usable || !passwordValid) {
      const nextFailure = await this.options.store.recordLoginFailure({
        normalizedUsername,
        now: input.now,
        freeAttempts: LOGIN_FREE_ATTEMPTS,
        lockSeconds: LOGIN_LOCK_SECONDS,
      });
      await this.options.store.pruneLoginFailures(
        new Date(dateMs(input.now) - LOGIN_FAILURE_RETENTION_MS).toISOString(),
        input.now,
        LOGIN_FAILURE_PRUNE_LIMIT,
      );
      this.throwIfLoginLocked(projectLoginLock(nextFailure, input.now));
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
    }

    await this.options.store.clearLoginFailures(normalizedUsername);
    const storedIterations = readPasswordHashIterations(account.passwordHash);
    if (storedIterations !== null && storedIterations < this.passwordIterations) {
      const upgraded = await createPasswordHash(input.password, this.passwordIterations);
      await this.options.store.rehashPassword(account.id, upgraded, input.now);
    }

    return this.createAuthenticatedSession(account, input.stayLoggedIn, input.now);
  }

  async logout(rawToken: string | null): Promise<{ ok: true }> {
    if (rawToken) await this.options.store.deleteSession(await digestToken(rawToken));
    return { ok: true };
  }

  async checkUsername(username: string): Promise<{ available: boolean; reason?: string }> {
    const candidate = username.trim();
    if (!/^[a-zA-Z0-9_一-鿿]{1,50}$/.test(candidate)) return { available: false, reason: "invalid_format" };
    if (isReservedSystemTestUsername(candidate)) return { available: false, reason: "reserved_prefix" };
    return await this.options.store.usernameExists(candidate.toLowerCase())
      ? { available: false, reason: "already_taken" }
      : { available: true };
  }

  async verifyInvite(token: string, now: string): Promise<Readonly<{
    valid: false;
  }> | Readonly<{
    valid: true;
    roleId: string;
    roleName: string;
    roleColor: string | null;
    roleLevel: number;
  }>> {
    const id = await this.options.inviteTokens.decode(token);
    if (!id) return { valid: false };
    const invite = await this.options.store.findActiveInvite(id, await digestToken(token), now);
    return invite
      ? {
          valid: true,
          roleId: invite.roleId,
          roleName: invite.roleName,
          roleColor: invite.roleColor,
          roleLevel: invite.roleLevel,
        }
      : { valid: false };
  }

  async register(context: RequestContext, input: Readonly<{
    inviteToken: string;
    username: string;
    password: string;
  }>): Promise<AuthSessionResult> {
    const username = input.username.trim();
    if (isReservedSystemTestUsername(username)) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Username is reserved" });
    }
    const inviteId = await this.options.inviteTokens.decode(input.inviteToken);
    if (!inviteId) throw new AppError({ code: "CONFLICT", status: 409, message: "Invite link is no longer available" });

    const userId = this.generateId();
    const passwordHash = await createPasswordHash(input.password, this.passwordIterations);
    const audit = createAuditMutationForActor(context, userId, {
      entityType: "user",
      entityId: userId,
      action: "register",
      summary: username,
      details: { invite_id: inviteId },
    });
    const outcome = await this.options.provisioning.redeemInviteAndCreateMember({
      inviteId,
      tokenDigest: await digestToken(input.inviteToken),
      userId,
      username,
      passwordHash,
      now: context.now,
    }, audit);
    if (outcome === "username_taken") {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Username already taken" });
    }
    if (outcome === "invite_unavailable") {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Invite link is no longer available" });
    }

    const user = await this.options.store.findUser(userId);
    if (!user) throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Created user is missing" });
    return this.createAuthenticatedSession(user, false, context.now);
  }

  async getMe(context: RequestContext): Promise<Readonly<{ user: AuthUserRecord; profile: MemberProfile }>> {
    const actor = context.authorization.requireAuthenticated();
    const user = await this.options.store.findUser(actor.userId);
    if (!user || !user.isActive || user.deletedAt !== null) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication required" });
    }
    return { user, profile: requireProfile(await this.options.profiles.readOwnProfile(user.id)) };
  }

  async changePassword(context: RequestContext, input: Readonly<{
    targetUserId: string;
    currentPassword: string;
    newPassword: string;
  }>): Promise<{ ok: true }> {
    const actor = context.authorization.requireAuthenticated();
    if (actor.userId !== input.targetUserId) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Password change is allowed for self only" });
    }
    const current = await this.options.store.findCredential(actor.userId);
    if (!current) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Password record not found" });
    if (!(await verifyPassword(input.currentPassword, current))) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Current password is incorrect" });
    }
    await this.options.store.changeOwnPassword(
      actor.userId,
      await createPasswordHash(input.newPassword, this.passwordIterations),
      context.now,
      createAuditMutation(context, {
        entityType: "user_auth",
        entityId: actor.userId,
        action: "change_password",
      }),
    );
    return { ok: true };
  }

  async changeUsername(context: RequestContext, input: Readonly<{
    targetUserId: string;
    currentPassword: string;
    newUsername: string;
  }>): Promise<{ ok: true }> {
    const actor = context.authorization.requireAuthenticated();
    if (actor.userId !== input.targetUserId) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Username change is allowed for self only" });
    }
    if (isReservedSystemTestUsername(input.newUsername)) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Username is reserved" });
    }
    const current = await this.options.store.findCredential(actor.userId);
    if (!current) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Password record not found" });
    if (!(await verifyPassword(input.currentPassword, current))) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Current password is incorrect" });
    }
    const outcome = await this.options.store.changeOwnUsername(
      actor.userId,
      input.newUsername.trim(),
      context.now,
      createAuditMutation(context, {
        entityType: "user",
        entityId: actor.userId,
        action: "change_username",
        summary: input.newUsername.trim(),
      }),
    );
    if (outcome === "username_taken") {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Username already taken" });
    }
    return { ok: true };
  }

  private async createAuthenticatedSession(
    user: AuthUserRecord,
    stayLoggedIn: boolean,
    now: string,
  ): Promise<AuthSessionResult> {
    const rawToken = this.generateToken();
    const tokenDigest = await digestToken(rawToken);
    const expiresAt = new Date(dateMs(now) + SESSION_TTL_MS).toISOString();
    await this.options.store.createSessionBounded({
      userId: user.id,
      tokenDigest,
      expiresAt,
      createdAt: now,
      maximumSessions: MAX_SESSIONS_PER_USER,
    });
    return {
      user,
      profile: requireProfile(await this.options.profiles.readOwnProfile(user.id)),
      session: { rawToken, tokenDigest, expiresAt, stayLoggedIn },
    };
  }

  private throwIfLoginLocked(state: ReturnType<typeof projectLoginLock>): void {
    if (!state.isLocked || !state.lockedUntil) return;
    throw new AppError({
      code: "RATE_LIMITED",
      status: 429,
      message: `Too many failed login attempts. Try again in ${formatRetryDuration(state.retryAfterSeconds)}.`,
      details: loginLockErrorDetailsSchema.parse({
        retry_after_seconds: state.retryAfterSeconds,
        locked_until: state.lockedUntil,
      }),
    });
  }

  private async consumeLoginRateLimit(clientIdentifier: string | undefined, normalizedUsername: string): Promise<void> {
    if (!this.options.loginRateLimiter) return;
    const client = clientIdentifier?.trim();
    if (!client) throw new TypeError("Login rate-limit client identifier is required");
    const decision = await this.options.loginRateLimiter.consume(
      `auth:login:${encodeURIComponent(client)}:${encodeURIComponent(normalizedUsername)}`,
    );
    if (!decision.allowed) {
      throw new AppError({
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many authentication requests",
        details: { retry_after_seconds: decision.retryAfterSeconds ?? 1 },
      });
    }
  }
}

function formatRetryDuration(totalSeconds: number): string {
  const seconds = Math.max(1, Math.ceil(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (remainder > 0 || parts.length === 0) parts.push(`${remainder} second${remainder === 1 ? "" : "s"}`);
  return parts.join(" ");
}

export const ROLE_MANAGER_PERMISSION = PERMISSION_ID.ADMIN_ROLES_MANAGE;
