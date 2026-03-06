import {
  ERROR_STATUS,
  loginSchema,
  memberProfileSchema,
  registerSchema,
  type ErrorCode,
  type StandardErrorResponse,
  userSchema,
} from "@guild/shared";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { inviteLinks, memberProfiles, userAuthPassword, users } from "../db/schema";
import type { Bindings } from "../index";
import { createPasswordHash, createSession, destroySession, resolveSession, verifyPassword } from "../services/auth";

type UserRow = {
  id: string;
  username: string;
  role: "admin" | "moderator" | "member";
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProfileRow = {
  id: string;
  userId: string;
  wechatName: string | null;
  power: number;
  classes: string;
  titleHtml: string | null;
  bio: string | null;
  images: string;
  audioKey: string | null;
  videoUrls: string;
  availability: string | null;
  vacationStart: string | null;
  vacationEnd: string | null;
  discordId: string | null;
  discordReminderOptOut: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

export const authRoutes = new Hono();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function buildError(c: Context, errorCode: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: errorCode,
    message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return c.json(body, ERROR_STATUS[errorCode] as ErrorStatusCode);
}

function invalidCredentials(c: Context): Response {
  return buildError(c, "UNAUTHORIZED", "Invalid credentials");
}

function parseStringArray(jsonValue: string): string[] {
  try {
    const parsed = JSON.parse(jsonValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseRecord(jsonValue: string | null): Record<string, unknown> | null {
  if (!jsonValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonValue) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function toUserPayload(user: UserRow) {
  return userSchema.parse({
    id: user.id,
    username: user.username,
    role: user.role,
    is_active: user.isActive,
    deleted_at: user.deletedAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  });
}

function toProfilePayload(profile: ProfileRow) {
  return memberProfileSchema.parse({
    id: profile.id,
    user_id: profile.userId,
    wechat_name: profile.wechatName,
    power: profile.power,
    classes: parseStringArray(profile.classes),
    title_html: profile.titleHtml,
    bio: profile.bio,
    images: parseStringArray(profile.images),
    audio_key: profile.audioKey,
    video_urls: parseStringArray(profile.videoUrls),
    availability: parseRecord(profile.availability),
    vacation_start: profile.vacationStart,
    vacation_end: profile.vacationEnd,
    discord_id: profile.discordId,
    discord_reminder_opt_out: profile.discordReminderOptOut,
    notes: profile.notes,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  });
}

async function getProfileByUserId(c: Context, userId: string): Promise<ProfileRow | null> {
  const db = getDb(c);
  return (
    await db
      .select({
        id: memberProfiles.id,
        userId: memberProfiles.userId,
        wechatName: memberProfiles.wechatName,
        power: memberProfiles.power,
        classes: memberProfiles.classes,
        titleHtml: memberProfiles.titleHtml,
        bio: memberProfiles.bio,
        images: memberProfiles.images,
        audioKey: memberProfiles.audioKey,
        videoUrls: memberProfiles.videoUrls,
        availability: memberProfiles.availability,
        vacationStart: memberProfiles.vacationStart,
        vacationEnd: memberProfiles.vacationEnd,
        discordId: memberProfiles.discordId,
        discordReminderOptOut: memberProfiles.discordReminderOptOut,
        notes: memberProfiles.notes,
        createdAt: memberProfiles.createdAt,
        updatedAt: memberProfiles.updatedAt,
      })
      .from(memberProfiles)
      .where(eq(memberProfiles.userId, userId))
      .limit(1)
  )[0] ?? null;
}

async function ensureProfile(c: Context, userId: string): Promise<ProfileRow> {
  const db = getDb(c);
  const existing = await getProfileByUserId(c, userId);
  if (existing) {
    return existing;
  }

  await db.insert(memberProfiles).values({
    id: nanoid(),
    userId,
    power: 0,
    classes: "[]",
    images: "[]",
    videoUrls: "[]",
    discordReminderOptOut: false,
  });

  const created = await getProfileByUserId(c, userId);
  if (!created) {
    throw new Error("Failed to create member profile");
  }
  return created;
}

authRoutes.post("/login", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsedBody = loginSchema.safeParse(body);
  if (!parsedBody.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid login payload", parsedBody.error.flatten());
  }

  const bodyRecord = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const stayLoggedInRaw = bodyRecord.stay_logged_in ?? bodyRecord.stayLoggedIn;
  const stayLoggedIn = typeof stayLoggedInRaw === "boolean" ? stayLoggedInRaw : false;

  const db = getDb(c);
  const account = (
    await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
        deletedAt: users.deletedAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        passwordHash: userAuthPassword.passwordHash,
        salt: userAuthPassword.salt,
      })
      .from(users)
      .innerJoin(userAuthPassword, eq(users.id, userAuthPassword.userId))
      .where(eq(users.username, parsedBody.data.username))
      .limit(1)
  )[0];

  if (!account || !account.isActive || account.deletedAt !== null) {
    return invalidCredentials(c);
  }

  const passwordValid = await verifyPassword(parsedBody.data.password, account.salt, account.passwordHash);
  if (!passwordValid) {
    return invalidCredentials(c);
  }

  await createSession(c, account.id, { stayLoggedIn });
  const profile = await ensureProfile(c, account.id);

  return c.json({
    user: toUserPayload(account),
    profile: toProfilePayload(profile),
  });
});

authRoutes.post("/logout", async (c) => {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return buildError(c, "UNAUTHORIZED", "Authentication required");
  }

  await destroySession(c, resolved.sessionId);
  return c.json({ ok: true });
});

authRoutes.get("/check-username", async (c) => {
  const username = (c.req.query("username") ?? "").trim();
  if (!/^[a-zA-Z0-9_]{3,50}$/.test(username)) {
    return c.json({
      available: false,
      reason: "invalid_format",
    });
  }

  const db = getDb(c);
  const existing = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1)
  )[0];

  return c.json({
    available: !existing,
  });
});

authRoutes.post("/register/:inviteCode", async (c) => {
  const inviteCode = c.req.param("inviteCode");
  if (!inviteCode) {
    return buildError(c, "VALIDATION_ERROR", "Missing invite code");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsedBody = registerSchema.safeParse(body);
  if (!parsedBody.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid registration payload", parsedBody.error.flatten());
  }

  const nowIso = new Date().toISOString();
  const db = getDb(c);

  const invite = (
    await db
      .select({
        id: inviteLinks.id,
        maxUses: inviteLinks.maxUses,
        usedCount: inviteLinks.usedCount,
        expiresAt: inviteLinks.expiresAt,
        revokedAt: inviteLinks.revokedAt,
      })
      .from(inviteLinks)
      .where(eq(inviteLinks.code, inviteCode))
      .limit(1)
  )[0];

  const inviteInvalid =
    !invite ||
    invite.revokedAt !== null ||
    invite.usedCount >= invite.maxUses ||
    (invite.expiresAt !== null && invite.expiresAt <= nowIso);

  if (inviteInvalid) {
    return buildError(c, "CONFLICT", "This invite link is no longer valid");
  }

  const existing = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, parsedBody.data.username))
      .limit(1)
  )[0];
  if (existing) {
    return buildError(c, "CONFLICT", "Username already taken");
  }

  const userId = nanoid();
  const passwordRecord = await createPasswordHash(parsedBody.data.password);

  try {
    await db.insert(users).values({
      id: userId,
      username: parsedBody.data.username,
      role: "member",
      isActive: true,
    });
    await db.insert(userAuthPassword).values({
      userId,
      passwordHash: passwordRecord.passwordHash,
      salt: passwordRecord.salt,
    });
    await db.insert(memberProfiles).values({
      id: nanoid(),
      userId,
      power: 0,
      classes: "[]",
      images: "[]",
      videoUrls: "[]",
      discordReminderOptOut: false,
    });
    await db
      .update(inviteLinks)
      .set({ usedCount: sql`${inviteLinks.usedCount} + 1` })
      .where(and(eq(inviteLinks.id, invite.id), eq(inviteLinks.usedCount, invite.usedCount)));
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.username")) {
      return buildError(c, "CONFLICT", "Username already taken");
    }
    throw error;
  }

  const createdUser = (
    await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
        deletedAt: users.deletedAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];

  if (!createdUser) {
    return buildError(c, "SERVER_ERROR", "Failed to load created user");
  }

  await createSession(c, userId);
  return c.json({ user: toUserPayload(createdUser) }, 201);
});

authRoutes.get("/me", async (c) => {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return buildError(c, "UNAUTHORIZED", "Authentication required");
  }

  const db = getDb(c);
  const currentUser = (
    await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
        deletedAt: users.deletedAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, resolved.user.id))
      .limit(1)
  )[0];

  if (!currentUser || !currentUser.isActive || currentUser.deletedAt !== null) {
    await destroySession(c);
    return buildError(c, "UNAUTHORIZED", "Authentication required");
  }

  const profile = await ensureProfile(c, currentUser.id);
  return c.json({
    user: toUserPayload(currentUser),
    profile: toProfilePayload(profile),
  });
});
