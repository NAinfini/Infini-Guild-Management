import {
  MEMBER_DEFAULT_PERMISSIONS,
  MODERATOR_DEFAULT_PERMISSIONS,
  PERMISSIONS,
  memberProfileSchema,
  permissionSetToRecord,
  userSchema,
  type Permission,
} from "@guild/shared";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { memberProfiles, rolePermissions, userAuthPassword, users } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { parseStringArray, parseRecord } from "./helpers";

// --- Types ---

type DrizzleDb = DrizzleD1Database<Record<string, never>>;

type UserRow = { id: string; username: string; role: string; isActive: boolean; deletedAt: string | null; createdAt: string; updatedAt: string };
type ProfileRow = { id: string; userId: string; power: number; classes: string; titleHtml: string | null; bio: string | null; avatarKey: string | null; images: string; audioKey: string | null; videoUrls: string; availability: string | null; vacationStart: string | null; vacationEnd: string | null; notes: string | null; createdAt: string; updatedAt: string };

export type AuthServiceDeps = {
  rawDb: D1Database;
  createPasswordHash: (password: string) => Promise<{ passwordHash: string; salt: string }>;
  verifyPassword: (password: string, salt: string, hash: string) => Promise<boolean>;
  createSession: (userId: string, opts?: { stayLoggedIn?: boolean }) => Promise<void>;
  destroySession: (sessionId?: string) => Promise<void>;
};

// --- Helpers ---

function toUserPayload(user: UserRow, extra?: { permissions: Record<Permission, boolean> }) {
  return userSchema.parse({
    id: user.id,
    username: user.username,
    role: user.role,
    permissions: extra?.permissions ?? Object.fromEntries(PERMISSIONS.map((p) => [p, false])),
    is_active: user.isActive,
    deleted_at: user.deletedAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  });
}

function toProfilePayload(profile: ProfileRow) {
  return memberProfileSchema.parse({
    id: profile.id, user_id: profile.userId, power: profile.power,
    classes: parseStringArray(profile.classes), title_html: profile.titleHtml, bio: profile.bio,
    avatar_key: profile.avatarKey ?? null, images: parseStringArray(profile.images), audio_key: profile.audioKey, video_urls: parseStringArray(profile.videoUrls),
    availability: parseRecord(profile.availability), vacation_start: profile.vacationStart, vacation_end: profile.vacationEnd,
    notes: profile.notes,
    created_at: profile.createdAt, updated_at: profile.updatedAt,
  });
}

const USER_COLS = { id: users.id, username: users.username, role: users.role, isActive: users.isActive, deletedAt: users.deletedAt, createdAt: users.createdAt, updatedAt: users.updatedAt } as const;
const PROFILE_COLS = { id: memberProfiles.id, userId: memberProfiles.userId, power: memberProfiles.power, classes: memberProfiles.classes, titleHtml: memberProfiles.titleHtml, bio: memberProfiles.bio, avatarKey: memberProfiles.avatarKey, images: memberProfiles.images, audioKey: memberProfiles.audioKey, videoUrls: memberProfiles.videoUrls, availability: memberProfiles.availability, vacationStart: memberProfiles.vacationStart, vacationEnd: memberProfiles.vacationEnd, notes: memberProfiles.notes, createdAt: memberProfiles.createdAt, updatedAt: memberProfiles.updatedAt } as const;

// --- Service ---

export class AuthService {
  private db: DrizzleDb;
  private deps: AuthServiceDeps;

  constructor(db: DrizzleDb, deps: AuthServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  private async resolveUserPermissions(roleId: string): Promise<{ permissions: Record<Permission, boolean> }> {
    if (roleId === "admin") {
      return { permissions: Object.fromEntries(PERMISSIONS.map((p) => [p, true])) as Record<Permission, boolean> };
    }

    const defaults: ReadonlySet<Permission> = roleId === "moderator" ? MODERATOR_DEFAULT_PERMISSIONS : roleId === "member" ? MEMBER_DEFAULT_PERMISSIONS : new Set();
    const perms = new Set<Permission>(defaults);
    const permRows = await this.db.select({ permission: rolePermissions.permission, granted: rolePermissions.granted }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    for (const row of permRows) {
      if (!(PERMISSIONS as readonly string[]).includes(row.permission)) continue;
      const p = row.permission as Permission;
      if (row.granted) perms.add(p);
      else perms.delete(p);
    }

    return { permissions: permissionSetToRecord(perms) };
  }

  private async getProfileByUserId(userId: string): Promise<ProfileRow | null> {
    return (await this.db.select(PROFILE_COLS).from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1))[0] ?? null;
  }

  private async ensureProfile(userId: string): Promise<ProfileRow> {
    const existing = await this.getProfileByUserId(userId);
    if (existing) return existing;
    await this.db.insert(memberProfiles).values({ id: nanoid(), userId, power: 0, classes: "[]", images: "[]", videoUrls: "[]" });
    const created = await this.getProfileByUserId(userId);
    if (!created) throw new Error("Failed to create member profile");
    return created;
  }

  async login(username: string, password: string, stayLoggedIn: boolean): Promise<ServiceResult<{ user: unknown; profile: unknown }>> {
    const account = (await this.db.select({ ...USER_COLS, passwordHash: userAuthPassword.passwordHash, salt: userAuthPassword.salt }).from(users).innerJoin(userAuthPassword, eq(users.id, userAuthPassword.userId)).where(eq(users.username, username)).limit(1))[0];
    if (!account || !account.isActive || account.deletedAt !== null) return err("UNAUTHORIZED", "Invalid credentials");
    const valid = await this.deps.verifyPassword(password, account.salt, account.passwordHash);
    if (!valid) return err("UNAUTHORIZED", "Invalid credentials");
    await this.deps.createSession(account.id, { stayLoggedIn });
    const profile = await this.ensureProfile(account.id);
    const extra = await this.resolveUserPermissions(account.role);
    return ok({ user: toUserPayload(account, extra), profile: toProfilePayload(profile) });
  }

  async logout(sessionId: string): Promise<ServiceResult<{ ok: true }>> {
    await this.deps.destroySession(sessionId);
    return ok({ ok: true });
  }

  async checkUsername(username: string): Promise<ServiceResult<{ available: boolean; reason?: string }>> {
    if (!/^[a-zA-Z0-9_一-鿿]{1,50}$/.test(username)) return ok({ available: false, reason: "invalid_format" });
    const existing = (await this.db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1))[0];
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

  async register(inviteCode: string, username: string, password: string): Promise<ServiceResult<{ user: unknown }>> {
    const nowIso = new Date().toISOString();
    const existing = (await this.db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1))[0];
    if (existing) return err("CONFLICT", "Username already taken");

    const userId = nanoid();
    const profileId = nanoid();
    const passwordRecord = await this.deps.createPasswordHash(password);
    const rawDb = this.deps.rawDb;

    const inviteUpdateResult = await rawDb.prepare(
      `UPDATE invite_links SET used_count = used_count + 1 WHERE code = ? AND revoked_at IS NULL AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?)`,
    ).bind(inviteCode, nowIso).run();
    if ((inviteUpdateResult.meta?.changes ?? 0) === 0) return err("CONFLICT", "Invite link is no longer available");

    try {
      await rawDb.batch([
        rawDb.prepare(`INSERT INTO users (id, username, role, is_active) VALUES (?, ?, 'member', 1)`).bind(userId, username),
        rawDb.prepare(`INSERT INTO user_auth_password (user_id, password_hash, salt) VALUES (?, ?, ?)`).bind(userId, passwordRecord.passwordHash, passwordRecord.salt),
        rawDb.prepare(`INSERT INTO member_profiles (id, user_id, power, classes, images, video_urls) VALUES (?, ?, 0, '[]', '[]', '[]')`).bind(profileId, userId),
      ]);
    } catch (error) {
      await rawDb.prepare(`UPDATE invite_links SET used_count = used_count - 1 WHERE code = ? AND used_count > 0`).bind(inviteCode).run();
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.username")) return err("CONFLICT", "Username already taken");
      throw error;
    }

    const createdUser = (await this.db.select(USER_COLS).from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!createdUser) return err("SERVER_ERROR", "Failed to load created user");
    await this.deps.createSession(userId);
    const extra = await this.resolveUserPermissions("member");
    return ok({ user: toUserPayload(createdUser, extra) });
  }

  async getMe(userId: string, sessionId: string): Promise<ServiceResult<{ user: unknown; profile: unknown }>> {
    const currentUser = (await this.db.select(USER_COLS).from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!currentUser || !currentUser.isActive || currentUser.deletedAt !== null) {
      await this.deps.destroySession(sessionId);
      return err("UNAUTHORIZED", "Authentication required");
    }
    const profile = await this.ensureProfile(currentUser.id);
    const extra = await this.resolveUserPermissions(currentUser.role);
    return ok({ user: toUserPayload(currentUser, extra), profile: toProfilePayload(profile) });
  }
}
