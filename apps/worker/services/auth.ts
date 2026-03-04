import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { nanoid } from "nanoid";
import { sessions, users } from "../db/schema";
import type { Bindings } from "../index";

export type SessionUserRole = "admin" | "moderator" | "member";
export type SessionUser = { id: string; role: SessionUserRole };

type ResolvedSession = {
  sessionId: string;
  expiresAt: string;
  user: SessionUser;
};

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_KEY_LENGTH_BITS = 256;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH = "SHA-256";

const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TTL_MS = THIRTY_DAYS_IN_SECONDS * 1000;

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
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

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
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
    return timingSafeEqual(actualHashBytes, expectedHashBytes);
  } catch {
    return false;
  }
}

export async function createSession(
  c: Context,
  userId: string,
  options: { stayLoggedIn?: boolean } = {},
): Promise<{ sessionId: string; expiresAt: string }> {
  const db = getDb(c);
  const sessionId = nanoid();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const stayLoggedIn = options.stayLoggedIn === true;

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  setSessionCookies(c, sessionId, {
    expiresAt,
    stayLoggedIn,
  });

  return { sessionId, expiresAt };
}

export async function resolveSession(c: Context): Promise<ResolvedSession | null> {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (!sessionId) {
    return null;
  }

  const db = getDb(c);
  const row = (
    await db
      .select({
        sessionId: sessions.id,
        expiresAt: sessions.expiresAt,
        userId: users.id,
        role: users.role,
        isActive: users.isActive,
        deletedAt: users.deletedAt,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, sessionId))
      .limit(1)
  )[0];

  if (!row) {
    clearSessionCookie(c);
    return null;
  }

  const expiresAtMs = Date.parse(row.expiresAt);
  const isExpired = Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now();
  const isUserInvalid = !row.isActive || row.deletedAt !== null;

  if (isExpired || isUserInvalid) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    clearSessionCookie(c);
    return null;
  }

  const stayLoggedIn = getCookie(c, SESSION_MODE_COOKIE_NAME) === "1";
  const nextExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.update(sessions).set({ expiresAt: nextExpiresAt }).where(eq(sessions.id, row.sessionId));
  setSessionCookies(c, row.sessionId, {
    expiresAt: nextExpiresAt,
    stayLoggedIn,
  });

  return {
    sessionId: row.sessionId,
    expiresAt: nextExpiresAt,
    user: {
      id: row.userId,
      role: row.role,
    },
  };
}

export async function destroySession(c: Context, sessionId?: string): Promise<void> {
  const targetSessionId = sessionId ?? getCookie(c, SESSION_COOKIE_NAME);
  if (targetSessionId) {
    const db = getDb(c);
    await db.delete(sessions).where(eq(sessions.id, targetSessionId));
  }
  clearSessionCookie(c);
}
