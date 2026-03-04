import {
  ERROR_STATUS,
  FILE_SIZE_LIMITS,
  IMAGE_QUOTAS,
  changePasswordSchema,
  changeUsernameSchema,
  hasRoleAtLeast,
  memberProfileSchema,
  updateProfileSchema,
  userSchema,
  type ErrorCode,
  type Role,
  type StandardErrorResponse,
} from "@guild/shared";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { discordLinkCodes, memberProfiles, sessions, userAuthPassword, users } from "../db/schema";
import type { Bindings } from "../index";
import { createPasswordHash, destroySession, resolveSession, verifyPassword } from "../services/auth";
import { writeAuditLog } from "../services/audit";
import { deleteMediaObject, storeProfileAudio, storeProfileImage } from "../services/media";

type SessionUser = { id: string; role: Role };
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

type UserRow = {
  id: string;
  username: string;
  role: Role;
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

type UserWithProfileRow = {
  user: UserRow;
  profile: ProfileRow;
};

type ProfilePatch = {
  wechatName?: string | null;
  power?: number;
  classes?: string;
  titleHtml?: string | null;
  bio?: string | null;
  images?: string;
  audioKey?: string | null;
  videoUrls?: string;
  availability?: string | null;
  vacationStart?: string | null;
  vacationEnd?: string | null;
  discordReminderOptOut?: boolean;
  updatedAt?: string;
};

export const usersRoutes = new Hono();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: code,
    message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

async function requireSession(c: Context): Promise<SessionUser | Response> {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return buildError(c, "UNAUTHORIZED", "Authentication required");
  }
  return resolved.user;
}

async function canEditTarget(c: Context, sessionUser: SessionUser, targetUserId: string): Promise<boolean> {
  if (sessionUser.id === targetUserId) {
    return true;
  }

  if (sessionUser.role === "admin") {
    return true;
  }

  if (!hasRoleAtLeast(sessionUser.role, "moderator")) {
    return false;
  }

  const db = getDb(c);
  const target = (
    await db
      .select({
        role: users.role,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1)
  )[0];

  if (!target || target.deletedAt !== null) {
    return false;
  }

  return target.role !== "admin";
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseRecord(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
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

function toProfilePayload(
  profile: ProfileRow,
  options: { includeNotes: boolean; includeWechat: boolean },
) {
  return memberProfileSchema.parse({
    id: profile.id,
    user_id: profile.userId,
    wechat_name: options.includeWechat ? profile.wechatName : null,
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
    notes: options.includeNotes ? profile.notes : null,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  });
}

async function loadUserWithProfile(c: Context, userId: string): Promise<UserWithProfileRow | null> {
  const db = getDb(c);
  const row = (
    await db
      .select({
        userId: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
        deletedAt: users.deletedAt,
        userCreatedAt: users.createdAt,
        userUpdatedAt: users.updatedAt,
        profileId: memberProfiles.id,
        profileUserId: memberProfiles.userId,
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
        profileCreatedAt: memberProfiles.createdAt,
        profileUpdatedAt: memberProfiles.updatedAt,
      })
      .from(users)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)
  )[0];

  if (!row) {
    return null;
  }

  return {
    user: {
      id: row.userId,
      username: row.username,
      role: row.role,
      isActive: row.isActive,
      deletedAt: row.deletedAt,
      createdAt: row.userCreatedAt,
      updatedAt: row.userUpdatedAt,
    },
    profile: {
      id: row.profileId ?? nanoid(),
      userId: row.profileUserId ?? row.userId,
      wechatName: row.wechatName ?? null,
      power: row.power ?? 0,
      classes: row.classes ?? "[]",
      titleHtml: row.titleHtml ?? null,
      bio: row.bio ?? null,
      images: row.images ?? "[]",
      audioKey: row.audioKey ?? null,
      videoUrls: row.videoUrls ?? "[]",
      availability: row.availability ?? null,
      vacationStart: row.vacationStart ?? null,
      vacationEnd: row.vacationEnd ?? null,
      discordId: row.discordId ?? null,
      discordReminderOptOut: row.discordReminderOptOut ?? false,
      notes: row.notes ?? null,
      createdAt: row.profileCreatedAt ?? row.userCreatedAt,
      updatedAt: row.profileUpdatedAt ?? row.userUpdatedAt,
    },
  };
}

async function ensureProfile(c: Context, userId: string): Promise<ProfileRow> {
  const db = getDb(c);
  const existing = await loadUserWithProfile(c, userId);
  if (existing?.profile.userId === userId && existing.profile.id) {
    const profile = existing.profile;
    const present = (
      await db.select({ id: memberProfiles.id }).from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1)
    )[0];
    if (present) {
      return profile;
    }
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

  const refreshed = await loadUserWithProfile(c, userId);
  if (!refreshed) {
    throw new Error("Failed to create profile");
  }
  return refreshed.profile;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildUsersWhereFilters(params: {
  search: string;
  roleFilter: Role | undefined;
  classFilter: string | undefined;
  activeFilter: boolean | undefined;
  includeWechatInSearch: boolean;
}): SQL<unknown>[] {
  const filters: SQL<unknown>[] = [isNull(users.deletedAt)];

  if (params.search) {
    const pattern = `%${escapeLikePattern(params.search.toLowerCase())}%`;
    if (params.includeWechatInSearch) {
      filters.push(sql`
        (
          lower(${users.username}) LIKE ${pattern} ESCAPE '\\'
          OR lower(coalesce(${memberProfiles.wechatName}, '')) LIKE ${pattern} ESCAPE '\\'
        )
      `);
    } else {
      filters.push(sql`lower(${users.username}) LIKE ${pattern} ESCAPE '\\'`);
    }
  }

  if (params.roleFilter) {
    filters.push(eq(users.role, params.roleFilter));
  }

  if (params.activeFilter !== undefined) {
    filters.push(eq(users.isActive, params.activeFilter));
  }

  if (params.classFilter) {
    filters.push(sql`
      EXISTS (
        SELECT 1
        FROM json_each(coalesce(${memberProfiles.classes}, '[]'))
        WHERE json_each.value = ${params.classFilter}
      )
    `);
  }

  return filters;
}

function buildProfilePatch(payload: ReturnType<typeof updateProfileSchema.parse>): ProfilePatch {
  const patch: ProfilePatch = {};
  if (payload.wechat_name !== undefined) patch.wechatName = payload.wechat_name;
  if (payload.power !== undefined) patch.power = payload.power;
  if (payload.classes !== undefined) patch.classes = JSON.stringify(payload.classes);
  if (payload.title_html !== undefined) patch.titleHtml = payload.title_html;
  if (payload.bio !== undefined) patch.bio = payload.bio;
  if (payload.images !== undefined) patch.images = JSON.stringify(payload.images);
  if (payload.audio_key !== undefined) patch.audioKey = payload.audio_key;
  if (payload.video_urls !== undefined) patch.videoUrls = JSON.stringify(payload.video_urls);
  if (payload.availability !== undefined) {
    patch.availability = payload.availability === null ? null : JSON.stringify(payload.availability);
  }
  if (payload.vacation_start !== undefined) patch.vacationStart = payload.vacation_start;
  if (payload.vacation_end !== undefined) patch.vacationEnd = payload.vacation_end;
  if (payload.discord_reminder_opt_out !== undefined) {
    patch.discordReminderOptOut = payload.discord_reminder_opt_out;
  }
  patch.updatedAt = new Date().toISOString();
  return patch;
}

usersRoutes.get("/", async (c) => {
  const resolved = await resolveSession(c);
  const sessionUser = resolved?.user ?? null;

  const query = c.req.query();
  const page = parsePage(query.page, 1);
  const limit = Math.min(100, parsePage(query.limit, 20));
  const search = (query.search ?? "").trim().toLowerCase();
  const roleFilter = query.role as Role | undefined;
  const classFilter = query.class;
  const activeFilter = parseBoolean(query.active);
  const externalView = parseBoolean(query.external_view) ?? false;

  const db = getDb(c);
  const offset = (page - 1) * limit;
  const whereFilters = buildUsersWhereFilters({
    search,
    roleFilter,
    classFilter,
    activeFilter,
    includeWechatInSearch: !externalView,
  });
  const whereClause = and(...whereFilters);

  const totalRow = (
    await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(whereClause)
  )[0];
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      role: users.role,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
      userCreatedAt: users.createdAt,
      userUpdatedAt: users.updatedAt,
      profileId: memberProfiles.id,
      profileUserId: memberProfiles.userId,
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
      profileCreatedAt: memberProfiles.createdAt,
      profileUpdatedAt: memberProfiles.updatedAt,
    })
    .from(users)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
    .where(whereClause)
    .orderBy(users.createdAt, users.id)
    .limit(limit)
    .offset(offset);

  const data = rows.map((row) => {
    const normalized: UserWithProfileRow = {
      user: {
        id: row.userId,
        username: row.username,
        role: row.role,
        isActive: row.isActive,
        deletedAt: row.deletedAt,
        createdAt: row.userCreatedAt,
        updatedAt: row.userUpdatedAt,
      },
      profile: {
        id: row.profileId ?? nanoid(),
        userId: row.profileUserId ?? row.userId,
        wechatName: row.wechatName ?? null,
        power: row.power ?? 0,
        classes: row.classes ?? "[]",
        titleHtml: row.titleHtml ?? null,
        bio: row.bio ?? null,
        images: row.images ?? "[]",
        audioKey: row.audioKey ?? null,
        videoUrls: row.videoUrls ?? "[]",
        availability: row.availability ?? null,
        vacationStart: row.vacationStart ?? null,
        vacationEnd: row.vacationEnd ?? null,
        discordId: row.discordId ?? null,
        discordReminderOptOut: row.discordReminderOptOut ?? false,
        notes: row.notes ?? null,
        createdAt: row.profileCreatedAt ?? row.userCreatedAt,
        updatedAt: row.profileUpdatedAt ?? row.userUpdatedAt,
      },
    };

    return {
      user: toUserPayload(normalized.user),
      profile: toProfilePayload(normalized.profile, {
        includeNotes: sessionUser?.role === "admin",
        includeWechat: Boolean(sessionUser) && !externalView,
      }),
    };
  });

  return c.json({
    data,
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  });
});

usersRoutes.get("/:id", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  const loaded = await loadUserWithProfile(c, targetUserId);
  if (!loaded) {
    return buildError(c, "NOT_FOUND", "User not found");
  }

  const profile = await ensureProfile(c, targetUserId);
  return c.json({
    user: toUserPayload(loaded.user),
    profile: toProfilePayload(profile, {
      includeNotes: sessionUser.role === "admin",
      includeWechat: true,
    }),
  });
});

usersRoutes.patch("/:id/profile", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (!(await canEditTarget(c, sessionUser, targetUserId))) {
    return buildError(c, "FORBIDDEN", "You cannot edit this profile");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid profile payload", parsed.error.flatten());
  }

  const db = getDb(c);
  await ensureProfile(c, targetUserId);
  const patch = buildProfilePatch(parsed.data);

  await db.update(memberProfiles).set(patch).where(eq(memberProfiles.userId, targetUserId));
  const updated = await loadUserWithProfile(c, targetUserId);
  if (!updated) {
    return buildError(c, "NOT_FOUND", "User not found");
  }

  await writeAuditLog(c, {
    entityType: "member_profile",
    action: "update",
    actorId: sessionUser.id,
    entityId: targetUserId,
    diffTitle: updated.user.username,
  });

  return c.json(
    toProfilePayload(updated.profile, {
      includeNotes: sessionUser.role === "admin",
      includeWechat: true,
    }),
  );
});

usersRoutes.post("/:id/media/images", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (!(await canEditTarget(c, sessionUser, targetUserId))) {
    return buildError(c, "FORBIDDEN", "You cannot upload media for this profile");
  }

  const profile = await ensureProfile(c, targetUserId);
  const form = await c.req.formData();
  const files: File[] = [];
  const single = form.get("file");
  if (single instanceof File) {
    files.push(single);
  }
  for (const value of form.getAll("files")) {
    if (value instanceof File) {
      files.push(value);
    }
  }

  if (files.length === 0) {
    return buildError(c, "VALIDATION_ERROR", "No files provided");
  }

  for (const file of files) {
    if (file.size > FILE_SIZE_LIMITS.profileImage) {
      return buildError(c, "VALIDATION_ERROR", `Image exceeds ${FILE_SIZE_LIMITS.profileImage} bytes`);
    }
  }

  const existingImages = parseStringArray(profile.images);
  if (existingImages.length + files.length > IMAGE_QUOTAS.profile) {
    return buildError(c, "CONFLICT", "Profile image quota exceeded");
  }

  const uploadedKeys: string[] = [];
  for (const file of files) {
    const key = await storeProfileImage(c, targetUserId, file);
    uploadedKeys.push(key);
  }

  const merged = [...existingImages, ...uploadedKeys];
  const db = getDb(c);
  await db
    .update(memberProfiles)
    .set({
      images: JSON.stringify(merged),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(memberProfiles.userId, targetUserId));

  return c.json({ keys: uploadedKeys });
});

usersRoutes.delete("/:id/media/images/:key", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (!(await canEditTarget(c, sessionUser, targetUserId))) {
    return buildError(c, "FORBIDDEN", "You cannot delete media for this profile");
  }

  const encodedKey = c.req.param("key");
  const key = decodeURIComponent(encodedKey);
  const profile = await ensureProfile(c, targetUserId);
  const images = parseStringArray(profile.images);
  const nextImages = images.filter((item) => item !== key);

  if (images.includes(key)) {
    await deleteMediaObject(c, key);
  }

  const db = getDb(c);
  await db
    .update(memberProfiles)
    .set({
      images: JSON.stringify(nextImages),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(memberProfiles.userId, targetUserId));

  return c.json({ ok: true });
});

usersRoutes.post("/:id/media/audio", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (!(await canEditTarget(c, sessionUser, targetUserId))) {
    return buildError(c, "FORBIDDEN", "You cannot upload media for this profile");
  }

  const form = await c.req.formData();
  const audio = form.get("file");
  if (!(audio instanceof File)) {
    return buildError(c, "VALIDATION_ERROR", "Audio file is required");
  }
  if (audio.size > FILE_SIZE_LIMITS.profileAudio) {
    return buildError(c, "VALIDATION_ERROR", `Audio exceeds ${FILE_SIZE_LIMITS.profileAudio} bytes`);
  }

  const profile = await ensureProfile(c, targetUserId);
  const key = await storeProfileAudio(c, targetUserId, audio);

  if (profile.audioKey) {
    await deleteMediaObject(c, profile.audioKey);
  }

  const db = getDb(c);
  await db
    .update(memberProfiles)
    .set({
      audioKey: key,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(memberProfiles.userId, targetUserId));

  return c.json({ key });
});

usersRoutes.delete("/:id/media/audio", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (!(await canEditTarget(c, sessionUser, targetUserId))) {
    return buildError(c, "FORBIDDEN", "You cannot delete media for this profile");
  }

  const profile = await ensureProfile(c, targetUserId);
  if (profile.audioKey) {
    await deleteMediaObject(c, profile.audioKey);
  }

  const db = getDb(c);
  await db
    .update(memberProfiles)
    .set({
      audioKey: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(memberProfiles.userId, targetUserId));

  return c.json({ ok: true });
});

usersRoutes.post("/:id/discord-link/verify", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (sessionUser.id !== targetUserId) {
    return buildError(c, "FORBIDDEN", "Discord link verification is allowed for self only");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const code = typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : "";
  if (!/^\d{6}$/.test(code)) {
    return buildError(c, "VALIDATION_ERROR", "code must be 6 digits");
  }

  const db = getDb(c);
  const nowIso = new Date().toISOString();
  const linkCode = (
    await db
      .select({
        id: discordLinkCodes.id,
        userId: discordLinkCodes.userId,
        discordId: discordLinkCodes.discordId,
        code: discordLinkCodes.code,
        expiresAt: discordLinkCodes.expiresAt,
        used: discordLinkCodes.used,
      })
      .from(discordLinkCodes)
      .where(
        and(
          eq(discordLinkCodes.userId, targetUserId),
          eq(discordLinkCodes.code, code),
          eq(discordLinkCodes.used, false),
        ),
      )
      .orderBy(discordLinkCodes.createdAt)
      .limit(1)
  )[0];

  if (!linkCode || linkCode.expiresAt <= nowIso) {
    return buildError(c, "UNAUTHORIZED", "Invalid or expired code");
  }

  await db
    .update(memberProfiles)
    .set({
      discordId: linkCode.discordId,
      updatedAt: nowIso,
    })
    .where(eq(memberProfiles.userId, targetUserId));

  await db
    .update(discordLinkCodes)
    .set({ used: true })
    .where(eq(discordLinkCodes.id, linkCode.id));

  await writeAuditLog(c, {
    entityType: "member_profile",
    action: "link_discord",
    actorId: sessionUser.id,
    entityId: targetUserId,
    detailText: JSON.stringify({ discord_id: linkCode.discordId }),
  });

  return c.json({ ok: true, discord_id: linkCode.discordId });
});

usersRoutes.delete("/:id/discord-link", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (sessionUser.id !== targetUserId && sessionUser.role !== "admin") {
    return buildError(c, "FORBIDDEN", "Discord unlink is allowed for self or admin");
  }

  const db = getDb(c);
  await db
    .update(memberProfiles)
    .set({
      discordId: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(memberProfiles.userId, targetUserId));

  await writeAuditLog(c, {
    entityType: "member_profile",
    action: "unlink_discord",
    actorId: sessionUser.id,
    entityId: targetUserId,
  });

  return c.json({ ok: true });
});

usersRoutes.post("/:id/change-password", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (sessionUser.id !== targetUserId) {
    return buildError(c, "FORBIDDEN", "Password change is allowed for self only");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid password change payload", parsed.error.flatten());
  }

  const db = getDb(c);
  const authRecord = (
    await db
      .select({
        userId: userAuthPassword.userId,
        passwordHash: userAuthPassword.passwordHash,
        salt: userAuthPassword.salt,
      })
      .from(userAuthPassword)
      .where(eq(userAuthPassword.userId, targetUserId))
      .limit(1)
  )[0];

  if (!authRecord) {
    return buildError(c, "NOT_FOUND", "Password record not found");
  }

  const validCurrent = await verifyPassword(
    parsed.data.currentPassword,
    authRecord.salt,
    authRecord.passwordHash,
  );
  if (!validCurrent) {
    return buildError(c, "UNAUTHORIZED", "Current password is incorrect");
  }

  const nextPassword = await createPasswordHash(parsed.data.newPassword);
  await db
    .update(userAuthPassword)
    .set({
      passwordHash: nextPassword.passwordHash,
      salt: nextPassword.salt,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(userAuthPassword.userId, targetUserId));

  await writeAuditLog(c, {
    entityType: "user_auth",
    action: "change_password",
    actorId: sessionUser.id,
    entityId: targetUserId,
  });

  return c.json({ ok: true });
});

usersRoutes.post("/:id/change-username", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const targetUserId = c.req.param("id");
  if (sessionUser.id !== targetUserId) {
    return buildError(c, "FORBIDDEN", "Username change is allowed for self only");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = changeUsernameSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid username change payload", parsed.error.flatten());
  }

  const db = getDb(c);
  const authRecord = (
    await db
      .select({
        passwordHash: userAuthPassword.passwordHash,
        salt: userAuthPassword.salt,
      })
      .from(userAuthPassword)
      .where(eq(userAuthPassword.userId, targetUserId))
      .limit(1)
  )[0];

  if (!authRecord) {
    return buildError(c, "NOT_FOUND", "Password record not found");
  }

  const validCurrent = await verifyPassword(
    parsed.data.currentPassword,
    authRecord.salt,
    authRecord.passwordHash,
  );
  if (!validCurrent) {
    return buildError(c, "UNAUTHORIZED", "Current password is incorrect");
  }

  const duplicate = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, parsed.data.newUsername), isNull(users.deletedAt)))
      .limit(1)
  )[0];
  if (duplicate && duplicate.id !== targetUserId) {
    return buildError(c, "CONFLICT", "Username already taken");
  }

  await db
    .update(users)
    .set({
      username: parsed.data.newUsername,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, targetUserId));

  await writeAuditLog(c, {
    entityType: "user",
    action: "change_username",
    actorId: sessionUser.id,
    entityId: targetUserId,
    detailText: JSON.stringify({ new_username: parsed.data.newUsername }),
  });

  await db.delete(sessions).where(eq(sessions.userId, targetUserId));
  await destroySession(c);
  return c.json({ ok: true });
});
