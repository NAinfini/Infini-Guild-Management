import {
  PERMISSIONS,
  type Permission,
  type RoleId,
} from "@guild/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { nanoid } from "nanoid";
import { rolePermissions, sessions, users } from "../db/schema";
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
  permissions: ReadonlySet<Permission>;
};

type ResolvedSession = {
  sessionId: string;
  expiresAt: string;
  user: SessionUser;
};

// Cloudflare Workers caps PBKDF2 at 10,000 iterations (runtime limit).
const PBKDF2_ITERATIONS = 10_000;
const PBKDF2_KEY_LENGTH_BITS = 256;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH = "SHA-256";

const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TTL_MS = THIRTY_DAYS_IN_SECONDS * 1000;
const MAX_ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "ig_session";
export const SESSION_MODE_COOKIE_NAME = "ig_session_mode";

const textEncoder = new TextEncoder();

/**
 * No-op stubs kept for backward compatibility with AdminService callers.
 * Permissions are now always-fresh via the joined session query, so the
 * per-isolate cache no longer exists.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function clearPermissionCache(_roleId?: RoleId): void {
  // no-op — permissions are fetched fresh on every session resolution
}

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

async function derivePasswordHash(password: string, saltBytes: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH_BITS,
  );

  return new Uint8Array(bits);
}

function clearSessionCookie(c: Context): void {
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
  const hashBytes = await derivePasswordHash(password, saltBytes);

  return {
    passwordHash: bytesToBase64(hashBytes),
    salt: bytesToBase64(saltBytes),
  };
}

export async function verifyPassword(password: string, salt: string, passwordHash: string): Promise<boolean> {
  try {
    const saltBytes = base64ToBytes(salt);
    const expectedHashBytes = base64ToBytes(passwordHash);
    const actualHashBytes = await derivePasswordHash(password, saltBytes);
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

export async function resolveSession(c: Context, _options: { freshPermissions?: boolean } = {}): Promise<ResolvedSession | null> {
  // freshPermissions is now a no-op: the joined query is always fresh.
  // Both fresh and non-fresh paths share the same per-request dedup cache.
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

  // Single query: JOIN sessions → users → role_permissions.
  // Returns one row per permission (or one row with null permission if the role
  // has no entries). All session/user columns are identical across rows.
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      sessionCreatedAt: sessions.createdAt,
      userId: users.id,
      roleId: users.role,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
      permission: rolePermissions.permission,
      granted: rolePermissions.granted,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
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

export async function destroySession(c: Context, sessionId?: string): Promise<void> {
  const rawToken = sessionId ?? getCookie(c, SESSION_COOKIE_NAME);
  if (rawToken) {
    const db = getDb(c);
    const hashed = await hashSessionToken(rawToken);
    await db.delete(sessions).where(eq(sessions.id, hashed));
  }
  clearSessionCookie(c);
}

export async function deleteUserSessions(c: Context, userId: string): Promise<void> {
  const db = getDb(c);
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
