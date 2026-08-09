import {
  PERMISSIONS,
  adminUpdateProfileSchema,
  changePasswordSchema,
  changeUsernameSchema,
  deleteProfileImagesSchema,
  memberProfileSchema,
  updateProfileSchema,
  userSchema,
  type Permission,
  type JsonValue,
  type MemberAvailability,
  type Role,
  type SiteMediaPolicy,
} from "@guild/shared";
import { SYSTEM_TEST_USERNAME_PREFIX, isReservedSystemTestUsername } from "@guild/shared/config/system-test";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { memberProfileClasses, memberProfiles, roles, sessions, userAuthPassword, users } from "../db/schema";
import { sanitizeInlineHtml } from "./inline-html";
import type { WriteAuditLogInput } from "./audit";
import type { LinkedMedia, MediaService, ParsedImageMediaUpload } from "./MediaService";
import { MediaValidationError } from "./MediaService";
import {
  buildReplaceMemberClassStatements,
  buildReplaceMemberAvailabilityStatements,
  buildReplaceMemberVideoStatements,
  availabilityFromStorage,
  loadMemberClasses,
  loadMemberAvailabilityWindows,
  loadMemberVideos,
  memberAvailabilityEquals,
} from "./ordered-relations";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern, usernameEquals } from "./helpers";
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
  userId: string;
  power: number;
  classes: string[];
  titleHtml: string | null;
  bio: string | null;
  images: string[];
  avatarMediaId: string | null;
  audioMediaId: string | null;
  audioName: string | null;
  videoUrls: string[];
  availability: MemberAvailability | null;
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
  availabilityTimezone?: string | null;
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
  writeAuditLog: (input: WriteAuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
  mediaService: MediaService;
  verifyPassword: (password: string, salt: string, hash: string) => Promise<boolean>;
  createPasswordHash: (password: string) => Promise<{ passwordHash: string; salt: string }>;
  destroySession: () => Promise<void>;
  clearSessionCookie: () => void;
  getMediaPolicy: () => Promise<SiteMediaPolicy>;
};

const PROFILE_PATCH_COLUMNS: ReadonlyArray<readonly [keyof ProfilePatch, string]> = [
  ["power", "power"],
  ["titleHtml", "title_html"],
  ["bio", "bio"],
  ["availabilityTimezone", "availability_timezone"],
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
    user_id: profile.userId,
    power: profile.power,
    classes: profile.classes,
    title_html: profile.titleHtml,
    bio: profile.bio,
    images: profile.images,
    avatar_media_id: profile.avatarMediaId,
    audio_media_id: profile.audioMediaId,
    audio_name: profile.audioName,
    video_urls: profile.videoUrls,
    availability: options.includePrivate ? profile.availability : null,
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
  if (payload.availability !== undefined) {
    patch.availabilityTimezone = payload.availability?.timezone ?? null;
  }
  if ("notes" in payload && payload.notes !== undefined) patch.notes = payload.notes;
  patch.updatedAt = new Date().toISOString();
  return patch;
}

function buildProfileDiff(
  old: ProfileRow,
  patch: ProfilePatch,
  relations: { classes?: string[]; availability?: MemberAvailability | null } = {},
): Record<string, { from: JsonValue; to: JsonValue }> | null {
  const diff: Record<string, { from: JsonValue; to: JsonValue }> = {};
  const fieldMap: Array<[keyof ProfilePatch, keyof ProfileRow]> = [
    ["power", "power"],
    ["titleHtml", "titleHtml"],
    ["bio", "bio"],
    ["notes", "notes"],
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
  if (relations.availability !== undefined && !memberAvailabilityEquals(old.availability, relations.availability)) {
    diff.availability = { from: old.availability, to: relations.availability };
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
  profileUserId: memberProfiles.userId,
  power: memberProfiles.power,
  titleHtml: memberProfiles.titleHtml,
  bio: memberProfiles.bio,
  availabilityTimezone: memberProfiles.availabilityTimezone,
  // Derived from the absence history (current-or-next absence).
  vacationStart: sql<string | null>`(SELECT ma.start_date FROM member_absences ma WHERE ma.user_id = ${users.id} AND ma.end_date >= date('now') ORDER BY ma.start_date ASC LIMIT 1)`.as("derived_vacation_start"),
  vacationEnd: sql<string | null>`(SELECT ma.end_date FROM member_absences ma WHERE ma.user_id = ${users.id} AND ma.end_date >= date('now') ORDER BY ma.start_date ASC LIMIT 1)`.as("derived_vacation_end"),
  notes: memberProfiles.notes,
  profileCreatedAt: memberProfiles.createdAt,
  profileUpdatedAt: memberProfiles.updatedAt,
} as const;

function rowToUserWithProfile(
  row: Record<string, unknown>,
  relations: {
    classes?: string[];
    videos?: string[];
    media?: LinkedMedia[];
    availability?: MemberAvailability | null;
  } = {},
): UserWithProfileRow {
  const media = relations.media ?? [];
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
      userId: (row.profileUserId as string) ?? (row.userId as string),
      power: (row.power as number) ?? 0,
      classes: relations.classes ?? [],
      titleHtml: (row.titleHtml as string | null) ?? null,
      bio: (row.bio as string | null) ?? null,
      images: media.filter((item) => item.slot === "image").map((item) => item.mediaId),
      avatarMediaId: media.find((item) => item.slot === "avatar")?.mediaId ?? null,
      audioMediaId: media.find((item) => item.slot === "audio")?.mediaId ?? null,
      audioName: media.find((item) => item.slot === "audio")?.originalName ?? null,
      videoUrls: relations.videos ?? [],
      availability: relations.availability ?? null,
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
    const [classes, videos, media, availabilityWindows] = await Promise.all([
      loadMemberClasses(this.deps.rawDb, [userId]),
      loadMemberVideos(this.deps.rawDb, [userId]),
      this.deps.mediaService.listLinkedMedia("member_profile", [userId]),
      loadMemberAvailabilityWindows(this.deps.rawDb, [userId]),
    ]);
    return {
      data: rowToUserWithProfile(row as unknown as Record<string, unknown>, {
        classes: classes.get(userId) ?? [],
        videos: videos.get(userId) ?? [],
        media: media.get(userId) ?? [],
        availability: availabilityFromStorage(
          ((row as unknown as Record<string, unknown>).availabilityTimezone as string | null | undefined) ?? null,
          availabilityWindows.get(userId) ?? [],
        ),
      }),
      profileExists: (row as unknown as Record<string, unknown>).profileUserId != null,
    };
  }

  private async ensureProfile(userId: string): Promise<ProfileRow> {
    let row = (await this.db.select().from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1))[0];
    // Profile missing — shouldn't happen post-registration but handle gracefully
    if (!row) {
      await this.db.insert(memberProfiles).values({ userId, power: 0 });
      row = (await this.db.select().from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1))[0];
    }
    if (!row) throw new Error("Failed to create profile");
    const [classes, videos, media, availabilityWindows] = await Promise.all([
      loadMemberClasses(this.deps.rawDb, [userId]),
      loadMemberVideos(this.deps.rawDb, [userId]),
      this.deps.mediaService.listLinkedMedia("member_profile", [userId]),
      loadMemberAvailabilityWindows(this.deps.rawDb, [userId]),
    ]);
    return {
      ...row,
      classes: classes.get(userId) ?? [],
      images: (media.get(userId) ?? []).filter((item) => item.slot === "image").map((item) => item.mediaId),
      avatarMediaId: (media.get(userId) ?? []).find((item) => item.slot === "avatar")?.mediaId ?? null,
      audioMediaId: (media.get(userId) ?? []).find((item) => item.slot === "audio")?.mediaId ?? null,
      audioName: (media.get(userId) ?? []).find((item) => item.slot === "audio")?.originalName ?? null,
      videoUrls: videos.get(userId) ?? [],
      availability: availabilityFromStorage(row.availabilityTimezone, availabilityWindows.get(userId) ?? []),
      vacationStart: null,
      vacationEnd: null,
    };
  }

  private async updateProfileWithRelations(
    targetUserId: string,
    _current: ProfileRow,
    patch: ProfilePatch,
    relations: {
      classes?: string[];
      videos?: string[];
      availability?: MemberAvailability | null;
    } = {},
  ): Promise<void> {
    await this.deps.rawDb.batch([
      buildProfileUpdateStatement(this.deps.rawDb, targetUserId, patch),
      ...(relations.classes === undefined ? [] : buildReplaceMemberClassStatements(this.deps.rawDb, targetUserId, relations.classes)),
      ...(relations.videos === undefined ? [] : buildReplaceMemberVideoStatements(this.deps.rawDb, targetUserId, relations.videos)),
      ...(relations.availability === undefined ? [] : buildReplaceMemberAvailabilityStatements(this.deps.rawDb, targetUserId, relations.availability)),
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
    const [classes, videos, media, availabilityWindows] = await Promise.all([
      loadMemberClasses(this.deps.rawDb, userIds),
      loadMemberVideos(this.deps.rawDb, userIds),
      this.deps.mediaService.listLinkedMedia("member_profile", userIds),
      loadMemberAvailabilityWindows(this.deps.rawDb, userIds),
    ]);
    const data = rows.map((row) => {
      const normalized = rowToUserWithProfile(row as unknown as Record<string, unknown>, {
        classes: classes.get(row.userId) ?? [],
        videos: videos.get(row.userId) ?? [],
        media: media.get(row.userId) ?? [],
        availability: availabilityFromStorage(row.availabilityTimezone, availabilityWindows.get(row.userId) ?? []),
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

    // `images` only reorders or removes assets already linked to this profile.
    if (parsed.data.images !== undefined) {
      const existingImages = new Set(oldProfile.images);
      const foreignMediaId = parsed.data.images.find((mediaId) => !existingImages.has(mediaId));
      if (foreignMediaId !== undefined) {
        return err("VALIDATION_ERROR", `images may only reorder or remove existing profile media: ${foreignMediaId}`);
      }
    }

    const patch = buildProfilePatch(parsed.data);
    const relations = {
      classes: parsed.data.classes,
      videos: parsed.data.video_urls,
      availability: parsed.data.availability,
    };
    if (parsed.data.images !== undefined) {
      await this.deps.mediaService.replace({
        entityType: "member_profile",
        entityId: targetUserId,
        slot: "image",
        media: parsed.data.images.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
        ownerUserId: sessionUser.id,
        now: patch.updatedAt!,
      });
    }
    try {
      if (relations.classes !== undefined || relations.videos !== undefined || relations.availability !== undefined) {
        await this.updateProfileWithRelations(targetUserId, oldProfile, patch, relations);
      } else {
        await this.db.update(memberProfiles).set(patch).where(eq(memberProfiles.userId, targetUserId));
      }
    } catch (error) {
      if (parsed.data.images !== undefined) {
        try {
          await this.deps.mediaService.replace({
            entityType: "member_profile",
            entityId: targetUserId,
            slot: "image",
            media: oldProfile.images.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
            now: patch.updatedAt!,
          });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Profile ${targetUserId} update and media rollback both failed`);
        }
      }
      throw error;
    }

    const updated = await this.loadUserWithProfile(targetUserId);
    if (!updated) return err("NOT_FOUND", "User not found");

    const diff = buildProfileDiff(oldProfile, patch, {
      classes: relations.classes,
      availability: relations.availability,
    });
    await this.deps.writeAuditLog({
      entityType: "member_profile", action: "update", actorId: sessionUser.id,
      entityId: targetUserId, diffTitle: updated.data.user.username,
      detail: diff,
    });
    const profileHint = sessionUser.id === targetUserId ? "profile_updated" : "profile_moderated";
    await this.deps.publishEntityChanged({ entityType: "member_profile", entityId: targetUserId, hint: profileHint });
    return ok(toProfilePayload(updated.data.profile, { includeNotes: sessionUser.permissions.has("admin.users.view"), includePrivate: true }));
  }

  async uploadProfileImages(sessionUser: SessionUser, targetUserId: string, uploads: readonly ParsedImageMediaUpload[]): Promise<ServiceResult<{ media_ids: string[] }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot upload media for this profile");
    if (uploads.length === 0) return err("VALIDATION_ERROR", "No files provided");

    const mediaPolicy = await this.deps.getMediaPolicy();
    const maxImageBytes = mediaPolicy.max_file_size_bytes.profile_image;

    const profile = await this.ensureProfile(targetUserId);
    const now = new Date().toISOString();
    if (!await this.deps.mediaService.checkQuota({
      purpose: "member_image",
      ownerUserId: sessionUser.id,
      scope: { kind: "entity", entityType: "member_profile", entityId: targetUserId },
      limit: mediaPolicy.quotas.profile,
      incomingCount: uploads.length,
      now,
    })) return err("CONFLICT", "Profile image quota exceeded");
    try {
      const created = await this.deps.mediaService.createImages({
        ownerUserId: sessionUser.id,
        purpose: "member_image",
        uploads,
        now,
        maxBytes: maxImageBytes,
      });
      await this.deps.mediaService.replace({
        entityType: "member_profile",
        entityId: targetUserId,
        slot: "image",
        media: [...profile.images, ...created.mediaIds].map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
        ownerUserId: sessionUser.id,
        now,
      });
      try {
        await this.db.update(memberProfiles).set({ updatedAt: now }).where(eq(memberProfiles.userId, targetUserId));
      } catch (error) {
        try {
          await this.deps.mediaService.replace({ entityType: "member_profile", entityId: targetUserId, slot: "image", media: profile.images.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), now });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Profile ${targetUserId} image upload and media rollback both failed`);
        }
        throw error;
      }
      await this.deps.writeAuditLog({
        entityType: "member_profile", action: "upload_images", actorId: sessionUser.id,
        entityId: targetUserId, diffTitle: access.username,
        detail: { media_ids: created.mediaIds, count: created.mediaIds.length },
      });
      return ok({ media_ids: created.mediaIds });
    } catch (error) {
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }
  }

  async deleteProfileImages(sessionUser: SessionUser, targetUserId: string, mediaIds: string[]): Promise<ServiceResult<{ ok: true; deleted: number }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot delete media for this profile");
    const parsed = deleteProfileImagesSchema.safeParse({ media_ids: mediaIds });
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid image delete payload", parsed.error.flatten());

    const profile = await this.ensureProfile(targetUserId);
    const images = profile.images;
    const requested = new Set(parsed.data.media_ids);
    const mediaIdsToDelete = images.filter((mediaId) => requested.has(mediaId));
    const now = new Date().toISOString();
    await this.deps.mediaService.replace({
      entityType: "member_profile",
      entityId: targetUserId,
      slot: "image",
      media: images.filter((mediaId) => !requested.has(mediaId)).map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
      ownerUserId: sessionUser.id,
      now,
    });
    try {
      await this.db.update(memberProfiles).set({ updatedAt: now }).where(eq(memberProfiles.userId, targetUserId));
    } catch (error) {
      try {
        await this.deps.mediaService.replace({ entityType: "member_profile", entityId: targetUserId, slot: "image", media: images.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), now });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Profile ${targetUserId} image deletion and media rollback both failed`);
      }
      throw error;
    }
    if (mediaIdsToDelete.length > 0) {
      await this.deps.writeAuditLog({
        entityType: "member_profile", action: "delete_images", actorId: sessionUser.id,
        entityId: targetUserId, diffTitle: access.username,
        detail: { media_ids: mediaIdsToDelete, deleted: mediaIdsToDelete.length },
      });
    }
    return ok({ ok: true, deleted: mediaIdsToDelete.length });
  }

  async uploadAvatar(sessionUser: SessionUser, targetUserId: string, upload: ParsedImageMediaUpload): Promise<ServiceResult<{ media_id: string }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot upload media for this profile");

    const mediaPolicy = await this.deps.getMediaPolicy();
    const maxImageBytes = mediaPolicy.max_file_size_bytes.profile_image;

    await this.ensureProfile(targetUserId);
    const now = new Date().toISOString();
    const previousAvatar = await this.deps.mediaService.listLinkedMediaIds("member_profile", targetUserId, "avatar");
    try {
      const created = await this.deps.mediaService.createImages({
        ownerUserId: sessionUser.id,
        purpose: "member_avatar",
        uploads: [upload],
        now,
        maxBytes: maxImageBytes,
      });
      const mediaId = created.mediaIds[0]!;
      await this.deps.mediaService.replace({ entityType: "member_profile", entityId: targetUserId, slot: "avatar", media: [{ mediaId, sortOrder: 0 }], ownerUserId: sessionUser.id, now });
      try {
        await this.db.update(memberProfiles).set({ updatedAt: now }).where(eq(memberProfiles.userId, targetUserId));
      } catch (error) {
        try {
          await this.deps.mediaService.replace({ entityType: "member_profile", entityId: targetUserId, slot: "avatar", media: previousAvatar.map((mediaId) => ({ mediaId, sortOrder: 0 })), now });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Profile ${targetUserId} avatar upload and media rollback both failed`);
        }
        throw error;
      }
      await this.deps.writeAuditLog({
        entityType: "member_profile", action: "upload_avatar", actorId: sessionUser.id,
        entityId: targetUserId, diffTitle: access.username,
        detail: { media_id: mediaId },
      });
      return ok({ media_id: mediaId });
    } catch (error) {
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }
  }

  async deleteAvatar(sessionUser: SessionUser, targetUserId: string): Promise<ServiceResult<{ ok: true }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot delete media for this profile");

    await this.ensureProfile(targetUserId);
    const now = new Date().toISOString();
    const previousAvatar = await this.deps.mediaService.listLinkedMediaIds("member_profile", targetUserId, "avatar");
    await this.deps.mediaService.replace({ entityType: "member_profile", entityId: targetUserId, slot: "avatar", media: [], ownerUserId: sessionUser.id, now });
    try {
      await this.db.update(memberProfiles).set({ updatedAt: now }).where(eq(memberProfiles.userId, targetUserId));
    } catch (error) {
      try {
        await this.deps.mediaService.replace({ entityType: "member_profile", entityId: targetUserId, slot: "avatar", media: previousAvatar.map((mediaId) => ({ mediaId, sortOrder: 0 })), now });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Profile ${targetUserId} avatar deletion and media rollback both failed`);
      }
      throw error;
    }
    await this.deps.writeAuditLog({
      entityType: "member_profile", action: "delete_avatar", actorId: sessionUser.id,
      entityId: targetUserId, diffTitle: access.username,
    });
    return ok({ ok: true });
  }

  async uploadProfileAudio(sessionUser: SessionUser, targetUserId: string, audioFile: File): Promise<ServiceResult<{ media_id: string }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot upload media for this profile");

    const mediaPolicy = await this.deps.getMediaPolicy();
    const maxAudioBytes = mediaPolicy.max_file_size_bytes.profile_audio;

    await this.ensureProfile(targetUserId);
    const now = new Date().toISOString();
    const previousAudio = await this.deps.mediaService.listLinkedMediaIds("member_profile", targetUserId, "audio");
    try {
      const created = await this.deps.mediaService.createAudio({
        ownerUserId: sessionUser.id,
        originalName: audioFile.name,
        data: await audioFile.arrayBuffer(),
        now,
        maxBytes: maxAudioBytes,
      });
      await this.deps.mediaService.replace({ entityType: "member_profile", entityId: targetUserId, slot: "audio", media: [{ mediaId: created.mediaId, sortOrder: 0 }], ownerUserId: sessionUser.id, now });
      try {
        await this.db.update(memberProfiles).set({ updatedAt: now }).where(eq(memberProfiles.userId, targetUserId));
      } catch (error) {
        try {
          await this.deps.mediaService.replace({ entityType: "member_profile", entityId: targetUserId, slot: "audio", media: previousAudio.map((mediaId) => ({ mediaId, sortOrder: 0 })), now });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Profile ${targetUserId} audio upload and media rollback both failed`);
        }
        throw error;
      }
      await this.deps.writeAuditLog({
        entityType: "member_profile", action: "upload_audio", actorId: sessionUser.id,
        entityId: targetUserId, diffTitle: access.username,
        detail: { media_id: created.mediaId },
      });
      return ok({ media_id: created.mediaId });
    } catch (error) {
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }
  }

  async deleteProfileAudio(sessionUser: SessionUser, targetUserId: string): Promise<ServiceResult<{ ok: true }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot delete media for this profile");

    await this.ensureProfile(targetUserId);
    const now = new Date().toISOString();
    const previousAudio = await this.deps.mediaService.listLinkedMediaIds("member_profile", targetUserId, "audio");
    await this.deps.mediaService.replace({ entityType: "member_profile", entityId: targetUserId, slot: "audio", media: [], ownerUserId: sessionUser.id, now });
    try {
      await this.db.update(memberProfiles).set({ updatedAt: now }).where(eq(memberProfiles.userId, targetUserId));
    } catch (error) {
      try {
        await this.deps.mediaService.replace({ entityType: "member_profile", entityId: targetUserId, slot: "audio", media: previousAudio.map((mediaId) => ({ mediaId, sortOrder: 0 })), now });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Profile ${targetUserId} audio deletion and media rollback both failed`);
      }
      throw error;
    }
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
      detail: { username: { from: oldUser?.username ?? null, to: parsed.data.newUsername } },
    });

    await this.db.delete(sessions).where(eq(sessions.userId, targetUserId));
    await this.deps.destroySession();
    return ok({ ok: true });
  }
}
