import {
  ALLOWED_IMAGE_TYPES,
  DEFAULT_SITE_MEDIA_POLICY,
  PERMISSIONS,
  adminUpdateProfileSchema,
  changePasswordSchema,
  changeUsernameSchema,
  deleteProfileImagesSchema,
  memberProfileSchema,
  updateProfileSchema,
  userSchema,
  type Permission,
  type Role,
  type SiteMediaPolicy,
} from "@guild/shared";
import { SYSTEM_TEST_USERNAME_PREFIX, isReservedSystemTestUsername } from "@guild/shared/config/system-test";
import type { AuditEntityType, AuditAction } from "@guild/shared/constants/audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { memberProfileClasses, memberProfiles, roles, sessions, userAuthPassword, users } from "../db/schema";
import { sanitizeInlineHtml } from "./inline-html";
import { captureUploadValidation } from "./media";
import { deleteUploadedMedia, rethrowAfterUploadFailure } from "./media-upload-compensation";
import { parseMediaKey } from "./media-keys";
import { buildReplaceMediaRefsStatements } from "./media-references";
import {
  buildReplaceMemberClassStatements,
  buildReplaceMemberImageStatements,
  loadMemberClasses,
  loadMemberImages,
} from "./ordered-relations";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern, parseStringArray, parseRecord, usernameEquals } from "./helpers";
import { logger } from "../utils/logger";
import type { SessionUser } from "./auth";

type DrizzleDb = ReturnType<typeof drizzle>;

type UserRow = {
  id: string;
  username: string;
  role: Role;
  roleName: string;
  roleColor: string | null;
  roleLevel: number;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProfileRow = {
  id: string;
  userId: string;
  power: number;
  classes: string[];
  titleHtml: string | null;
  bio: string | null;
  images: string[];
  avatarKey: string | null;
  audioKey: string | null;
  videoUrls: string;
  availability: string | null;
  vacationStart: string | null;
  vacationEnd: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type UserWithProfileRow = { user: UserRow; profile: ProfileRow };

type ProfilePatch = {
  power?: number;
  titleHtml?: string | null;
  bio?: string | null;
  avatarKey?: string | null;
  audioKey?: string | null;
  videoUrls?: string;
  availability?: string | null;
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
  sessionUser: SessionUser | null;
  includeTotal?: boolean;
};

type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };

export type UserServiceDeps = {
  rawDb: D1Database;
  writeAuditLog: (input: {
    entityType: AuditEntityType;
    action: AuditAction;
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
  clearSessionCookie: () => void;
  getMediaPolicy?: () => Promise<SiteMediaPolicy>;
};

const PROFILE_PATCH_COLUMNS: ReadonlyArray<readonly [keyof ProfilePatch, string]> = [
  ["power", "power"],
  ["titleHtml", "title_html"],
  ["bio", "bio"],
  ["avatarKey", "avatar_key"],
  ["audioKey", "audio_key"],
  ["videoUrls", "video_urls"],
  ["availability", "availability"],
  ["notes", "notes"],
  ["updatedAt", "updated_at"],
];

function buildProfileUpdateStatement(db: D1Database, userId: string, patch: ProfilePatch): D1PreparedStatement {
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [property, column] of PROFILE_PATCH_COLUMNS) {
    const value = patch[property];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(value);
  }
  return db.prepare(`UPDATE member_profiles SET ${assignments.join(", ")} WHERE user_id = ?`).bind(...values, userId);
}

function profileMediaKeys(userId: string, profile: Pick<ProfileRow, "images" | "avatarKey" | "audioKey">): string[] {
  return [
    ...profile.images,
    ...(profile.avatarKey ? [profile.avatarKey] : []),
    ...(profile.audioKey ? [profile.audioKey] : []),
  ].filter((key) => {
    const parsed = parseMediaKey(key);
    return parsed?.entityId === userId
      && (parsed.kind === "member_image" || parsed.kind === "member_audio");
  });
}

// --- Helpers ---

function toUserPayload(user: UserRow) {
  const result = userSchema.safeParse({
    id: user.id,
    username: user.username,
    role: user.role,
    role_name: user.roleName,
    role_color: user.roleColor,
    role_level: user.roleLevel,
    permissions: Object.fromEntries(PERMISSIONS.map((p) => [p, false])) as Record<Permission, boolean>,
    is_active: user.isActive,
    deleted_at: user.deletedAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  });
  if (!result.success) {
    logger.error("Invalid user data from database", { userId: user.id, issues: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ') });
    throw new Error(`Invalid user data for id=${user.id}`);
  }
  return result.data;
}

function toProfilePayload(profile: ProfileRow, options: { includeNotes: boolean; includePrivate: boolean }) {
  const result = memberProfileSchema.safeParse({
    id: profile.id,
    user_id: profile.userId,
    power: profile.power,
    classes: profile.classes,
    title_html: profile.titleHtml,
    bio: profile.bio,
    images: profile.images,
    avatar_key: profile.avatarKey ?? null,
    audio_key: profile.audioKey,
    video_urls: parseStringArray(profile.videoUrls),
    availability: options.includePrivate ? parseRecord(profile.availability) : null,
    vacation_start: options.includePrivate ? profile.vacationStart : null,
    vacation_end: options.includePrivate ? profile.vacationEnd : null,
    notes: options.includeNotes ? profile.notes : null,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  });
  if (!result.success) {
    throw new Error(`Invalid profile data for user_id=${profile.userId}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

function buildProfilePatch(
  payload: ReturnType<typeof updateProfileSchema.parse> | ReturnType<typeof adminUpdateProfileSchema.parse>,
): ProfilePatch {
  const patch: ProfilePatch = {};
  if (payload.power !== undefined) patch.power = payload.power;
  if (payload.title_html !== undefined) patch.titleHtml = payload.title_html === null ? null : sanitizeInlineHtml(payload.title_html);
  if (payload.bio !== undefined) patch.bio = payload.bio;
  if (payload.video_urls !== undefined) patch.videoUrls = JSON.stringify(payload.video_urls);
  if (payload.availability !== undefined) {
    patch.availability = payload.availability === null ? null : JSON.stringify(payload.availability);
  }
  if ("notes" in payload && payload.notes !== undefined) patch.notes = payload.notes;
  patch.updatedAt = new Date().toISOString();
  return patch;
}

function buildProfileDiff(
  old: ProfileRow,
  patch: ProfilePatch,
  relations: { classes?: string[] } = {},
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const fieldMap: Array<[keyof ProfilePatch, keyof ProfileRow]> = [
    ["power", "power"],
    ["titleHtml", "titleHtml"],
    ["bio", "bio"],
    ["notes", "notes"],
    ["availability", "availability"],
  ];
  for (const [patchKey, oldKey] of fieldMap) {
    if (patch[patchKey] === undefined) continue;
    const oldVal = String(old[oldKey] ?? "");
    const newVal = String(patch[patchKey] ?? "");
    if (oldVal !== newVal) {
      diff[patchKey] = { from: old[oldKey] ?? null, to: patch[patchKey] ?? null };
    }
  }
  if (relations.classes !== undefined && JSON.stringify(relations.classes) !== JSON.stringify(old.classes)) {
    diff.classes = { from: old.classes, to: relations.classes };
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

function buildUsersWhereFilters(params: {
  search: string;
  roleFilter: Role | undefined;
  classFilter: string | undefined;
  activeFilter: boolean | undefined;
}): SQL<unknown>[] {
  const filters: SQL<unknown>[] = [isNull(users.deletedAt)];
  if (params.search) {
    const pattern = `%${escapeLikePattern(params.search.toLowerCase())}%`;
    filters.push(sql`lower(${users.username}) LIKE ${pattern} ESCAPE '\\'`);
  }
  if (params.roleFilter) filters.push(eq(users.role, params.roleFilter));
  if (params.activeFilter !== undefined) filters.push(eq(users.isActive, params.activeFilter));
  if (params.classFilter) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM ${memberProfileClasses} WHERE ${memberProfileClasses.userId} = ${users.id} AND ${memberProfileClasses.classId} = ${params.classFilter})`,
    );
  }
  return filters;
}

const userProfileSelect = {
  userId: users.id,
  username: users.username,
  role: users.role,
  roleName: roles.name,
  roleColor: roles.color,
  roleLevel: roles.level,
  isActive: users.isActive,
  deletedAt: users.deletedAt,
  userCreatedAt: users.createdAt,
  userUpdatedAt: users.updatedAt,
  profileId: memberProfiles.id,
  profileUserId: memberProfiles.userId,
  power: memberProfiles.power,
  titleHtml: memberProfiles.titleHtml,
  bio: memberProfiles.bio,
  avatarKey: memberProfiles.avatarKey,
  audioKey: memberProfiles.audioKey,
  videoUrls: memberProfiles.videoUrls,
  availability: memberProfiles.availability,
  // Derived from the absence history (current-or-next absence).
  vacationStart: sql<string | null>`(SELECT ma.start_date FROM member_absences ma WHERE ma.user_id = ${users.id} AND ma.end_date >= date('now') ORDER BY ma.start_date ASC LIMIT 1)`.as("derived_vacation_start"),
  vacationEnd: sql<string | null>`(SELECT ma.end_date FROM member_absences ma WHERE ma.user_id = ${users.id} AND ma.end_date >= date('now') ORDER BY ma.start_date ASC LIMIT 1)`.as("derived_vacation_end"),
  notes: memberProfiles.notes,
  profileCreatedAt: memberProfiles.createdAt,
  profileUpdatedAt: memberProfiles.updatedAt,
} as const;

function rowToUserWithProfile(
  row: Record<string, unknown>,
  relations: { classes?: string[]; images?: string[] } = {},
): UserWithProfileRow {
  return {
    user: {
      id: row.userId as string,
      username: row.username as string,
      role: row.role as Role,
      roleName: row.roleName as string,
      roleColor: (row.roleColor as string | null) ?? null,
      roleLevel: row.roleLevel as number,
      isActive: row.isActive as boolean,
      deletedAt: (row.deletedAt as string | null) ?? null,
      createdAt: row.userCreatedAt as string,
      updatedAt: row.userUpdatedAt as string,
    },
    profile: {
      id: (row.profileId as string) ?? nanoid(),
      userId: (row.profileUserId as string) ?? (row.userId as string),
      power: (row.power as number) ?? 0,
      classes: relations.classes ?? [],
      titleHtml: (row.titleHtml as string | null) ?? null,
      bio: (row.bio as string | null) ?? null,
      images: relations.images ?? [],
      avatarKey: (row.avatarKey as string | null) ?? null,
      audioKey: (row.audioKey as string | null) ?? null,
      videoUrls: (row.videoUrls as string) ?? "[]",
      availability: (row.availability as string | null) ?? null,
      vacationStart: (row.vacationStart as string | null) ?? null,
      vacationEnd: (row.vacationEnd as string | null) ?? null,
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

  private async loadUserWithProfile(userId: string): Promise<{ data: UserWithProfileRow; profileExists: boolean } | null> {
    const row = (
      await this.db
        .select(userProfileSelect)
        .from(users)
        .innerJoin(roles, eq(users.role, roles.id))
        .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1)
    )[0];
    if (!row) return null;
    const [classes, images] = await Promise.all([
      loadMemberClasses(this.deps.rawDb, [userId]),
      loadMemberImages(this.deps.rawDb, [userId]),
    ]);
    return {
      data: rowToUserWithProfile(row as unknown as Record<string, unknown>, {
        classes: classes.get(userId) ?? [],
        images: images.get(userId) ?? [],
      }),
      profileExists: (row as unknown as Record<string, unknown>).profileId != null,
    };
  }

  private async ensureProfile(userId: string): Promise<ProfileRow> {
    let row = (await this.db.select().from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1))[0];
    // Profile missing — shouldn't happen post-registration but handle gracefully
    if (!row) {
      await this.db.insert(memberProfiles).values({ id: nanoid(), userId, power: 0, videoUrls: "[]" });
      row = (await this.db.select().from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1))[0];
    }
    if (!row) throw new Error("Failed to create profile");
    const [classes, images] = await Promise.all([
      loadMemberClasses(this.deps.rawDb, [userId]),
      loadMemberImages(this.deps.rawDb, [userId]),
    ]);
    return {
      ...row,
      classes: classes.get(userId) ?? [],
      images: images.get(userId) ?? [],
      vacationStart: null,
      vacationEnd: null,
    };
  }

  private async updateProfileWithRelations(
    targetUserId: string,
    current: ProfileRow,
    patch: ProfilePatch,
    relations: { classes?: string[]; images?: string[] } = {},
  ): Promise<void> {
    const next = {
      images: relations.images ?? current.images,
      avatarKey: patch.avatarKey === undefined ? current.avatarKey : patch.avatarKey,
      audioKey: patch.audioKey === undefined ? current.audioKey : patch.audioKey,
    };
    await this.deps.rawDb.batch([
      buildProfileUpdateStatement(this.deps.rawDb, targetUserId, patch),
      ...(relations.classes === undefined ? [] : buildReplaceMemberClassStatements(this.deps.rawDb, targetUserId, relations.classes)),
      ...(relations.images === undefined ? [] : buildReplaceMemberImageStatements(this.deps.rawDb, targetUserId, relations.images)),
      ...buildReplaceMediaRefsStatements(this.deps.rawDb, "member_profile", targetUserId, profileMediaKeys(targetUserId, next)),
    ]);
  }

  private async canEditTarget(sessionUser: SessionUser, targetUserId: string): Promise<{ status: "allowed"; username: string } | { status: "forbidden" | "not_found"; username: null }> {
    const target = (
      await this.db.select({ roleLevel: roles.level, deletedAt: users.deletedAt, username: users.username }).from(users).innerJoin(roles, eq(users.role, roles.id)).where(eq(users.id, targetUserId)).limit(1)
    )[0];
    if (!target || target.deletedAt !== null) return { status: "not_found", username: null };
    if (sessionUser.id === targetUserId) return { status: "allowed", username: target.username };
    if (!sessionUser.permissions.has("admin.users.edit")) return { status: "forbidden", username: null };
    if (target.roleLevel >= sessionUser.roleLevel) return { status: "forbidden", username: null };
    return { status: "allowed", username: target.username };
  }

  async listUsers(params: ListUsersParams): Promise<ServiceResult<{
    data: unknown[]; total: number; page: number; limit: number; total_pages: number;
  }>> {
    const offset = (params.page - 1) * params.limit;
    const whereClause = and(...buildUsersWhereFilters({
      search: params.search, roleFilter: params.roleFilter, classFilter: params.classFilter,
      activeFilter: params.activeFilter,
    }));

    const dataQuery = this.db.select(userProfileSelect).from(users)
      .innerJoin(roles, eq(users.role, roles.id))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(whereClause).orderBy(users.createdAt, users.id)
      .limit(params.limit).offset(offset);

    let total: number;
    let totalPages: number;
    let rows: Awaited<typeof dataQuery>;
    if (params.includeTotal) {
      const [dataRows, countRow] = await Promise.all([
        dataQuery,
        this.db.select({ count: sql<number>`count(*)` }).from(users).where(whereClause),
      ]);
      rows = dataRows;
      total = Number(countRow[0]?.count ?? 0);
      totalPages = Math.max(1, Math.ceil(total / params.limit));
    } else {
      rows = await dataQuery;
      total = offset + rows.length;
      totalPages = rows.length < params.limit ? params.page : params.page + 1;
    }

    const userIds = rows.map((row) => row.userId);
    const [classes, images] = await Promise.all([
      loadMemberClasses(this.deps.rawDb, userIds),
      loadMemberImages(this.deps.rawDb, userIds),
    ]);
    const data = rows.map((row) => {
      const normalized = rowToUserWithProfile(row as unknown as Record<string, unknown>, {
        classes: classes.get(row.userId) ?? [],
        images: images.get(row.userId) ?? [],
      });
      return {
        user: toUserPayload(normalized.user),
        profile: toProfilePayload(normalized.profile, {
          includeNotes: params.sessionUser?.permissions.has("admin.users.view") === true,
          includePrivate: Boolean(params.sessionUser),
        }),
      };
    });

    return ok({ data, total, page: params.page, limit: params.limit, total_pages: totalPages });
  }

  async getUserStats(): Promise<ServiceResult<{ active_members: number; total_members: number }>> {
    const row = (
      await this.db
        .select({
          activeMembers: sql<number>`sum(case when ${users.deletedAt} is null and ${users.isActive} = 1 then 1 else 0 end)`,
          totalMembers: sql<number>`sum(case when ${users.deletedAt} is null then 1 else 0 end)`,
        })
        .from(users)
    )[0];
    return ok({
      active_members: Number(row?.activeMembers ?? 0),
      total_members: Number(row?.totalMembers ?? 0),
    });
  }

  async getUser(sessionUser: SessionUser | null, targetUserId: string): Promise<ServiceResult<{ user: unknown; profile: unknown }>> {
    const loaded = await this.loadUserWithProfile(targetUserId);
    if (!loaded) return err("NOT_FOUND", "User not found");
    if (!loaded.data.user.isActive && sessionUser?.permissions.has("admin.users.view") !== true) {
      return err("NOT_FOUND", "User not found");
    }
    const profile = loaded.profileExists ? loaded.data.profile : await this.ensureProfile(targetUserId);
    const canViewPrivateProfile = Boolean(sessionUser);
    const canViewNotes = sessionUser?.permissions.has("admin.users.view") === true;
    return ok({
      user: toUserPayload(loaded.data.user),
      profile: toProfilePayload(profile, { includeNotes: canViewNotes, includePrivate: canViewPrivateProfile }),
    });
  }

  async updateProfile(sessionUser: SessionUser, targetUserId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot edit this profile");

    const schema = sessionUser.permissions.has("admin.users.edit") ? adminUpdateProfileSchema : updateProfileSchema;
    const parsed = schema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid profile payload", parsed.error.flatten());

    const oldProfile = await this.ensureProfile(targetUserId);

    // `images` is a reorder/remove operation, never a way to introduce keys.
    // Without this check a member could point their own profile at another
    // member's (or the site logo's) R2 key and then delete it through
    // DELETE /media/images, which deletes whatever is listed on the profile.
    if (parsed.data.images !== undefined) {
      const existingImages = new Set(oldProfile.images);
      const foreignKey = parsed.data.images.find((key) => !existingImages.has(key));
      if (foreignKey !== undefined) {
        return err("VALIDATION_ERROR", `images may only reorder or remove existing profile media: ${foreignKey}`);
      }
    }

    const patch = buildProfilePatch(parsed.data);
    const relations = { classes: parsed.data.classes, images: parsed.data.images };
    if (relations.classes !== undefined || relations.images !== undefined) {
      await this.updateProfileWithRelations(targetUserId, oldProfile, patch, relations);
    } else {
      await this.db.update(memberProfiles).set(patch).where(eq(memberProfiles.userId, targetUserId));
    }

    const updated = await this.loadUserWithProfile(targetUserId);
    if (!updated) return err("NOT_FOUND", "User not found");

    const diff = buildProfileDiff(oldProfile, patch, { classes: relations.classes });
    await this.deps.writeAuditLog({
      entityType: "member_profile", action: "update", actorId: sessionUser.id,
      entityId: targetUserId, diffTitle: updated.data.user.username,
      detailText: diff ? JSON.stringify(diff) : null,
    });
    const profileHint = sessionUser.id === targetUserId ? "profile_updated" : "profile_moderated";
    await this.deps.publishEntityChanged({ entityType: "member_profile", entityId: targetUserId, hint: profileHint });
    return ok(toProfilePayload(updated.data.profile, { includeNotes: sessionUser.permissions.has("admin.users.view"), includePrivate: true }));
  }

  async uploadProfileImages(sessionUser: SessionUser, targetUserId: string, files: File[]): Promise<ServiceResult<{ keys: string[] }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot upload media for this profile");
    if (files.length === 0) return err("VALIDATION_ERROR", "No files provided");

    const mediaPolicy = await (this.deps.getMediaPolicy?.() ?? Promise.resolve(DEFAULT_SITE_MEDIA_POLICY));
    const maxImageBytes = mediaPolicy.max_file_size_bytes.profile_image;
    for (const file of files) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number]))
        return err("VALIDATION_ERROR", `Invalid file type: ${file.name}`);
      if (file.size > maxImageBytes)
        return err("VALIDATION_ERROR", `Image exceeds ${maxImageBytes} bytes`);
    }

    const profile = await this.ensureProfile(targetUserId);
    const existing = profile.images;
    const avatarCount = profile.avatarKey ? 1 : 0;
    if (existing.length + avatarCount + files.length > mediaPolicy.quotas.profile)
      return err("CONFLICT", "Profile image quota exceeded");

    const keys: string[] = [];
    for (const file of files) {
      const stored = await captureUploadValidation(() => this.deps.storeProfileImage(targetUserId, file));
      if (!stored.ok) {
        await deleteUploadedMedia((key) => this.deps.deleteMediaObject(key), keys);
        return stored;
      }
      keys.push(stored.data);
    }

    try {
      await this.updateProfileWithRelations(targetUserId, profile, {
        updatedAt: new Date().toISOString(),
      }, { images: [...existing, ...keys] });
    } catch (error) {
      await rethrowAfterUploadFailure(
        error,
        (key) => this.deps.deleteMediaObject(key),
        keys,
      );
    }
    await this.deps.writeAuditLog({
      entityType: "member_profile", action: "upload_images", actorId: sessionUser.id,
      entityId: targetUserId, diffTitle: access.username,
      detailText: JSON.stringify({ keys, count: keys.length }),
    });
    return ok({ keys });
  }

  async deleteProfileImages(sessionUser: SessionUser, targetUserId: string, imageKeys: string[]): Promise<ServiceResult<{ ok: true; deleted: number }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot delete media for this profile");
    const parsed = deleteProfileImagesSchema.safeParse({ keys: imageKeys });
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid image delete payload", parsed.error.flatten());

    const profile = await this.ensureProfile(targetUserId);
    const images = profile.images;
    const requested = new Set(parsed.data.keys);
    const keysToDelete = images.filter((key) => requested.has(key));
    await this.updateProfileWithRelations(targetUserId, profile, {
      updatedAt: new Date().toISOString(),
    }, { images: images.filter((key) => !requested.has(key)) });
    await Promise.allSettled(keysToDelete.map((key) => this.deps.deleteMediaObject(key)));
    if (keysToDelete.length > 0) {
      await this.deps.writeAuditLog({
        entityType: "member_profile", action: "delete_images", actorId: sessionUser.id,
        entityId: targetUserId, diffTitle: access.username,
        detailText: JSON.stringify({ keys: keysToDelete, deleted: keysToDelete.length }),
      });
    }
    return ok({ ok: true, deleted: keysToDelete.length });
  }

  async uploadAvatar(sessionUser: SessionUser, targetUserId: string, file: File): Promise<ServiceResult<{ key: string }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot upload media for this profile");

    if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number]))
      return err("VALIDATION_ERROR", `Invalid file type: ${file.name}`);
    const mediaPolicy = await (this.deps.getMediaPolicy?.() ?? Promise.resolve(DEFAULT_SITE_MEDIA_POLICY));
    const maxImageBytes = mediaPolicy.max_file_size_bytes.profile_image;
    if (file.size > maxImageBytes)
      return err("VALIDATION_ERROR", `Image exceeds ${maxImageBytes} bytes`);

    const profile = await this.ensureProfile(targetUserId);
    const existing = profile.images;
    const avatarCount = profile.avatarKey ? 1 : 0;
    if (existing.length + avatarCount + 1 - avatarCount > mediaPolicy.quotas.profile)
      return err("CONFLICT", "Profile image quota exceeded");

    const stored = await captureUploadValidation(() => this.deps.storeProfileImage(targetUserId, file));
    if (!stored.ok) return stored;
    const key = stored.data;
    try {
      await this.updateProfileWithRelations(targetUserId, profile, {
        avatarKey: key,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      await rethrowAfterUploadFailure(
        error,
        (uploadedKey) => this.deps.deleteMediaObject(uploadedKey),
        [key],
      );
    }
    await this.deps.writeAuditLog({
      entityType: "member_profile", action: "upload_avatar", actorId: sessionUser.id,
      entityId: targetUserId, diffTitle: access.username,
      detailText: JSON.stringify({ key, replaced: profile.avatarKey ?? null }),
    });
    if (profile.avatarKey) await Promise.allSettled([this.deps.deleteMediaObject(profile.avatarKey)]);
    return ok({ key });
  }

  async deleteAvatar(sessionUser: SessionUser, targetUserId: string): Promise<ServiceResult<{ ok: true }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot delete media for this profile");

    const profile = await this.ensureProfile(targetUserId);
    await this.updateProfileWithRelations(targetUserId, profile, {
      avatarKey: null,
      updatedAt: new Date().toISOString(),
    });
    if (profile.avatarKey) await Promise.allSettled([this.deps.deleteMediaObject(profile.avatarKey)]);
    await this.deps.writeAuditLog({
      entityType: "member_profile", action: "delete_avatar", actorId: sessionUser.id,
      entityId: targetUserId, diffTitle: access.username,
    });
    return ok({ ok: true });
  }

  async uploadProfileAudio(sessionUser: SessionUser, targetUserId: string, audioFile: File): Promise<ServiceResult<{ key: string }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot upload media for this profile");

    const allowedAudioTypes = ["audio/ogg", "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav"];
    if (audioFile.type && !allowedAudioTypes.includes(audioFile.type))
      return err("VALIDATION_ERROR", `Invalid audio type: ${audioFile.type}`);
    const mediaPolicy = await (this.deps.getMediaPolicy?.() ?? Promise.resolve(DEFAULT_SITE_MEDIA_POLICY));
    const maxAudioBytes = mediaPolicy.max_file_size_bytes.profile_audio;
    if (audioFile.size > maxAudioBytes)
      return err("VALIDATION_ERROR", `Audio exceeds ${maxAudioBytes} bytes`);

    const profile = await this.ensureProfile(targetUserId);
    const stored = await captureUploadValidation(() => this.deps.storeProfileAudio(targetUserId, audioFile));
    if (!stored.ok) return stored;
    const key = stored.data;
    try {
      await this.updateProfileWithRelations(targetUserId, profile, {
        audioKey: key,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      await rethrowAfterUploadFailure(
        error,
        (uploadedKey) => this.deps.deleteMediaObject(uploadedKey),
        [key],
      );
    }
    await this.deps.writeAuditLog({
      entityType: "member_profile", action: "upload_audio", actorId: sessionUser.id,
      entityId: targetUserId, diffTitle: access.username,
      detailText: JSON.stringify({ key, replaced: profile.audioKey ?? null }),
    });
    if (profile.audioKey) await Promise.allSettled([this.deps.deleteMediaObject(profile.audioKey)]);
    return ok({ key });
  }

  async deleteProfileAudio(sessionUser: SessionUser, targetUserId: string): Promise<ServiceResult<{ ok: true }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot delete media for this profile");

    const profile = await this.ensureProfile(targetUserId);
    await this.updateProfileWithRelations(targetUserId, profile, {
      audioKey: null,
      updatedAt: new Date().toISOString(),
    });
    if (profile.audioKey) await Promise.allSettled([this.deps.deleteMediaObject(profile.audioKey)]);
    await this.deps.writeAuditLog({
      entityType: "member_profile", action: "delete_audio", actorId: sessionUser.id,
      entityId: targetUserId, diffTitle: access.username,
    });
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
    const passwordUpdate = this.db.update(userAuthPassword)
      .set({ passwordHash: next.passwordHash, salt: next.salt, updatedAt: new Date().toISOString() })
      .where(eq(userAuthPassword.userId, targetUserId));
    const sessionDeletion = this.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    await this.db.batch([passwordUpdate, sessionDeletion]);
    this.deps.clearSessionCookie();
    const targetUser = (await this.db.select({ username: users.username }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    await this.deps.writeAuditLog({ entityType: "user_auth", action: "change_password", actorId: sessionUser.id, entityId: targetUserId, diffTitle: targetUser?.username ?? null });
    return ok({ ok: true });
  }

  async changeUsername(sessionUser: SessionUser, targetUserId: string, body: unknown): Promise<ServiceResult<{ ok: true }>> {
    if (sessionUser.id !== targetUserId) return err("FORBIDDEN", "Username change is allowed for self only");

    const parsed = changeUsernameSchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid username change payload", parsed.error.flatten());

    /*
     * Same reservation enforced at registration (AuthService.register) and at
     * admin-created accounts (AdminService.createMember): nothing legitimately
     * renames an account into the system-test namespace, and system-test
     * cleanup would permanently delete it with the run that owns it.
     */
    if (isReservedSystemTestUsername(parsed.data.newUsername)) {
      return err("VALIDATION_ERROR", `Usernames beginning with "${SYSTEM_TEST_USERNAME_PREFIX}" are reserved`);
    }

    const auth = (
      await this.db.select({ passwordHash: userAuthPassword.passwordHash, salt: userAuthPassword.salt })
        .from(userAuthPassword).where(eq(userAuthPassword.userId, targetUserId)).limit(1)
    )[0];
    if (!auth) return err("NOT_FOUND", "Password record not found");

    if (!(await this.deps.verifyPassword(parsed.data.currentPassword, auth.salt, auth.passwordHash)))
      return err("UNAUTHORIZED", "Current password is incorrect");

    const dup = (
      await this.db.select({ id: users.id }).from(users)
        .where(and(usernameEquals(parsed.data.newUsername), isNull(users.deletedAt))).limit(1)
    )[0];
    if (dup && dup.id !== targetUserId) return err("CONFLICT", "Username already taken");

    const oldUser = (await this.db.select({ username: users.username }).from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    try {
      await this.db.update(users).set({ username: parsed.data.newUsername, updatedAt: new Date().toISOString() }).where(eq(users.id, targetUserId));
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.username")) return err("CONFLICT", "Username already taken");
      throw error;
    }
    await this.deps.writeAuditLog({
      entityType: "user", action: "change_username", actorId: sessionUser.id,
      entityId: targetUserId, diffTitle: parsed.data.newUsername,
      detailText: JSON.stringify({ username: { from: oldUser?.username ?? null, to: parsed.data.newUsername } }),
    });

    await this.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    await this.deps.destroySession();
    return ok({ ok: true });
  }
}
