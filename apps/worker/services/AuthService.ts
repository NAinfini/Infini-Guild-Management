import {
  PERMISSIONS,
  memberProfileSchema,
  permissionSetToRecord,
  userSchema,
  type Permission,
} from "@guild/shared";
import { SYSTEM_TEST_USERNAME_PREFIX, isReservedSystemTestUsername } from "@guild/shared/config/system-test";
import type { AuditEntityType, AuditAction } from "@guild/shared/constants/audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { memberProfiles, rolePermissions, userAuthPassword, users } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { parseStringArray, parseRecord, usernameEquals } from "./helpers";
import { clearLoginFailures, readLockout, recordLoginFailure } from "./login-lockout";
import { logger } from "../utils/logger";
import { passwordHashNeedsUpgrade } from "./auth";
import { loadMemberClasses, loadMemberImages } from "./ordered-relations";

// --- Types ---

type DrizzleDb = DrizzleD1Database<Record<string, never>>;

type UserRow = { id: string; username: string; role: string; isActive: boolean; deletedAt: string | null; createdAt: string; updatedAt: string };
type ProfileRow = { id: string; userId: string; power: number; classes: string[]; titleHtml: string | null; bio: string | null; avatarKey: string | null; images: string[]; audioKey: string | null; videoUrls: string; availability: string | null; vacationStart: string | null; vacationEnd: string | null; notes: string | null; createdAt: string; updatedAt: string };

export type AuthServiceDeps = {
  rawDb: D1Database;
  createPasswordHash: (password: string) => Promise<{ passwordHash: string; salt: string }>;
  verifyPassword: (password: string, salt: string, hash: string) => Promise<boolean>;
  createSession: (userId: string, opts?: { stayLoggedIn?: boolean }) => Promise<void>;
  destroySessionById: (sessionId: string) => Promise<void>;
  enforceSessionLimit: (userId: string) => Promise<void>;
  publishEntityChanged?: (input: { entityType: PushEntityType; entityId: string; hint: PushHint; displayName?: string }) => Promise<void>;
  writeAuditLog: (input: { entityType: AuditEntityType; action: AuditAction; actorId: string; entityId: string; diffTitle?: string | null; detailText?: string | null }) => Promise<void>;
  now?: () => Date;
};

// --- Helpers ---

function toUserPayload(user: UserRow, extra?: { permissions: Record<Permission, boolean> }) {
  const result = userSchema.safeParse({
    id: user.id,
    username: user.username,
    role: user.role,
    permissions: extra?.permissions ?? Object.fromEntries(PERMISSIONS.map((p) => [p, false])),
    is_active: user.isActive,
    deleted_at: user.deletedAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  });
  if (!result.success) {
    throw new Error(`Invalid user data for id=${user.id}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

function toProfilePayload(profile: ProfileRow) {
  const result = memberProfileSchema.safeParse({
    id: profile.id, user_id: profile.userId, power: profile.power,
    classes: profile.classes, title_html: profile.titleHtml, bio: profile.bio,
    avatar_key: profile.avatarKey ?? null, images: profile.images, audio_key: profile.audioKey, video_urls: parseStringArray(profile.videoUrls),
    availability: parseRecord(profile.availability), vacation_start: profile.vacationStart, vacation_end: profile.vacationEnd,
    notes: profile.notes,
    created_at: profile.createdAt, updated_at: profile.updatedAt,
  });
  if (!result.success) {
    throw new Error(`Invalid profile data for user_id=${profile.userId}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

const USER_COLS = { id: users.id, username: users.username, role: users.role, isActive: users.isActive, deletedAt: users.deletedAt, createdAt: users.createdAt, updatedAt: users.updatedAt } as const;
// vacation_start/vacation_end are derived from the absence history (current-or-next absence).
const PROFILE_COLS = { id: memberProfiles.id, userId: memberProfiles.userId, power: memberProfiles.power, titleHtml: memberProfiles.titleHtml, bio: memberProfiles.bio, avatarKey: memberProfiles.avatarKey, audioKey: memberProfiles.audioKey, videoUrls: memberProfiles.videoUrls, availability: memberProfiles.availability, vacationStart: sql<string | null>`(SELECT ma.start_date FROM member_absences ma WHERE ma.user_id = ${memberProfiles.userId} AND ma.end_date >= date('now') ORDER BY ma.start_date ASC LIMIT 1)`.as("derived_vacation_start"), vacationEnd: sql<string | null>`(SELECT ma.end_date FROM member_absences ma WHERE ma.user_id = ${memberProfiles.userId} AND ma.end_date >= date('now') ORDER BY ma.start_date ASC LIMIT 1)`.as("derived_vacation_end"), notes: memberProfiles.notes, createdAt: memberProfiles.createdAt, updatedAt: memberProfiles.updatedAt } as const;

// --- Service ---

export class AuthService {
  private db: DrizzleDb;
  private deps: AuthServiceDeps;

  constructor(db: DrizzleDb, deps: AuthServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  private async resolveUserPermissions(roleId: string): Promise<{ permissions: Record<Permission, boolean> }> {
    const perms = new Set<Permission>();
    const permRows = await this.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    for (const row of permRows) {
      if (!(PERMISSIONS as readonly string[]).includes(row.permission)) continue;
      const p = row.permission as Permission;
      if (row.granted) perms.add(p);
    }

    return { permissions: permissionSetToRecord(perms) };
  }

  private async getProfileByUserId(userId: string): Promise<ProfileRow | null> {
    const row = (await this.db.select(PROFILE_COLS).from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1))[0];
    if (!row) return null;
    const [classes, images] = await Promise.all([
      loadMemberClasses(this.deps.rawDb, [userId]),
      loadMemberImages(this.deps.rawDb, [userId]),
    ]);
    return { ...row, classes: classes.get(userId) ?? [], images: images.get(userId) ?? [] };
  }

  private async ensureProfile(userId: string): Promise<ProfileRow> {
    const existing = await this.getProfileByUserId(userId);
    if (existing) return existing;
    await this.db.insert(memberProfiles).values({ id: nanoid(), userId, power: 0, videoUrls: "[]" });
    const created = await this.getProfileByUserId(userId);
    if (!created) throw new Error("Failed to create member profile");
    return created;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private async upgradePasswordHash(userId: string, password: string, currentHash: string, now: Date): Promise<void> {
    if (!passwordHashNeedsUpgrade(currentHash)) return;
    try {
      const upgraded = await this.deps.createPasswordHash(password);
      await this.deps.rawDb.prepare(
        "UPDATE user_auth_password SET password_hash = ?, salt = ?, updated_at = ? WHERE user_id = ?",
      ).bind(upgraded.passwordHash, upgraded.salt, now.toISOString(), userId).run();
    } catch (error) {
      // Hash migration is opportunistic. A transient D1 write failure should
      // not reject credentials that were already verified successfully.
      logger.error("Password hash upgrade failed", { userId, error: String(error) });
    }
  }

  /**
   * Records a failed attempt on the lockout ladder, and audits it when the
   * username belongs to a real account.
   *
   * The audit row is skipped for unknown usernames on purpose: `audit_log.actor_id`
   * is a NOT NULL foreign key to `users.id`, and auditing arbitrary
   * attacker-supplied usernames would let anyone grow the table without bound.
   * Unknown usernames are still recorded on the ladder (see login-lockout.ts) so
   * the response stays identical either way. `actorId` is the *targeted*
   * account — the real actor is unauthenticated and therefore unknown.
   *
   * `password` is never passed in here, let alone stored.
   */
  private async registerLoginFailure(
    attemptedUsername: string,
    account: { id: string; username: string } | null,
    reason: "unknown_or_inactive_account" | "wrong_password",
    clientIp: string | null,
    now: Date,
  ): Promise<void> {
    const lock = await recordLoginFailure(this.db, attemptedUsername, now);
    logger.warn("Login failed", { username: attemptedUsername, reason, failCount: lock.failCount });
    if (!account) return;
    await this.deps.writeAuditLog({
      entityType: "user_auth",
      action: "login_failed",
      actorId: account.id,
      entityId: account.id,
      diffTitle: account.username,
      detailText: JSON.stringify({
        reason,
        client_ip: clientIp,
        fail_count: lock.failCount,
        locked_for_seconds: lock.retryAfterSeconds,
      }),
    });
  }

  async login(username: string, password: string, stayLoggedIn: boolean, clientIp: string | null = null): Promise<ServiceResult<{ user: unknown; profile: unknown }>> {
    const now = this.now();
    const attempted = username.trim();

    // Checked before the account lookup and before any key derivation: a locked
    // username costs nothing, and attempts made during the lock are ignored
    // rather than counted, so they cannot extend it.
    const activeLock = await readLockout(this.db, attempted, now);
    if (activeLock) {
      return err(
        "RATE_LIMITED",
        `Too many failed login attempts. This account is locked for another ${activeLock.retryAfterSeconds} seconds; passwords entered before then are not checked and do not extend the lock.`,
        { retry_after_seconds: activeLock.retryAfterSeconds },
      );
    }

    const account = (await this.db.select({ ...USER_COLS, passwordHash: userAuthPassword.passwordHash, salt: userAuthPassword.salt }).from(users).innerJoin(userAuthPassword, eq(users.id, userAuthPassword.userId)).where(usernameEquals(username)).limit(1))[0];
    if (!account || !account.isActive || account.deletedAt !== null) {
      // Run password derivation with a dummy salt to prevent timing-based username enumeration
      await this.deps.verifyPassword(password, "AAAAAAAAAAAAAAAAAAAAAA==", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
      await this.registerLoginFailure(attempted, account ? { id: account.id, username: account.username } : null, "unknown_or_inactive_account", clientIp, now);
      return err("UNAUTHORIZED", "Invalid credentials");
    }
    const valid = await this.deps.verifyPassword(password, account.salt, account.passwordHash);
    if (!valid) {
      await this.registerLoginFailure(attempted, { id: account.id, username: account.username }, "wrong_password", clientIp, now);
      return err("UNAUTHORIZED", "Invalid credentials");
    }
    await this.upgradePasswordHash(account.id, password, account.passwordHash, now);
    // Correct password resets the ladder, so a run of typos never accumulates.
    await clearLoginFailures(this.db, attempted);
    // Keeps at most MAX_SESSIONS_PER_USER logins alive; the oldest is evicted.
    await this.deps.enforceSessionLimit(account.id);
    await this.deps.createSession(account.id, { stayLoggedIn });
    const profile = await this.ensureProfile(account.id);
    const extra = await this.resolveUserPermissions(account.role);
    return ok({ user: toUserPayload(account, extra), profile: toProfilePayload(profile) });
  }

  async logout(sessionId: string): Promise<ServiceResult<{ ok: true }>> {
    await this.deps.destroySessionById(sessionId);
    return ok({ ok: true });
  }

  async checkUsername(username: string): Promise<ServiceResult<{ available: boolean; reason?: string }>> {
    if (!/^[a-zA-Z0-9_一-鿿]{1,50}$/.test(username)) return ok({ available: false, reason: "invalid_format" });
    if (isReservedSystemTestUsername(username)) return ok({ available: false, reason: "reserved_prefix" });
    const existing = (await this.db.select({ id: users.id }).from(users).where(usernameEquals(username)).limit(1))[0];
    return ok({ available: !existing });
  }

  async verifyInvite(code: string): Promise<ServiceResult<{ valid: boolean }>> {
    if (!code) return ok({ valid: false });
    const nowIso = new Date().toISOString();
    const row = (await this.deps.rawDb.prepare(
      `SELECT id FROM invite_links WHERE code = ? AND revoked_at IS NULL AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?)`,
    ).bind(code, nowIso).all()).results[0];
    return ok({ valid: Boolean(row) });
  }

  async register(inviteCode: string, username: string, password: string): Promise<ServiceResult<{ user: unknown; profile: unknown }>> {
    if (isReservedSystemTestUsername(username)) {
      return err("VALIDATION_ERROR", `Usernames beginning with "${SYSTEM_TEST_USERNAME_PREFIX}" are reserved`);
    }

    const nowIso = new Date().toISOString();
    const existing = (await this.db.select({ id: users.id }).from(users).where(usernameEquals(username)).limit(1))[0];
    if (existing) return err("CONFLICT", "Username already taken");

    const userId = nanoid();
    const profileId = nanoid();
    const passwordRecord = await this.deps.createPasswordHash(password);
    const rawDb = this.deps.rawDb;

    const redeemedInvite = await rawDb.prepare(
      `UPDATE invite_links SET used_count = used_count + 1 WHERE code = ? AND revoked_at IS NULL AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?) RETURNING id`,
    ).bind(inviteCode, nowIso).first<{ id: string }>();
    if (!redeemedInvite) return err("CONFLICT", "Invite link is no longer available");

    try {
      await rawDb.batch([
        rawDb.prepare(`INSERT INTO users (id, username, role, is_active) VALUES (?, ?, 'member', 1)`).bind(userId, username),
        rawDb.prepare(`INSERT INTO user_auth_password (user_id, password_hash, salt) VALUES (?, ?, ?)`).bind(userId, passwordRecord.passwordHash, passwordRecord.salt),
        rawDb.prepare(`INSERT INTO member_profiles (id, user_id, power, video_urls) VALUES (?, ?, 0, '[]')`).bind(profileId, userId),
      ]);
    } catch (error) {
      await rawDb.prepare(`UPDATE invite_links SET used_count = used_count - 1 WHERE code = ? AND used_count > 0`).bind(inviteCode).run();
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.username")) return err("CONFLICT", "Username already taken");
      throw error;
    }

    const createdUser = (await this.db.select(USER_COLS).from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!createdUser) return err("SERVER_ERROR", "Failed to load created user");
    const createdProfile = await this.getProfileByUserId(userId);
    if (!createdProfile) return err("SERVER_ERROR", "Failed to load created member profile");
    await this.deps.createSession(userId);
    await this.deps.writeAuditLog({ entityType: "user", action: "register", actorId: userId, entityId: userId, diffTitle: username, detailText: JSON.stringify({ invite_id: redeemedInvite.id }) });
    await this.deps.publishEntityChanged?.({ entityType: "member_profile", entityId: userId, hint: "member_joined", displayName: createdUser.username });
    const extra = await this.resolveUserPermissions("member");
    return ok({ user: toUserPayload(createdUser, extra), profile: toProfilePayload(createdProfile) });
  }

  async getMe(userId: string, sessionId: string): Promise<ServiceResult<{ user: unknown; profile: unknown }>> {
    const currentUser = (await this.db.select(USER_COLS).from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!currentUser || !currentUser.isActive || currentUser.deletedAt !== null) {
      logger.warn("Session invalid: user inactive or deleted", { userId });
      await this.deps.destroySessionById(sessionId);
      return err("UNAUTHORIZED", "Authentication required");
    }
    const profile = await this.ensureProfile(currentUser.id);
    const extra = await this.resolveUserPermissions(currentUser.role);
    return ok({ user: toUserPayload(currentUser, extra), profile: toProfilePayload(profile) });
  }
}
