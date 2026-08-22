import type { MemberProfile, User } from "@guild/shared";
import {
  adminUpdateProfileSchema,
  absenceWindowQuerySchema,
  inclusiveIsoDateSpanDays,
  memberProfileSchema,
  permissionSetToRecord,
  updateProfileSchema,
  userSchema,
} from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { LIMITS } from "@guild/shared/config/limits";
import { AppError, type RequestContext } from "@guild/kernel";
import { createAuditEvent } from "../audit/public.js";
import { assertTargetBelowActor } from "../auth/public.js";
import type { AudioUpload, ImageUpload } from "../media/public.js";
import type {
  AbsencePolicyReader,
  MemberMediaRecord,
  MemberProfileRecord,
  MemberProjection,
  MemberRecord,
  MembersStore,
  MemberView,
  MemberWireRecord,
  RosterPage,
} from "./member-types";
import { assertPortableLikeSearch } from "../../portable-search.js";
import { sanitizeInlineHtml } from "./inline-html";

const EMPTY_MEDIA: MemberMediaRecord = {
  avatarMediaId: null,
  images: [],
  audioMediaId: null,
  audioName: null,
};

export function resolveMemberProjection(context: RequestContext, externalView: boolean): MemberProjection {
  if (externalView || !context.authorization.isAuthenticated()) return "public";
  return context.authorization.has(PERMISSION_ID.ADMIN_USERS_VIEW) ? "admin" : "member";
}

export function buildUserWire(record: MemberRecord["user"]): User {
  return userSchema.parse({
    id: record.id,
    username: record.username,
    role: record.roleId,
    role_name: record.roleName,
    role_color: record.roleColor,
    role_level: record.roleLevel,
    permissions: permissionSetToRecord(new Set()),
    is_active: record.isActive,
    deleted_at: record.deletedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    last_login_at: record.lastLoginAt,
  });
}

export function buildProfileWire(
  profile: MemberProfileRecord,
  media: MemberMediaRecord,
  projection: MemberProjection,
): MemberProfile {
  return memberProfileSchema.parse({
    user_id: profile.userId,
    power: profile.power,
    classes: profile.classes,
    title_html: profile.titleHtml,
    bio: profile.bio,
    avatar_media_id: media.avatarMediaId,
    images: media.images,
    audio_media_id: media.audioMediaId,
    audio_name: media.audioName,
    video_urls: profile.videoUrls,
    availability: projection === "public" ? null : profile.availability,
    vacation_start: projection === "public" ? null : profile.vacationStart,
    vacation_end: projection === "public" ? null : profile.vacationEnd,
    notes: projection === "admin" ? profile.notes : null,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  });
}

export function buildMemberWire(view: MemberView): MemberWireRecord {
  return {
    user: buildUserWire(view.record.user),
    profile: buildProfileWire(view.record.profile, view.media, view.projection),
    badges: view.record.badges,
  };
}

export type MemberServiceOptions = Readonly<{
  store: MembersStore;
  media: import("./member-types").MemberMediaPort;
  absencePolicy: AbsencePolicyReader;
  generateId?: () => string;
}>;

export class MemberService {
  private readonly generateId: () => string;

  constructor(private readonly options: MemberServiceOptions) {
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
  }

  async list(context: RequestContext, input: Readonly<{
    page: number;
    limit: number;
    search?: string;
    roleId?: string;
    classId?: string;
    active?: boolean;
    includeTotal: boolean;
    externalView: boolean;
  }>): Promise<Readonly<{
    data: readonly MemberView[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>> {
    const projection = resolveMemberProjection(context, input.externalView);
    if (projection === "public" && input.limit > LIMITS.pagination.publicUsers) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: `Public roster limit must not exceed ${LIMITS.pagination.publicUsers}`,
      });
    }
    const search = input.search?.trim().toLowerCase() ?? "";
    assertPortableLikeSearch(search, "Member search");
    const page = await this.options.store.listRoster({
      page: input.page,
      limit: input.limit,
      search,
      ...(input.roleId === undefined ? {} : { roleId: input.roleId }),
      ...(input.classId === undefined ? {} : { classId: input.classId }),
      active: projection === "admin" ? input.active : true,
      includeTotal: input.includeTotal,
      projection,
    });
    const media = await this.options.media.listForMembers(page.data.map((entry) => entry.user.id));
    return {
      ...page,
      data: page.data.map((record) => ({
        record,
        media: media.get(record.user.id) ?? EMPTY_MEDIA,
        projection,
      })),
    };
  }

  async detail(context: RequestContext, userId: string, externalView = false): Promise<MemberView> {
    const projection = resolveMemberProjection(context, externalView);
    const record = await this.options.store.getMember(userId, projection);
    if (!record || (projection !== "admin" && !record.user.isActive)) {
      throw new AppError({ code: "NOT_FOUND", status: 404, message: "User not found" });
    }
    const media = await this.options.media.listForMembers([userId]);
    return { record, media: media.get(userId) ?? EMPTY_MEDIA, projection };
  }

  async readOwnProfile(userId: string): Promise<MemberProfile | null> {
    const record = await this.options.store.getMember(userId, "member");
    if (!record) return null;
    const media = await this.options.media.listForMembers([userId]);
    return buildProfileWire(record.profile, media.get(userId) ?? EMPTY_MEDIA, "member");
  }

  async stats(): Promise<Readonly<{ active_members: number; total_members: number }>> {
    const result = await this.options.store.getStats();
    return { active_members: result.activeMembers, total_members: result.totalMembers };
  }

  async updateProfile(context: RequestContext, userId: string, body: unknown): Promise<MemberProfile> {
    const { target, isAdminEdit } = await this.requireEditableTarget(context, userId);
    const parsed = (isAdminEdit ? adminUpdateProfileSchema : updateProfileSchema).safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: "Invalid profile payload",
        details: parsed.error.flatten(),
      });
    }
    const input = parsed.data;
    const notes: string | null | undefined = "notes" in input
      ? (input as { notes?: string | null }).notes
      : undefined;
    if (input.classes) {
      const missing = await this.options.store.findMissingClassIds(input.classes);
      if (missing.length > 0) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          status: 400,
          message: "Profile references unknown classes",
          details: { class_ids: missing },
        });
      }
    }

    const currentMedia = (await this.options.media.listForMembers([userId])).get(userId) ?? EMPTY_MEDIA;
    if (input.images) {
      const current = new Set(currentMedia.images);
      const foreign = input.images.find((mediaId) => !current.has(mediaId));
      if (foreign) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          status: 400,
          message: "Images may only reorder or remove existing profile media",
          details: { media_id: foreign },
        });
      }
    }

    const profile = await this.options.store.updateProfile(userId, {
        ...(input.power === undefined ? {} : { power: input.power }),
        ...(input.classes === undefined ? {} : { classes: input.classes }),
        ...(input.title_html === undefined
          ? {}
          : { titleHtml: input.title_html === null ? null : sanitizeInlineHtml(input.title_html) }),
        ...(input.bio === undefined ? {} : { bio: input.bio }),
        ...(input.video_urls === undefined ? {} : { videoUrls: input.video_urls }),
        ...(input.availability === undefined ? {} : { availability: input.availability }),
        ...(notes === undefined ? {} : { notes }),
        ...(input.images === undefined ? {} : { images: input.images }),
        updatedAt: context.now,
      }, target, currentMedia.images, createAuditEvent(context, {
        subjectType: "member_profile",
        subjectId: userId,
        subjectLabel: target.username,
        action: "update",
        context: [
          {
            field: "changed_sections",
            value: {
              type: "list",
              value: Object.keys(input)
                .filter((field) => field !== "images")
                .map((value) => ({ type: "code" as const, value })),
            },
          },
          ...(input.images === undefined ? [] : [{
            field: "media_count" as const,
            value: { type: "number" as const, value: input.images.length },
          }]),
        ],
      }));
    if (!profile) {
      throw new AppError({
        code: "CONFLICT",
        status: 409,
        message: "Member authorization or profile data changed while the request was being processed",
      });
    }
    const nextMedia = input.images === undefined ? currentMedia : { ...currentMedia, images: input.images };
    return buildProfileWire(profile, nextMedia, isAdminEdit ? "admin" : "member");
  }

  async listAbsenceWindow(context: RequestContext, from: string, to: string) {
    const actor = context.authorization.requireAuthenticated();
    const parsed = absenceWindowQuerySchema.safeParse({ from, to });
    if (!parsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: "Invalid absence window",
        details: parsed.error.flatten(),
      });
    }
    const projection = context.authorization.has(PERMISSION_ID.ADMIN_USERS_VIEW) ? "admin" : "member";
    return { data: await this.options.store.listAbsences({
      from: parsed.data.from,
      to: parsed.data.to,
      viewerUserId: actor.userId,
      projection,
    }) };
  }

  async listUserAbsences(context: RequestContext, userId: string) {
    const actor = context.authorization.requireAuthenticated();
    const projection = context.authorization.has(PERMISSION_ID.ADMIN_USERS_VIEW) ? "admin" : "member";
    return { data: await this.options.store.listAbsences({ userId, viewerUserId: actor.userId, projection }) };
  }

  async createAbsence(context: RequestContext, userId: string, input: Readonly<{
    startDate: string;
    endDate: string;
    note: string | null;
  }>) {
    const target = await this.requireEditableTarget(context, userId);
    const policy = await this.options.absencePolicy.readAbsencePolicy();
    const span = inclusiveIsoDateSpanDays(input.startDate, input.endDate);
    if (span > policy.maxSpanDays) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: `Absence cannot span more than ${policy.maxSpanDays} days` });
    }
    if (await this.options.store.countAbsences(userId) >= policy.maxEntriesPerUser) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Absence limit reached" });
    }
    const id = this.generateId();
    const created = await this.options.store.createAbsence({
      id,
      userId,
      startDate: input.startDate,
      endDate: input.endDate,
      note: input.note?.trim() || null,
      maximumEntries: policy.maxEntriesPerUser,
      now: context.now,
    }, createAuditEvent(context, {
      subjectType: "member_absence",
      subjectId: id,
      subjectLabel: target.target.username,
      action: "create",
      context: [
        { field: "subject_id", value: { type: "reference", value: { id: userId, label: target.target.username } } },
        { field: "start_at", value: { type: "date", value: input.startDate } },
        { field: "end_at", value: { type: "date", value: input.endDate } },
      ],
    }));
    if (!created) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Absence limit reached" });
    }
    return created;
  }

  async deleteAbsence(context: RequestContext, userId: string, absenceId: string): Promise<{ ok: true }> {
    const target = await this.requireEditableTarget(context, userId);
    const actor = context.authorization.requireAuthenticated();
    const absence = (await this.options.store.listAbsences({
      userId,
      viewerUserId: actor.userId,
      projection: "admin",
    })).find((entry) => entry.id === absenceId);
    if (!absence) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Absence not found" });
    const removed = await this.options.store.deleteAbsence(userId, absenceId, createAuditEvent(context, {
      subjectType: "member_absence",
      subjectId: absenceId,
      subjectLabel: target.target.username,
      action: "delete",
      context: [
        {
          field: "subject_id",
          value: { type: "reference", value: { id: userId, label: target.target.username } },
        },
        { field: "start_at", value: { type: "date", value: absence.start_date } },
        { field: "end_at", value: { type: "date", value: absence.end_date } },
      ],
    }));
    if (!removed) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Absence not found" });
    return { ok: true };
  }

  async uploadImages(context: RequestContext, userId: string, uploads: readonly ImageUpload[]) {
    const target = await this.requireEditableTarget(context, userId);
    return { media_ids: await this.options.media.uploadProfileImages(
      context,
      userId,
      uploads,
      createAuditEvent(context, {
        subjectType: "member_profile",
        subjectId: userId,
        subjectLabel: target.target.username,
        action: "upload_images",
        context: [{ field: "upload_count", value: { type: "number", value: uploads.length } }],
      }),
    ) };
  }

  async deleteImages(context: RequestContext, userId: string, mediaIds: readonly string[]) {
    const target = await this.requireEditableTarget(context, userId);
    const deleted = await this.options.media.deleteProfileImages(context, userId, mediaIds, createAuditEvent(context, {
      subjectType: "member_profile",
      subjectId: userId,
      subjectLabel: target.target.username,
      action: "delete_images",
      // The store appends the images it actually removed; a requested count here would contradict it.
    }));
    return { ok: true as const, deleted };
  }

  async uploadAvatar(context: RequestContext, userId: string, upload: ImageUpload) {
    const target = await this.requireEditableTarget(context, userId);
    const mediaId = await this.options.media.uploadAvatar(context, userId, upload, createAuditEvent(context, {
      subjectType: "member_profile",
      subjectId: userId,
      subjectLabel: target.target.username,
      action: "upload_avatar",
      context: [],
    }));
    return { media_id: mediaId };
  }

  async deleteAvatar(context: RequestContext, userId: string) {
    const target = await this.requireEditableTarget(context, userId);
    await this.options.media.deleteAvatar(context, userId, createAuditEvent(context, {
      subjectType: "member_profile",
      subjectId: userId,
      subjectLabel: target.target.username,
      action: "delete_avatar",
      context: [],
    }));
    return { ok: true as const };
  }

  async uploadAudio(context: RequestContext, userId: string, upload: AudioUpload) {
    const target = await this.requireEditableTarget(context, userId);
    const mediaId = await this.options.media.uploadAudio(context, userId, upload, createAuditEvent(context, {
      subjectType: "member_profile",
      subjectId: userId,
      subjectLabel: target.target.username,
      action: "upload_audio",
      context: [],
    }));
    return { media_id: mediaId };
  }

  async deleteAudio(context: RequestContext, userId: string) {
    const target = await this.requireEditableTarget(context, userId);
    await this.options.media.deleteAudio(context, userId, createAuditEvent(context, {
      subjectType: "member_profile",
      subjectId: userId,
      subjectLabel: target.target.username,
      action: "delete_audio",
      context: [],
    }));
    return { ok: true as const };
  }

  private async requireEditableTarget(context: RequestContext, userId: string) {
    const actor = context.authorization.requireAuthenticated();
    const target = await this.options.store.getMemberTarget(userId);
    if (!target || target.deletedAt !== null) {
      throw new AppError({ code: "NOT_FOUND", status: 404, message: "User not found" });
    }
    if (actor.userId === userId) return { target, isAdminEdit: false } as const;
    context.authorization.require(PERMISSION_ID.ADMIN_USERS_EDIT);
    assertTargetBelowActor(actor, target, { allowSelf: false });
    return { target, isAdminEdit: true } as const;
  }
}

export type { RosterPage };
