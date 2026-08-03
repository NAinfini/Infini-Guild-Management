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
import { memberProfileClasses, memberProfiles, sessions, userAuthPassword, users } from "../db/schema";
import { captureUploadValidation } from "./media";
import { deleteUploadedMedia, rethrowAfterUploadFailure } from "./media-upload-compensation";
import { parseMediaKey } from "./media-keys";
import { buildReplaceMediaRefsStatements } from "./media-references";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern, parseStringArray, parseRecord, usernameEquals } from "./helpers";
import { logger } from "../utils/logger";

type DrizzleDb = ReturnType<typeof drizzle>;

type SessionUser = { id: string; role: Role; permissions: ReadonlySet<string> };

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
  power: number;
  classes: string;
  titleHtml: string | null;
  bio: string | null;
  images: string;
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
  classes?: string;
  titleHtml?: string | null;
  bio?: string | null;
  images?: string;
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
  ["classes", "classes"],
  ["titleHtml", "title_html"],
  ["bio", "bio"],
  ["images", "images"],
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
    ...parseStringArray(profile.images),
    ...(profile.avatarKey ? [profile.avatarKey] : []),
    ...(profile.audioKey ? [profile.audioKey] : []),
  ].filter((key) => {
    const parsed = parseMediaKey(key);
    return parsed?.entityId === userId
      && (parsed.kind === "member_image" || parsed.kind === "member_audio");
  });
}

// --- Helpers ---

const TITLE_HTML_ALLOWED_TAGS = new Set(["span", "b", "strong", "i", "em", "u", "br"]);
const STYLE_PROP_ALLOWLIST = new Set(["color", "font-weight", "font-style", "text-decoration", "background-color"]);
const STYLE_VALUE_MAX_LENGTH = 64;
// Colours, keywords and rgb()/hsl() functions only — no quotes, no semicolons,
// nothing that could terminate the attribute we build around it.
const STYLE_VALUE_PATTERN = /^[\w\s#,.%()/-]*$/;
const STYLE_VALUE_DENYLIST = /url\s*\(|image\s*\(|expression\s*\(|\\/i;

function sanitizeStyleAttr(raw: string): string {
  const declarations = raw.split(";").map((d) => d.trim()).filter(Boolean);
  const safe = declarations.filter((decl) => {
    const colonIdx = decl.indexOf(":");
    if (colonIdx === -1) return false;
    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    if (!STYLE_PROP_ALLOWLIST.has(prop)) return false;
    const value = decl.slice(colonIdx + 1).trim();
    if (!value || value.length > STYLE_VALUE_MAX_LENGTH) return false;
    if (!STYLE_VALUE_PATTERN.test(value)) return false;
    return !STYLE_VALUE_DENYLIST.test(value);
  });
  return safe.join("; ");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escape-then-reconstruct sanitizer.
 *
 * Every `&`, `<` and `>` in the input is escaped first, so the only markup the
 * output can contain is markup this function emits itself from the fixed
 * allowlist below. A subtractive sanitizer (regex that strips disallowed tags)
 * is structurally unsafe here: anything its pattern fails to match — unclosed
 * tags, comment tricks, malformed attributes — survives into the output.
 *
 * Rendering code still sanitizes with DOMPurify; this keeps the *stored* value
 * trustworthy so any future consumer (export, digest mail, SSR) is safe too.
 */
export function sanitizeTitleHtml(html: string): string {
  return escapeHtml(html).replace(
    /&lt;(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^&]|&(?!gt;))*)&gt;/g,
    (_match, slash: string, tagName: string, attrs: string) => {
      const tag = tagName.toLowerCase();
      if (!TITLE_HTML_ALLOWED_TAGS.has(tag)) return "";
      if (tag === "br") return "<br>";
      if (slash) return `</${tag}>`;
      const styleMatch = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i);
      const safeStyle = styleMatch ? sanitizeStyleAttr(styleMatch[1]!) : "";
      return safeStyle ? `<${tag} style="${safeStyle}">` : `<${tag}>`;
    },
  );
}

function toUserPayload(user: UserRow) {
  const result = userSchema.safeParse({
    id: user.id,
    username: user.username,
    role: user.role,
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
    classes: parseStringArray(profile.classes),
    title_html: profile.titleHtml,
    bio: profile.bio,
    images: parseStringArray(profile.images),
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
  if (payload.classes !== undefined) patch.classes = JSON.stringify(payload.classes);
  if (payload.title_html !== undefined) patch.titleHtml = payload.title_html === null ? null : sanitizeTitleHtml(payload.title_html);
  if (payload.bio !== undefined) patch.bio = payload.bio;
  if (payload.images !== undefined) patch.images = JSON.stringify(payload.images);
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
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const fieldMap: Array<[keyof ProfilePatch, keyof ProfileRow]> = [
    ["power", "power"],
    ["classes", "classes"],
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
      sql`EXISTS (SELECT 1 FROM ${memberProfileClasses} WHERE ${memberProfileClasses.userId} = ${users.id} AND ${memberProfileClasses.className} = ${params.classFilter})`,
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
  power: memberProfiles.power,
  classes: memberProfiles.classes,
  titleHtml: memberProfiles.titleHtml,
  bio: memberProfiles.bio,
  images: memberProfiles.images,
  avatarKey: memberProfiles.avatarKey,
  audioKey: memberProfiles.audioKey,
  videoUrls: memberProfiles.videoUrls,
  availability: memberProfiles.availability,
  // Derived from the absence history (current-or-next absence); the legacy
  // member_profiles.vacation_start/vacation_end columns are no longer read.
  vacationStart: sql<string | null>`(SELECT ma.start_date FROM member_absences ma WHERE ma.user_id = ${users.id} AND ma.end_date >= date('now') ORDER BY ma.start_date ASC LIMIT 1)`.as("derived_vacation_start"),
  vacationEnd: sql<string | null>`(SELECT ma.end_date FROM member_absences ma WHERE ma.user_id = ${users.id} AND ma.end_date >= date('now') ORDER BY ma.start_date ASC LIMIT 1)`.as("derived_vacation_end"),
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
      power: (row.power as number) ?? 0,
      classes: (row.classes as string) ?? "[]",
      titleHtml: (row.titleHtml as string | null) ?? null,
      bio: (row.bio as string | null) ?? null,
      images: (row.images as string) ?? "[]",
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
        .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1)
    )[0];
    if (!row) return null;
    return {
      data: rowToUserWithProfile(row as unknown as Record<string, unknown>),
      profileExists: (row as unknown as Record<string, unknown>).profileId != null,
    };
  }

  private async ensureProfile(userId: string): Promise<ProfileRow> {
    const row = (
      await this.db.select().from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1)
    )[0];
    if (row) return row;
    // Profile missing — shouldn't happen post-registration but handle gracefully
    await this.db.insert(memberProfiles).values({
      id: nanoid(), userId, power: 0, classes: "[]", images: "[]", videoUrls: "[]",
    });
    const created = (
      await this.db.select().from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1)
    )[0];
    if (!created) throw new Error("Failed to create profile");
    return created;
  }

  private async syncProfileClassLookup(userId: string, classesJson: string): Promise<void> {
    const classNames = [...new Set(parseStringArray(classesJson))];
    await this.db.delete(memberProfileClasses).where(eq(memberProfileClasses.userId, userId));
    if (classNames.length === 0) {
      return;
    }
    await this.db.insert(memberProfileClasses).values(
      classNames.map((className) => ({ userId, className })),
    );
  }

  private async updateProfileWithMediaRefs(targetUserId: string, current: ProfileRow, patch: ProfilePatch): Promise<void> {
    const next = {
      images: patch.images ?? current.images,
      avatarKey: patch.avatarKey === undefined ? current.avatarKey : patch.avatarKey,
      audioKey: patch.audioKey === undefined ? current.audioKey : patch.audioKey,
    };
    await this.deps.rawDb.batch([
      buildProfileUpdateStatement(this.deps.rawDb, targetUserId, patch),
      ...buildReplaceMediaRefsStatements(this.deps.rawDb, "member_profile", targetUserId, profileMediaKeys(targetUserId, next)),
    ]);
  }

  private async canEditTarget(sessionUser: SessionUser, targetUserId: string): Promise<{ status: "allowed"; username: string } | { status: "forbidden" | "not_found"; username: null }> {
    const target = (
      await this.db.select({ role: users.role, deletedAt: users.deletedAt, username: users.username }).from(users).where(eq(users.id, targetUserId)).limit(1)
    )[0];
    if (!target || target.deletedAt !== null) return { status: "not_found", username: null };
    if (sessionUser.id === targetUserId) return { status: "allowed", username: target.username };
    if (!sessionUser.permissions.has("admin.users.edit")) return { status: "forbidden", username: null };
    if (target.role === "admin" && sessionUser.role !== "admin") return { status: "forbidden", username: null };
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

    const data = rows.map((row) => {
      const normalized = rowToUserWithProfile(row as unknown as Record<string, unknown>);
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
      const existingImages = new Set(parseStringArray(oldProfile.images));
      const foreignKey = parsed.data.images.find((key) => !existingImages.has(key));
      if (foreignKey !== undefined) {
        return err("VALIDATION_ERROR", `images may only reorder or remove existing profile media: ${foreignKey}`);
      }
    }

    const patch = buildProfilePatch(parsed.data);
    if (patch.images !== undefined) {
      await this.updateProfileWithMediaRefs(targetUserId, oldProfile, patch);
    } else {
      await this.db.update(memberProfiles).set(patch).where(eq(memberProfiles.userId, targetUserId));
    }
    if (patch.classes !== undefined) {
      await this.syncProfileClassLookup(targetUserId, patch.classes);
    }

    const updated = await this.loadUserWithProfile(targetUserId);
    if (!updated) return err("NOT_FOUND", "User not found");

    const diff = buildProfileDiff(oldProfile, patch);
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
    const existing = parseStringArray(profile.images);
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
      await this.updateProfileWithMediaRefs(targetUserId, profile, {
        images: JSON.stringify([...existing, ...keys]),
        updatedAt: new Date().toISOString(),
      });
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
    const images = parseStringArray(profile.images);
    const requested = new Set(parsed.data.keys);
    const keysToDelete = images.filter((key) => requested.has(key));
    await this.updateProfileWithMediaRefs(targetUserId, profile, {
      images: JSON.stringify(images.filter((key) => !requested.has(key))),
      updatedAt: new Date().toISOString(),
    });
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
    const existing = parseStringArray(profile.images);
    const avatarCount = profile.avatarKey ? 1 : 0;
    if (existing.length + avatarCount + 1 - avatarCount > mediaPolicy.quotas.profile)
      return err("CONFLICT", "Profile image quota exceeded");

    const stored = await captureUploadValidation(() => this.deps.storeProfileImage(targetUserId, file));
    if (!stored.ok) return stored;
    const key = stored.data;
    try {
      await this.updateProfileWithMediaRefs(targetUserId, profile, {
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
    await this.updateProfileWithMediaRefs(targetUserId, profile, {
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
      await this.updateProfileWithMediaRefs(targetUserId, profile, {
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
    await this.updateProfileWithMediaRefs(targetUserId, profile, {
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
     * renames an account into the system-test namespace, and the cleanup cron
     * would permanently delete it a day later.
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
