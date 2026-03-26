import {
  ALLOWED_IMAGE_TYPES,
  FILE_SIZE_LIMITS,
  IMAGE_QUOTAS,
  adminUpdateProfileSchema,
  changePasswordSchema,
  changeUsernameSchema,
  memberProfileSchema,
  updateProfileSchema,
  userSchema,
  type Role,
} from "@guild/shared";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { discordLinkCodes, memberProfiles, sessions, userAuthPassword, users } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";

type DrizzleDb = ReturnType<typeof drizzle>;

export type SessionUser = { id: string; role: Role; permissions: ReadonlySet<string> };

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

type UserWithProfileRow = { user: UserRow; profile: ProfileRow };

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
  notes?: string | null;
  updatedAt?: string;
};

export type ListUsersParams = {
  page: number;
  limit: number;
  search: string;
  roleFilter?: Role;
  classFilter?: string;
  activeFilter?: boolean;
  externalView: boolean;
  sessionUser: SessionUser | null;
};

type EntityChangedInput = { entityType: string; entityId: string; hint: string };

export type UserServiceDeps = {
  writeAuditLog: (input: {
    entityType: string;
    action: string;
    actorId: string;
    entityId: string;
    diffTitle?: string | null;
    detailText?: string | null;
  }) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
  storeProfileImage: (userId: string, file: File) => Promise<string>;
  storeProfileAudio: (userId: string, file: File) => Promise<string>;
  deleteMediaObject: (key: string) => Promise<void>;
  verifyPassword: (password: string, salt: string, hash: string) => Promise<boolean>;
  createPasswordHash: (password: string) => Promise<{ passwordHash: string; salt: string }>;
  destroySession: () => Promise<void>;
};

// --- Helpers ---

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
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

function toProfilePayload(profile: ProfileRow, options: { includeNotes: boolean; includeWechat: boolean }) {
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

function buildProfilePatch(
  payload: ReturnType<typeof updateProfileSchema.parse> | ReturnType<typeof adminUpdateProfileSchema.parse>,
): ProfilePatch {
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
  if (payload.discord_reminder_opt_out !== undefined) patch.discordReminderOptOut = payload.discord_reminder_opt_out;
  if ("notes" in payload && payload.notes !== undefined) patch.notes = payload.notes;
  patch.updatedAt = new Date().toISOString();
  return patch;
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
      filters.push(
        sql`(lower(${users.username}) LIKE ${pattern} ESCAPE '\\' OR lower(coalesce(${memberProfiles.wechatName}, '')) LIKE ${pattern} ESCAPE '\\')`,
      );
    } else {
      filters.push(sql`lower(${users.username}) LIKE ${pattern} ESCAPE '\\'`);
    }
  }
  if (params.roleFilter) filters.push(eq(users.role, params.roleFilter));
  if (params.activeFilter !== undefined) filters.push(eq(users.isActive, params.activeFilter));
  if (params.classFilter) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM json_each(coalesce(${memberProfiles.classes}, '[]')) WHERE json_each.value = ${params.classFilter})`,
    );
  }
  return filters;
}

const userProfileSelect = {
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
} as const;

function rowToUserWithProfile(row: Record<string, unknown>): UserWithProfileRow {
  return {
    user: {
      id: row.userId as string,
      username: row.username as string,
      role: row.role as Role,
      isActive: row.isActive as boolean,
      deletedAt: (row.deletedAt as string | null) ?? null,
      createdAt: row.userCreatedAt as string,
      updatedAt: row.userUpdatedAt as string,
    },
    profile: {
      id: (row.profileId as string) ?? nanoid(),
      userId: (row.profileUserId as string) ?? (row.userId as string),
      wechatName: (row.wechatName as string | null) ?? null,
      power: (row.power as number) ?? 0,
      classes: (row.classes as string) ?? "[]",
      titleHtml: (row.titleHtml as string | null) ?? null,
      bio: (row.bio as string | null) ?? null,
      images: (row.images as string) ?? "[]",
      audioKey: (row.audioKey as string | null) ?? null,
      videoUrls: (row.videoUrls as string) ?? "[]",
      availability: (row.availability as string | null) ?? null,
      vacationStart: (row.vacationStart as string | null) ?? null,
      vacationEnd: (row.vacationEnd as string | null) ?? null,
      discordId: (row.discordId as string | null) ?? null,
      discordReminderOptOut: (row.discordReminderOptOut as boolean) ?? false,
      notes: (row.notes as string | null) ?? null,
      createdAt: (row.profileCreatedAt as string) ?? (row.userCreatedAt as string),
      updatedAt: (row.profileUpdatedAt as string) ?? (row.userUpdatedAt as string),
    },
  };
}

// --- Service ---

export class UserService {
  constructor(
    private db: DrizzleDb,
    private deps: UserServiceDeps,
  ) {}

  private async loadUserWithProfile(userId: string): Promise<UserWithProfileRow | null> {
    const row = (
      await this.db
        .select(userProfileSelect)
        .from(users)
        .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1)
    )[0];
    if (!row) return null;
    return rowToUserWithProfile(row as unknown as Record<string, unknown>);
  }

  private async ensureProfile(userId: string): Promise<ProfileRow> {
    const existing = await this.loadUserWithProfile(userId);
    if (existing?.profile.userId === userId) {
      const present = (
        await this.db.select({ id: memberProfiles.id }).from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1)
      )[0];
      if (present) return existing.profile;
    }
    await this.db.insert(memberProfiles).values({
      id: nanoid(), userId, power: 0, classes: "[]", images: "[]", videoUrls: "[]", discordReminderOptOut: false,
    });
    const refreshed = await this.loadUserWithProfile(userId);
    if (!refreshed) throw new Error("Failed to create profile");
    return refreshed.profile;
  }

  private async canEditTarget(sessionUser: SessionUser, targetUserId: string): Promise<"allowed" | "forbidden" | "not_found"> {
    const target = (
      await this.db.select({ role: users.role, deletedAt: users.deletedAt }).from(users).where(eq(users.id, targetUserId)).limit(1)
    )[0];
    if (!target || target.deletedAt !== null) return "not_found";
    if (sessionUser.id === targetUserId) return "allowed";
    if (!sessionUser.permissions.has("admin.users.edit")) return "forbidden";
    if (target.role === "admin" && sessionUser.role !== "admin") return "forbidden";
    return "allowed";
  }

  async listUsers(params: ListUsersParams): Promise<ServiceResult<{
    data: unknown[]; total: number; page: number; limit: number; total_pages: number;
  }>> {
    const offset = (params.page - 1) * params.limit;
    const whereClause = and(...buildUsersWhereFilters({
      search: params.search, roleFilter: params.roleFilter, classFilter: params.classFilter,
      activeFilter: params.activeFilter, includeWechatInSearch: !params.externalView,
    }));

    const totalRow = (
      await this.db.select({ count: sql<number>`count(*)` }).from(users)
        .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id)).where(whereClause)
    )[0];
    const total = Number(totalRow?.count ?? 0);

    const rows = await this.db.select(userProfileSelect).from(users)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(whereClause).orderBy(users.createdAt, users.id)
      .limit(params.limit).offset(offset);

    const data = rows.map((row) => {
      const normalized = rowToUserWithProfile(row as unknown as Record<string, unknown>);
      return {
        user: toUserPayload(normalized.user),
        profile: toProfilePayload(normalized.profile, {
          includeNotes: params.sessionUser?.permissions.has("admin.users.view") === true,
          includeWechat: Boolean(params.sessionUser) && !params.externalView,
        }),
      };
    });

    return ok({ data, total, page: params.page, limit: params.limit, total_pages: Math.max(1, Math.ceil(total / params.limit)) });
  }

  async getUser(sessionUser: SessionUser, targetUserId: string): Promise<ServiceResult<{ user: unknown; profile: unknown }>> {
    const loaded = await this.loadUserWithProfile(targetUserId);
    if (!loaded) return err("NOT_FOUND", "User not found");
    const profile = await this.ensureProfile(targetUserId);
    return ok({
      user: toUserPayload(loaded.user),
      profile: toProfilePayload(profile, { includeNotes: sessionUser.permissions.has("admin.users.view"), includeWechat: true }),
    });
  }

  async updateProfile(sessionUser: SessionUser, targetUserId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access === "not_found") return err("NOT_FOUND", "User not found");
    if (access === "forbidden") return err("FORBIDDEN", "You cannot edit this profile");

    const schema = sessionUser.permissions.has("admin.users.edit") ? adminUpdateProfileSchema : updateProfileSchema;
    const parsed = schema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid profile payload", parsed.error.flatten());

    await this.ensureProfile(targetUserId);
    await this.db.update(memberProfiles).set(buildProfilePatch(parsed.data)).where(eq(memberProfiles.userId, targetUserId));

    const updated = await this.loadUserWithProfile(targetUserId);
    if (!updated) return err("NOT_FOUND", "User not found");

    await this.deps.writeAuditLog({
      entityType: "member_profile", action: "update", actorId: sessionUser.id,
      entityId: targetUserId, diffTitle: updated.user.username,
    });
    await this.deps.publishEntityChanged({ entityType: "member_profile", entityId: targetUserId, hint: "profile_updated" });
    return ok(toProfilePayload(updated.profile, { includeNotes: sessionUser.permissions.has("admin.users.view"), includeWechat: true }));
  }

  async uploadProfileImages(sessionUser: SessionUser, targetUserId: string, files: File[]): Promise<ServiceResult<{ keys: string[] }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access === "not_found") return err("NOT_FOUND", "User not found");
    if (access === "forbidden") return err("FORBIDDEN", "You cannot upload media for this profile");
    if (files.length === 0) return err("VALIDATION_ERROR", "No files provided");

    for (const file of files) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number]))
        return err("VALIDATION_ERROR", `Invalid file type: ${file.name}`);
      if (file.size > FILE_SIZE_LIMITS.profileImage)
        return err("VALIDATION_ERROR", `Image exceeds ${FILE_SIZE_LIMITS.profileImage} bytes`);
    }

    const profile = await this.ensureProfile(targetUserId);
    const existing = parseStringArray(profile.images);
    if (existing.length + files.length > IMAGE_QUOTAS.profile)
      return err("CONFLICT", "Profile image quota exceeded");

    const keys: string[] = [];
    for (const file of files) keys.push(await this.deps.storeProfileImage(targetUserId, file));

    await this.db.update(memberProfiles)
      .set({ images: JSON.stringify([...existing, ...keys]), updatedAt: new Date().toISOString() })
      .where(eq(memberProfiles.userId, targetUserId));
    return ok({ keys });
  }

  async deleteProfileImage(sessionUser: SessionUser, targetUserId: string, imageKey: string): Promise<ServiceResult<{ ok: true }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access === "not_found") return err("NOT_FOUND", "User not found");
    if (access === "forbidden") return err("FORBIDDEN", "You cannot delete media for this profile");

    const profile = await this.ensureProfile(targetUserId);
    const images = parseStringArray(profile.images);
    if (images.includes(imageKey)) await this.deps.deleteMediaObject(imageKey);

    await this.db.update(memberProfiles)
      .set({ images: JSON.stringify(images.filter((k) => k !== imageKey)), updatedAt: new Date().toISOString() })
      .where(eq(memberProfiles.userId, targetUserId));
    return ok({ ok: true });
  }

  async uploadProfileAudio(sessionUser: SessionUser, targetUserId: string, audioFile: File): Promise<ServiceResult<{ key: string }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access === "not_found") return err("NOT_FOUND", "User not found");
    if (access === "forbidden") return err("FORBIDDEN", "You cannot upload media for this profile");

    const allowedAudioTypes = ["audio/ogg", "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav"];
    if (audioFile.type && !allowedAudioTypes.includes(audioFile.type))
      return err("VALIDATION_ERROR", `Invalid audio type: ${audioFile.type}`);
    if (audioFile.size > FILE_SIZE_LIMITS.profileAudio)
      return err("VALIDATION_ERROR", `Audio exceeds ${FILE_SIZE_LIMITS.profileAudio} bytes`);

    const profile = await this.ensureProfile(targetUserId);
    const key = await this.deps.storeProfileAudio(targetUserId, audioFile);
    if (profile.audioKey) await this.deps.deleteMediaObject(profile.audioKey);

    await this.db.update(memberProfiles)
      .set({ audioKey: key, updatedAt: new Date().toISOString() })
      .where(eq(memberProfiles.userId, targetUserId));
    return ok({ key });
  }

  async deleteProfileAudio(sessionUser: SessionUser, targetUserId: string): Promise<ServiceResult<{ ok: true }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access === "not_found") return err("NOT_FOUND", "User not found");
    if (access === "forbidden") return err("FORBIDDEN", "You cannot delete media for this profile");

    const profile = await this.ensureProfile(targetUserId);
    if (profile.audioKey) await this.deps.deleteMediaObject(profile.audioKey);

    await this.db.update(memberProfiles)
      .set({ audioKey: null, updatedAt: new Date().toISOString() })
      .where(eq(memberProfiles.userId, targetUserId));
    return ok({ ok: true });
  }

  async verifyDiscordLink(sessionUser: SessionUser, targetUserId: string, code: string): Promise<ServiceResult<{ ok: true; discord_id: string }>> {
    if (sessionUser.id !== targetUserId) return err("FORBIDDEN", "Discord link verification is allowed for self only");
    if (!/^\d{6}$/.test(code)) return err("VALIDATION_ERROR", "code must be 6 digits");

    const nowIso = new Date().toISOString();
    const linkCode = (
      await this.db.select({ id: discordLinkCodes.id, discordId: discordLinkCodes.discordId, expiresAt: discordLinkCodes.expiresAt })
        .from(discordLinkCodes)
        .where(and(eq(discordLinkCodes.userId, targetUserId), eq(discordLinkCodes.code, code), eq(discordLinkCodes.used, false)))
        .orderBy(discordLinkCodes.createdAt).limit(1)
    )[0];
    if (!linkCode || linkCode.expiresAt <= nowIso) return err("UNAUTHORIZED", "Invalid or expired code");

    await this.db.update(memberProfiles).set({ discordId: linkCode.discordId, updatedAt: nowIso }).where(eq(memberProfiles.userId, targetUserId));
    await this.db.update(discordLinkCodes).set({ used: true }).where(eq(discordLinkCodes.id, linkCode.id));

    await this.deps.writeAuditLog({
      entityType: "member_profile", action: "link_discord", actorId: sessionUser.id,
      entityId: targetUserId, detailText: JSON.stringify({ discord_id: linkCode.discordId }),
    });
    await this.deps.publishEntityChanged({ entityType: "member_profile", entityId: targetUserId, hint: "discord_linked" });
    return ok({ ok: true, discord_id: linkCode.discordId });
  }

  async unlinkDiscord(sessionUser: SessionUser, targetUserId: string): Promise<ServiceResult<{ ok: true }>> {
    if (sessionUser.id !== targetUserId) {
      if (!sessionUser.permissions.has("admin.users.edit"))
        return err("FORBIDDEN", "Discord unlink is allowed for self or users with admin.users.edit");
      const target = (
        await this.db.select({ role: users.role }).from(users).where(eq(users.id, targetUserId)).limit(1)
      )[0];
      if (target?.role === "admin" && sessionUser.role !== "admin")
        return err("FORBIDDEN", "Cannot unlink Discord for admin users");
    }

    await this.db.update(memberProfiles).set({ discordId: null, updatedAt: new Date().toISOString() }).where(eq(memberProfiles.userId, targetUserId));
    await this.deps.writeAuditLog({ entityType: "member_profile", action: "unlink_discord", actorId: sessionUser.id, entityId: targetUserId });
    await this.deps.publishEntityChanged({ entityType: "member_profile", entityId: targetUserId, hint: "discord_unlinked" });
    return ok({ ok: true });
  }

  async changePassword(sessionUser: SessionUser, targetUserId: string, body: unknown): Promise<ServiceResult<{ ok: true }>> {
    if (sessionUser.id !== targetUserId) return err("FORBIDDEN", "Password change is allowed for self only");

    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid password change payload", parsed.error.flatten());

    const auth = (
      await this.db.select({ passwordHash: userAuthPassword.passwordHash, salt: userAuthPassword.salt })
        .from(userAuthPassword).where(eq(userAuthPassword.userId, targetUserId)).limit(1)
    )[0];
    if (!auth) return err("NOT_FOUND", "Password record not found");

    if (!(await this.deps.verifyPassword(parsed.data.currentPassword, auth.salt, auth.passwordHash)))
      return err("UNAUTHORIZED", "Current password is incorrect");

    const next = await this.deps.createPasswordHash(parsed.data.newPassword);
    await this.db.update(userAuthPassword)
      .set({ passwordHash: next.passwordHash, salt: next.salt, updatedAt: new Date().toISOString() })
      .where(eq(userAuthPassword.userId, targetUserId));

    await this.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    await this.deps.destroySession();
    await this.deps.writeAuditLog({ entityType: "user_auth", action: "change_password", actorId: sessionUser.id, entityId: targetUserId });
    return ok({ ok: true });
  }

  async changeUsername(sessionUser: SessionUser, targetUserId: string, body: unknown): Promise<ServiceResult<{ ok: true }>> {
    if (sessionUser.id !== targetUserId) return err("FORBIDDEN", "Username change is allowed for self only");

    const parsed = changeUsernameSchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid username change payload", parsed.error.flatten());

    const auth = (
      await this.db.select({ passwordHash: userAuthPassword.passwordHash, salt: userAuthPassword.salt })
        .from(userAuthPassword).where(eq(userAuthPassword.userId, targetUserId)).limit(1)
    )[0];
    if (!auth) return err("NOT_FOUND", "Password record not found");

    if (!(await this.deps.verifyPassword(parsed.data.currentPassword, auth.salt, auth.passwordHash)))
      return err("UNAUTHORIZED", "Current password is incorrect");

    const dup = (
      await this.db.select({ id: users.id }).from(users)
        .where(and(eq(users.username, parsed.data.newUsername), isNull(users.deletedAt))).limit(1)
    )[0];
    if (dup && dup.id !== targetUserId) return err("CONFLICT", "Username already taken");

    await this.db.update(users).set({ username: parsed.data.newUsername, updatedAt: new Date().toISOString() }).where(eq(users.id, targetUserId));
    await this.deps.writeAuditLog({
      entityType: "user", action: "change_username", actorId: sessionUser.id,
      entityId: targetUserId, detailText: JSON.stringify({ new_username: parsed.data.newUsername }),
    });

    await this.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    await this.deps.destroySession();
    return ok({ ok: true });
  }
}
