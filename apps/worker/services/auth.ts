import {
  PERMISSIONS,
  type Permission,
  type RoleId,
} from "@guild/shared";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { nanoid } from "nanoid";
import { rolePermissions, roles, sessions, users } from "../db/schema";
import type { Bindings } from "../index";
import { logger } from "../utils/logger";

const RESOLVED_SESSION_PROMISE = Symbol("resolved_session_promise");

type ContextWithSessionCache = Context & {
  [RESOLVED_SESSION_PROMISE]?: Promise<ResolvedSession | null>;
};

export type SessionUser = {
  id: string;
  roleId: RoleId;
  role: string;
  roleName: string;
  roleColor: string | null;
  roleLevel: number;
  permissions: ReadonlySet<Permission>;
};

type ResolvedSession = {
  sessionId: string;
  expiresAt: string;
  user: SessionUser;
};

const PBKDF2_ITERATIONS = 600_000;
const PASSWORD_HASH_PREFIX = "pbkdf2-sha256";
const PBKDF2_KEY_LENGTH_BITS = 256;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH = "SHA-256";

const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TTL_MS = THIRTY_DAYS_IN_SECONDS * 1000;
const MAX_ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "ig_session";
export const SESSION_MODE_COOKIE_NAME = "ig_session_mode";

const textEncoder = new TextEncoder();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function isSecureRequest(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:";
}

function buildPermissionSet(
  permissionRows: Array<{ permission: string; granted: boolean } | null>,
): ReadonlySet<Permission> {
  const perms = new Set<Permission>();

  for (const row of permissionRows) {
    if (row === null) continue;
    if (!(PERMISSIONS as readonly string[]).includes(row.permission)) continue;
    const p = row.permission as Permission;
    if (row.granted) perms.add(p);
  }

  return perms;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function timingSafeEqual(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  const hashA = new Uint8Array(await crypto.subtle.digest("SHA-256", a as unknown as ArrayBuffer));
  const hashB = new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as ArrayBuffer));
  let diff = 0;
  for (let index = 0; index < hashA.length; index += 1) {
    diff |= hashA[index]! ^ hashB[index]!;
  }
  return diff === 0;
}

async function derivePasswordHash(password: string, saltBytes: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes as unknown as BufferSource,
      iterations,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH_BITS,
  );

  return new Uint8Array(bits);
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(c),
  });
  deleteCookie(c, SESSION_MODE_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(c),
  });
}

function setSessionCookies(
  c: Context,
  sessionId: string,
  options: { expiresAt: string; stayLoggedIn: boolean },
): void {
  const cookieOptions = {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax" as const,
    path: "/",
  };

  const persistentCookie = {
    ...cookieOptions,
    maxAge: THIRTY_DAYS_IN_SECONDS,
    expires: new Date(options.expiresAt),
  };

  if (options.stayLoggedIn) {
    setCookie(c, SESSION_COOKIE_NAME, sessionId, persistentCookie);
    setCookie(c, SESSION_MODE_COOKIE_NAME, "1", persistentCookie);
    return;
  }

  setCookie(c, SESSION_COOKIE_NAME, sessionId, cookieOptions);
  setCookie(c, SESSION_MODE_COOKIE_NAME, "0", cookieOptions);
}

export async function createPasswordHash(password: string): Promise<{ passwordHash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const hashBytes = await derivePasswordHash(password, saltBytes, PBKDF2_ITERATIONS);

  return {
    passwordHash: `${PASSWORD_HASH_PREFIX}$${PBKDF2_ITERATIONS}$${bytesToBase64(hashBytes)}`,
    salt: bytesToBase64(saltBytes),
  };
}

function parsePasswordHash(passwordHash: string): string | null {
  const match = /^pbkdf2-sha256\$600000\$([A-Za-z0-9+/]+=*)$/.exec(passwordHash);
  return match?.[1] ?? null;
}

export async function verifyPassword(password: string, salt: string, passwordHash: string): Promise<boolean> {
  try {
    const encodedHash = parsePasswordHash(passwordHash);
    if (!encodedHash) return false;
    const saltBytes = base64ToBytes(salt);
    const expectedHashBytes = base64ToBytes(encodedHash);
    if (saltBytes.length !== PBKDF2_SALT_BYTES || expectedHashBytes.length !== PBKDF2_KEY_LENGTH_BITS / 8) return false;
    const actualHashBytes = await derivePasswordHash(password, saltBytes, PBKDF2_ITERATIONS);
    return await timingSafeEqual(actualHashBytes, expectedHashBytes);
  } catch (error) {
    logger.error("Password verification failed with unexpected error", { error: String(error) });
    return false;
  }
}

async function hashSessionToken(token: string): Promise<string> {
  const data = textEncoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return bytesToBase64(new Uint8Array(hash));
}

export async function createSession(
  c: Context,
  userId: string,
  options: { stayLoggedIn?: boolean } = {},
): Promise<{ sessionId: string; expiresAt: string }> {
  const db = getDb(c);
  const rawToken = nanoid();
  const hashedToken = await hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const stayLoggedIn = options.stayLoggedIn === true;

  await db.insert(sessions).values({
    id: hashedToken,
    userId,
    expiresAt,
  });

  setSessionCookies(c, rawToken, {
    expiresAt,
    stayLoggedIn,
  });

  return { sessionId: hashedToken, expiresAt };
}

export async function resolveSession(c: Context): Promise<ResolvedSession | null> {
  const carrier = c as ContextWithSessionCache;
  carrier[RESOLVED_SESSION_PROMISE] ??= resolveSessionUncached(c);
  return await carrier[RESOLVED_SESSION_PROMISE];
}

async function resolveSessionUncached(c: Context): Promise<ResolvedSession | null> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (!rawToken) {
    return null;
  }

  const hashedToken = await hashSessionToken(rawToken);
  const db = getDb(c);

  // Single query: JOIN sessions → users → roles → role_permissions.
  // Returns one row per permission (or one row with null permission if the role
  // has no entries). All session/user columns are identical across rows.
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      sessionCreatedAt: sessions.createdAt,
      userId: users.id,
      roleId: users.role,
      roleName: roles.name,
      roleColor: roles.color,
      roleLevel: roles.level,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
      permission: rolePermissions.permission,
      granted: rolePermissions.granted,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(roles, eq(users.role, roles.id))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, users.role))
    .where(eq(sessions.id, hashedToken));

  if (rows.length === 0) {
    clearSessionCookie(c);
    return null;
  }

  // All rows share the same session/user data — take it from the first row.
  const first = rows[0]!;

  const expiresAtMs = Date.parse(first.expiresAt);
  const createdAtMs = Date.parse(first.sessionCreatedAt);
  const isExpired = Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now();
  const isAbsoluteExpired = !Number.isNaN(createdAtMs) && Date.now() - createdAtMs > MAX_ABSOLUTE_SESSION_MS;
  const isUserInvalid = !first.isActive || first.deletedAt !== null;

  if (isExpired || isAbsoluteExpired || isUserInvalid) {
    await db.delete(sessions).where(eq(sessions.id, first.sessionId));
    clearSessionCookie(c);
    return null;
  }

  const user: SessionUser = {
    id: first.userId,
    roleId: first.roleId,
    role: first.roleId,
    roleName: first.roleName,
    roleColor: first.roleColor,
    roleLevel: first.roleLevel,
    permissions: buildPermissionSet(rows.map((r) => (r.permission !== null ? { permission: r.permission, granted: r.granted ?? false } : null))),
  };

  const stayLoggedIn = getCookie(c, SESSION_MODE_COOKIE_NAME) === "1";
  const remainingMs = expiresAtMs - Date.now();
  const renewalThresholdMs = SESSION_TTL_MS * 0.5;

  if (remainingMs < renewalThresholdMs) {
    const nextExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await db.update(sessions).set({ expiresAt: nextExpiresAt }).where(eq(sessions.id, first.sessionId));
    setSessionCookies(c, rawToken, {
      expiresAt: nextExpiresAt,
      stayLoggedIn,
    });

    return {
      sessionId: first.sessionId,
      expiresAt: nextExpiresAt,
      user,
    };
  }

  return {
    sessionId: first.sessionId,
    expiresAt: first.expiresAt,
    user,
  };
}

/**
 * Session validity check with no request context, for the WebSocket Durable
 * Object: a socket can stay open for hours, so without this a logout, an admin
 * password reset, or a deactivation would leave the push channel alive.
 *
 * Applies exactly the checks `resolveSessionUncached` applies — row present,
 * sliding TTL, 90-day absolute cap, user still active — and nothing else: it
 * does not renew the TTL (the socket is not a user action) and it does not
 * delete the row (the next HTTP request does that, with the cookie to clear).
 *
 * Takes the raw D1 binding rather than a Drizzle handle because the DO has no
 * Hono context to build one from.
 */
export async function isSessionStillValid(db: D1Database, sessionId: string, nowMs: number): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT s.expires_at AS expiresAt, s.created_at AS createdAt, u.is_active AS isActive, u.deleted_at AS deletedAt" +
        " FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?1",
    )
    .bind(sessionId)
    .first<{ expiresAt: string; createdAt: string; isActive: number | boolean; deletedAt: string | null }>();
  if (!row) return false;

  const expiresAtMs = Date.parse(row.expiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs) return false;

  const createdAtMs = Date.parse(row.createdAt);
  if (!Number.isNaN(createdAtMs) && nowMs - createdAtMs > MAX_ABSOLUTE_SESSION_MS) return false;

  // Raw D1 returns SQLite's 0/1 for the boolean column, not a JS boolean.
  return Boolean(row.isActive) && row.deletedAt === null;
}

export async function destroySession(c: Context): Promise<void> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (rawToken) {
    const db = getDb(c);
    const hashed = await hashSessionToken(rawToken);
    await db.delete(sessions).where(eq(sessions.id, hashed));
  }
  clearSessionCookie(c);
}

export async function destroySessionById(c: Context, sessionId: string): Promise<void> {
  const db = getDb(c);
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  clearSessionCookie(c);
}

/**
 * Concurrent sessions allowed per user (phone + desktop + one spare).
 *
 * Compile-time constant, not site config: raising it is a security decision,
 * and `admin.siteConfig.manage` is a different permission from the auth ones.
 */
export const MAX_SESSIONS_PER_USER = 3;

/**
 * Evicts the oldest sessions so a new one can be inserted without exceeding
 * `MAX_SESSIONS_PER_USER`, and clears sliding-expired rows in the same pass
 * (nothing else prunes them).
 *
 * The 4th login evicts rather than being refused: a refusal would strand a user
 * who closed three browsers without logging out until the 30-day TTL ran down.
 */
export async function enforceSessionLimit(c: Context, userId: string): Promise<void> {
  const db = getDb(c);
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date().toISOString())));

  // Newest first, so `slice` keeps the most recently created sessions.
  const live = await db.select({ id: sessions.id }).from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt));
  const excess = live.slice(MAX_SESSIONS_PER_USER - 1).map((row) => row.id);
  if (excess.length === 0) return;
  await db.delete(sessions).where(inArray(sessions.id, excess));
}
