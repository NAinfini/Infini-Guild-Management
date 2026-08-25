import { loginLockErrorDetailsSchema, type MemberProfile } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import {
  AppError,
  createAuthorizationContext,
  type AuthorizationContext,
  type DeferredTasks,
  type NotificationPublisher,
  type RateLimiter,
  type RequestContext,
} from "@guild/kernel";
import { isReservedSystemTestIdentityName } from "@guild/shared/config/system-test";
import { createAuditEvent, createAuditEventForUser } from "../audit/public.js";
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
import { assertPasswordPolicy } from "./password-policy";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const PASSWORD_CHANGE_SESSION_TTL_MS = 15 * 60 * 1_000;
const SESSION_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const LAST_LOGIN_REFRESH_MS = 60 * 60 * 1_000;
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
  loginIpRateLimiter?: RateLimiter;
  loginNameRateLimiter?: RateLimiter;
  passwordIterations?: number;
  generateId?: () => string;
  generateToken?: () => string;
  notifications?: NotificationPublisher;
  deferred?: DeferredTasks;
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
    if (record.sessionScope === "normal" && dateMs(record.expiresAt) - now < SESSION_TTL_MS / 2) {
      renewedExpiresAt = new Date(now + SESSION_TTL_MS).toISOString();
      await this.options.store.renewSession(tokenDigest, renewedExpiresAt);
    }

    /* 带着「保持登录」的 cookie 回到站点也是登录，不必再填一次表单。但这条路径每个
       请求都会走，所以按窗口收敛：同一个人一个窗口内只写一次，而「最近登录」显示到
       分钟，看不出差别。 */
    let lastLoginAt = record.lastLoginAt;
    if (lastLoginAt === null || now - dateMs(lastLoginAt) >= LAST_LOGIN_REFRESH_MS) {
      lastLoginAt = nowInput;
      await this.options.store.recordLastLogin(record.id, nowInput);
    }

    return {
      authorization: createAuthorizationContext({
        userId: record.id,
        sessionId: record.tokenDigest,
        roleId: record.roleId,
        roleLevel: record.roleLevel,
        permissions: record.permissions,
        sessionScope: record.sessionScope,
      }),
      session: { record: { ...record, lastLoginAt }, renewedExpiresAt },
    };
  }

  async login(input: Readonly<{
    loginName: string;
    password: string;
    stayLoggedIn: boolean;
    now: string;
    clientIdentifier?: string;
  }>): Promise<AuthSessionResult> {
    const normalizedLoginName = input.loginName.trim().toLowerCase();
    await this.consumeLoginRateLimit(input.clientIdentifier, normalizedLoginName);
    // A lock is deliberately checked before lookup or PBKDF2 work.
    const failure = await this.options.store.readLoginFailure(normalizedLoginName);
    this.throwIfLoginLocked(projectLoginLock(failure, input.now));
    const account = await this.options.store.findLoginAccount(normalizedLoginName);
    const usable = account?.isActive === true && account.deletedAt === null;
    const temporaryUsable = usable
      && account?.temporaryPasswordExpiresAt !== null
      && account?.temporaryPasswordUsedAt === null
      && dateMs(account.temporaryPasswordExpiresAt) > dateMs(input.now);
    const passwordValid = await verifyPassword(input.password, usable ? account.passwordHash : this.dummyPasswordHash);

    if (!account || !usable || !passwordValid) {
      const nextFailure = await this.options.store.recordLoginFailure({
        normalizedLoginName,
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

    if (account.temporaryPasswordExpiresAt !== null && !temporaryUsable) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
    }
    await this.options.store.clearLoginFailures(normalizedLoginName);
    if (temporaryUsable) {
      const rawToken = this.generateToken();
      const tokenDigest = await digestToken(rawToken);
      const expiresAt = new Date(dateMs(input.now) + PASSWORD_CHANGE_SESSION_TTL_MS).toISOString();
      const consumed = await this.options.store.consumeTemporaryPasswordAndOpenSession({
        userId: account.id,
        passwordHash: account.passwordHash,
        now: input.now,
        tokenDigest,
        expiresAt,
        maximumSessions: MAX_SESSIONS_PER_USER,
        authRevision: account.authRevision,
      });
      if (!consumed) throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
      return this.sessionResult(account, rawToken, tokenDigest, expiresAt, false, input.now, "password_change");
    }
    const storedIterations = readPasswordHashIterations(account.passwordHash);
    if (storedIterations !== null && storedIterations < this.passwordIterations) {
      const upgraded = await createPasswordHash(input.password, this.passwordIterations);
      const rehashed = await this.options.store.rehashPassword({
        userId: account.id,
        expectedPasswordHash: account.passwordHash,
        expectedAuthRevision: account.authRevision,
        passwordHash: upgraded,
        now: input.now,
      });
      if (!rehashed) this.throwAuthenticationStateChanged();
    }

    return this.createAuthenticatedSession(account, input.stayLoggedIn, input.now, "normal", account.authRevision);
  }

  async logout(rawToken: string | null): Promise<{ ok: true }> {
    if (rawToken) await this.options.store.deleteSession(await digestToken(rawToken));
    return { ok: true };
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
    const code = this.options.inviteTokens.normalize(token);
    if (!code) return { valid: false };
    const invite = await this.options.store.findActiveInvite(await digestToken(code), now);
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
    loginName: string;
    displayName: string;
    password: string;
  }>): Promise<AuthSessionResult> {
    const loginName = input.loginName.trim();
    const displayName = input.displayName.trim();
    if (isReservedSystemTestIdentityName(loginName) || isReservedSystemTestIdentityName(displayName)) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Name is reserved" });
    }
    assertPasswordPolicy(input.password);
    const inviteCode = this.options.inviteTokens.normalize(input.inviteToken);
    if (!inviteCode) throw new AppError({ code: "CONFLICT", status: 409, message: "Invite link is no longer available" });
    const tokenDigest = await digestToken(inviteCode);
    const invite = await this.options.store.findActiveInvite(tokenDigest, context.now);
    if (!invite) throw new AppError({ code: "CONFLICT", status: 409, message: "Invite link is no longer available" });

    const userId = this.generateId();
    const passwordHash = await createPasswordHash(input.password, this.passwordIterations);
    const audit = createAuditEventForUser(context, userId, {
      subjectType: "user",
      subjectId: userId,
      subjectLabel: displayName,
      action: "register",
      context: [
        { field: "invite_id", value: {
          type: "reference", value: { id: invite.id, label: invite.roleName },
        } },
        { field: "role_id", value: {
          type: "reference", value: { id: invite.roleId, label: invite.roleName },
        } },
      ],
    });
    const outcome = await this.options.provisioning.redeemInviteAndCreateMember({
      inviteId: invite.id,
      tokenDigest,
      userId,
      loginName,
      displayName,
      passwordHash,
      now: context.now,
    }, audit);
    if (outcome === "login_name_taken" || outcome === "display_name_taken") {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Name already taken" });
    }
    if (outcome === "invite_unavailable") {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Invite link is no longer available" });
    }
    this.signalInboxChanged();

    const user = await this.options.store.findUser(userId);
    if (!user) throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Created user is missing" });
    return this.createAuthenticatedSession(user, false, context.now);
  }

  async getMe(context: RequestContext): Promise<Readonly<{
    user: AuthUserRecord;
    profile: MemberProfile;
    sessionScope: "normal" | "password_change";
  }>> {
    const actor = context.authorization.requireAuthenticated();
    const user = await this.options.store.findUser(actor.userId);
    if (!user || !user.isActive || user.deletedAt !== null) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication required" });
    }
    return {
      user,
      profile: requireProfile(await this.options.profiles.readOwnProfile(user.id)),
      sessionScope: actor.sessionScope,
    };
  }

  async getSecurity(context: RequestContext): Promise<Readonly<{ loginName: string; displayName: string }>> {
    const actor = context.authorization.requireAuthenticated();
    const [loginName, user] = await Promise.all([
      this.options.store.findLoginName(actor.userId),
      this.options.store.findUser(actor.userId),
    ]);
    if (!loginName || !user || !user.isActive || user.deletedAt !== null) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication required" });
    }
    return { loginName, displayName: user.displayName };
  }

  async changePassword(context: RequestContext, input: Readonly<{
    targetUserId?: string;
    currentPassword: string;
    newPassword: string;
  }>): Promise<{ ok: true }> {
    const actor = context.authorization.requireAuthenticated();
    if (input.targetUserId !== undefined && actor.userId !== input.targetUserId) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Password change is allowed for self only" });
    }
    const [current, user] = await Promise.all([
      this.options.store.findCredentialRecord(actor.userId),
      this.options.store.findUser(actor.userId),
    ]);
    if (!current || !user) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Password record not found" });
    if (!(await verifyPassword(input.currentPassword, current.passwordHash))) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Current password is incorrect" });
    }
    assertPasswordPolicy(input.newPassword);
    const changed = await this.options.store.changeOwnPassword({
      userId: actor.userId,
      expectedAuthRevision: current.authRevision,
      passwordHash: await createPasswordHash(input.newPassword, this.passwordIterations),
      now: context.now,
      audit: createAuditEvent(context, {
        subjectType: "user_auth",
        subjectId: actor.userId,
        subjectLabel: user.displayName,
        action: "change_password",
      }),
    });
    if (!changed) this.throwAuthenticationStateChanged();
    return { ok: true };
  }

  async changeLoginName(context: RequestContext, input: Readonly<{
    currentPassword: string;
    loginName: string;
  }>): Promise<{ ok: true }> {
    const actor = context.authorization.requireAuthenticated();
    if (isReservedSystemTestIdentityName(input.loginName)) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Login name is reserved" });
    }
    const [current, user] = await Promise.all([
      this.options.store.findCredentialRecord(actor.userId),
      this.options.store.findUser(actor.userId),
    ]);
    if (!current || !user) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Password record not found" });
    if (!(await verifyPassword(input.currentPassword, current.passwordHash))) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Current password is incorrect" });
    }
    const outcome = await this.options.store.changeOwnLoginName({
      userId: actor.userId,
      expectedAuthRevision: current.authRevision,
      previousLoginName: current.loginName,
      loginName: input.loginName.trim(),
      now: context.now,
      audit: createAuditEvent(context, {
        subjectType: "user_auth",
        subjectId: actor.userId,
        subjectLabel: user.displayName,
        action: "update",
        context: [{ field: "changed_sections", value: { type: "list", value: [{ type: "code", value: "login_name" }] } }],
      }),
    });
    if (outcome === "login_name_taken") {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Login name already taken" });
    }
    if (outcome !== "updated") this.throwAuthenticationStateChanged();
    return { ok: true };
  }

  async completePasswordReset(context: RequestContext, input: Readonly<{
    loginName: string;
    newPassword: string;
  }>): Promise<AuthSessionResult> {
    const actor = context.authorization.requireAuthenticated();
    if (actor.sessionScope !== "password_change") {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Password-reset session required" });
    }
    const loginName = input.loginName.trim();
    if (isReservedSystemTestIdentityName(loginName)) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Login name is reserved" });
    }
    assertPasswordPolicy(input.newPassword);
    const [user, credential] = await Promise.all([
      this.options.store.findUser(actor.userId),
      this.options.store.findCredentialRecord(actor.userId),
    ]);
    if (!user || !credential) throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication required" });
    const rawToken = this.generateToken();
    const tokenDigest = await digestToken(rawToken);
    const expiresAt = new Date(dateMs(context.now) + SESSION_TTL_MS).toISOString();
    const completed = await this.options.store.completeTemporaryPasswordAndOpenSession({
      userId: user.id,
      restrictedSessionTokenDigest: actor.sessionId,
      previousLoginName: credential.loginName,
      loginName,
      passwordHash: await createPasswordHash(input.newPassword, this.passwordIterations),
      authRevision: credential.authRevision,
      now: context.now,
      tokenDigest,
      expiresAt,
      maximumSessions: MAX_SESSIONS_PER_USER,
      audit: createAuditEvent(context, {
        subjectType: "user_auth",
        subjectId: user.id,
        subjectLabel: user.displayName,
        action: "change_password",
      }),
    });
    if (completed === "login_name_taken") {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Login name already taken" });
    }
    if (completed !== "completed") {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Password-reset session is no longer valid" });
    }
    return this.sessionResult(user, rawToken, tokenDigest, expiresAt, false, context.now, "normal");
  }

  async createSessionForUserId(userId: string, now: string, expectedAuthRevision?: number): Promise<AuthSessionResult> {
    const [user, credential] = await Promise.all([
      this.options.store.findUser(userId),
      this.options.store.findCredentialRecord(userId),
    ]);
    if (!user || !credential || !user.isActive || user.deletedAt !== null || (
      expectedAuthRevision !== undefined && credential.authRevision !== expectedAuthRevision
    )) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication required" });
    }
    return this.createAuthenticatedSession(user, false, now, "normal", credential.authRevision);
  }

  private async createAuthenticatedSession(
    user: AuthUserRecord,
    stayLoggedIn: boolean,
    now: string,
    scope: "normal" | "password_change" = "normal",
    expectedAuthRevision?: number,
  ): Promise<AuthSessionResult> {
    const rawToken = this.generateToken();
    const tokenDigest = await digestToken(rawToken);
    const expiresAt = new Date(dateMs(now) + (scope === "password_change"
      ? PASSWORD_CHANGE_SESSION_TTL_MS
      : SESSION_TTL_MS)).toISOString();
    const credential = expectedAuthRevision === undefined
      ? await this.options.store.findCredentialRecord(user.id)
      : null;
    const authRevision = expectedAuthRevision ?? credential?.authRevision;
    if (authRevision === undefined) this.throwAuthenticationStateChanged();
    const opened = await this.options.store.openUserSession({
      userId: user.id,
      tokenDigest,
      expiresAt,
      createdAt: now,
      maximumSessions: MAX_SESSIONS_PER_USER,
      scope,
      expectedAuthRevision: authRevision,
    });
    if (!opened) this.throwAuthenticationStateChanged();
    return this.sessionResult(user, rawToken, tokenDigest, expiresAt, stayLoggedIn, now, scope);
  }

  private async sessionResult(
    user: AuthUserRecord,
    rawToken: string,
    tokenDigest: string,
    expiresAt: string,
    stayLoggedIn: boolean,
    lastLoginAt: string,
    scope: "normal" | "password_change",
  ): Promise<AuthSessionResult> {
    return {
      /* user 是发会话之前读出来的，它的 lastLoginAt 还是上一次的值。这次登录的时刻
         刚由上面那一批写进去，直接带上，省一次回查也不会自相矛盾。 */
      user: { ...user, lastLoginAt },
      profile: requireProfile(await this.options.profiles.readOwnProfile(user.id)),
      session: { rawToken, tokenDigest, expiresAt, stayLoggedIn, scope },
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

  private throwAuthenticationStateChanged(): never {
    throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication state changed" });
  }

  private async consumeLoginRateLimit(clientIdentifier: string | undefined, normalizedLoginName: string): Promise<void> {
    if (!this.options.loginIpRateLimiter && !this.options.loginNameRateLimiter) return;
    const client = clientIdentifier?.trim();
    if (!client) throw new TypeError("Login rate-limit client identifier is required");
    const ipDecision = await this.options.loginIpRateLimiter?.consume(`auth:login:ip:${encodeURIComponent(client)}`);
    if (ipDecision && !ipDecision.allowed) {
      throw new AppError({
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many authentication requests",
        details: { retry_after_seconds: ipDecision.retryAfterSeconds ?? 1 },
      });
    }
    const loginNameDecision = await this.options.loginNameRateLimiter?.consume(
      `auth:login:name:${encodeURIComponent(client)}:${encodeURIComponent(normalizedLoginName)}`,
    );
    if (loginNameDecision && !loginNameDecision.allowed) {
      throw new AppError({
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many authentication requests",
        details: { retry_after_seconds: loginNameDecision.retryAfterSeconds ?? 1 },
      });
    }
  }

  private signalInboxChanged(): void {
    const { deferred, notifications } = this.options;
    if (!deferred || !notifications) return;
    deferred.defer(() => notifications.publish({ type: "inbox_changed" }));
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
