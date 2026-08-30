import type { RequestContext } from "@guild/kernel";
import type { MemberService } from "@guild/server/modules/members";
import {
  absenceWindowQuerySchema,
  createMemberAbsenceSchema,
  deleteMemberProfileImagesResponseSchema,
  deleteMemberProfileMediaResponseSchema,
  deleteProfileImagesSchema,
  memberProfileRevisionEtag,
  updateMemberProfileResponseSchema,
  uploadMemberProfileImagesResponseSchema,
  uploadMemberProfileMediaResponseSchema,
} from "@guild/shared";
import { LIMITS, MAX_CONFIGURABLE_AUDIO_BYTES, MAX_OFFSET_PAGE } from "@guild/shared/config/limits";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { Hono } from "hono";
import { z } from "zod";
import { HttpPayloadTooLargeError } from "../../core/body-limit.js";
import { requestContext, type HttpEnv } from "../../core/http-env.js";
import {
  parseFormData,
  parseImageUploads,
  parseIfMatch,
  parseJsonBody,
  parseQuery,
  isMultipartFilePart,
  type ParsedMultipartForm,
  validation,
} from "../../core/parsing.js";
import {
  presentMemberProfile,
  presentUserDetail,
  presentUsersPage,
} from "../../presenters/users/users-presenter.js";

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const usersQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(MAX_OFFSET_PAGE).default(1),
  limit: z.coerce.number().int().positive().max(LIMITS.pagination.users).default(20),
  search: z.string().max(100).optional(),
  role: z.string().min(1).optional(),
  class: z.string().min(1).optional(),
  active: booleanQuery.optional(),
  include_total: booleanQuery.default(false),
  external_view: booleanQuery.default(false),
}).strict();
const detailQuerySchema = z.object({ external_view: booleanQuery.default(false) }).strict();
type MemberHttpService = Pick<MemberService,
  | "list" | "stats" | "detail" | "updateProfile"
  | "listAbsenceWindow" | "listUserAbsences" | "createAbsence" | "deleteAbsence"
  | "uploadImages" | "deleteImages" | "uploadAvatar" | "deleteAvatar"
  | "uploadAudio" | "deleteAudio"
>;
export type UsersRoutesDependencies = Readonly<{
  service: MemberHttpService;
}>;

export function createUsersRoutes(dependencies: UsersRoutesDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/", async (context) => {
    const query = parseQuery(context.req.raw, usersQuerySchema);
    const page = await dependencies.service.list(requestContext(context), {
      page: query.page,
      limit: query.limit,
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.role === undefined ? {} : { roleId: query.role }),
      ...(query.class === undefined ? {} : { classId: query.class }),
      ...(query.active === undefined ? {} : { active: query.active }),
      includeTotal: query.include_total,
      externalView: query.external_view,
    });
    return context.json(presentUsersPage(page));
  });

  routes.get("/stats", async (context) => {
    requestContext(context);
    return context.json(await dependencies.service.stats());
  });

  routes.get("/absences", async (context) => {
    const query = parseQuery(context.req.raw, absenceWindowQuerySchema);
    return context.json(await dependencies.service.listAbsenceWindow(
      requestContext(context),
      query.from,
      query.to,
    ));
  });

  routes.get("/:id", async (context) => {
    const query = parseQuery(context.req.raw, detailQuerySchema);
    return context.json(presentUserDetail(await dependencies.service.detail(
      requestContext(context),
      context.req.param("id"),
      query.external_view,
    )));
  });

  routes.patch("/:id/profile", async (context) => {
    const body = await parseJsonBody(context.req.raw, z.unknown(), "Invalid profile payload");
    const updated = await dependencies.service.updateProfile(
      requestContext(context),
      context.req.param("id"),
      body,
      parseIfMatch(context.req.header("If-Match")),
    );
    context.header("ETag", memberProfileRevisionEtag(updated.revisionToken));
    return context.json(updateMemberProfileResponseSchema.parse({
      ...presentMemberProfile(updated.profile),
      profile_revision_token: updated.revisionToken,
    }));
  });

  routes.get("/:id/absences", async (context) => context.json(
    await dependencies.service.listUserAbsences(requestContext(context), context.req.param("id")),
  ));

  routes.post("/:id/absences", async (context) => {
    const input = await parseJsonBody(context.req.raw, createMemberAbsenceSchema, "Invalid absence payload");
    return context.json(await dependencies.service.createAbsence(requestContext(context), context.req.param("id"), {
      startDate: input.start_date,
      endDate: input.end_date,
      note: input.note ?? null,
    }), 201);
  });

  routes.delete("/:id/absences/:absenceId", async (context) => context.json(
    await dependencies.service.deleteAbsence(
      requestContext(context),
      context.req.param("id"),
      context.req.param("absenceId"),
    ),
  ));

  routes.post("/:id/media/images", async (context) => {
    const request = requestContext(context);
    const userId = context.req.param("id");
    requireProfileMediaUpload(request, userId);
    const uploads = await parseImageUploads(await parseFormData(context.req.raw));
    const uploaded = await dependencies.service.uploadImages(
      request,
      userId,
      uploads,
      parseIfMatch(context.req.header("If-Match")),
    );
    context.header("ETag", memberProfileRevisionEtag(uploaded.profileRevisionToken));
    return context.json(uploadMemberProfileImagesResponseSchema.parse({
      media_ids: uploaded.media_ids,
      profile_revision_token: uploaded.profileRevisionToken,
    }), 201);
  });

  routes.delete("/:id/media/images", async (context) => {
    const input = await parseJsonBody(context.req.raw, deleteProfileImagesSchema, "Invalid image delete payload");
    const result = await dependencies.service.deleteImages(
      requestContext(context),
      context.req.param("id"),
      input.media_ids,
      parseIfMatch(context.req.header("If-Match")),
    );
    context.header("ETag", memberProfileRevisionEtag(result.profileRevisionToken));
    return context.json(deleteMemberProfileImagesResponseSchema.parse({
      ok: result.ok,
      deleted: result.deleted,
      profile_revision_token: result.profileRevisionToken,
    }));
  });

  routes.post("/:id/media/avatar", async (context) => {
    const request = requestContext(context);
    const userId = context.req.param("id");
    requireProfileMediaUpload(request, userId);
    const uploads = await parseImageUploads(await parseFormData(context.req.raw));
    if (uploads.length !== 1) throw validation("Exactly one avatar is required");
    const uploaded = await dependencies.service.uploadAvatar(
      request,
      userId,
      uploads[0]!,
      parseIfMatch(context.req.header("If-Match")),
    );
    context.header("ETag", memberProfileRevisionEtag(uploaded.profileRevisionToken));
    return context.json(uploadMemberProfileMediaResponseSchema.parse({
      media_id: uploaded.media_id,
      profile_revision_token: uploaded.profileRevisionToken,
    }), 201);
  });

  routes.delete("/:id/media/avatar", async (context) => {
    const result = await dependencies.service.deleteAvatar(
      requestContext(context),
      context.req.param("id"),
      parseIfMatch(context.req.header("If-Match")),
    );
    context.header("ETag", memberProfileRevisionEtag(result.profileRevisionToken));
    return context.json(deleteMemberProfileMediaResponseSchema.parse({
      ok: result.ok,
      profile_revision_token: result.profileRevisionToken,
    }));
  });

  routes.post("/:id/media/audio", async (context) => {
    const request = requestContext(context);
    const userId = context.req.param("id");
    requireProfileMediaUpload(request, userId);
    const upload = await parseAudio(await parseFormData(context.req.raw));
    const uploaded = await dependencies.service.uploadAudio(
      request,
      userId,
      upload,
      parseIfMatch(context.req.header("If-Match")),
    );
    context.header("ETag", memberProfileRevisionEtag(uploaded.profileRevisionToken));
    return context.json(uploadMemberProfileMediaResponseSchema.parse({
      media_id: uploaded.media_id,
      profile_revision_token: uploaded.profileRevisionToken,
    }), 201);
  });

  routes.delete("/:id/media/audio", async (context) => {
    const result = await dependencies.service.deleteAudio(
      requestContext(context),
      context.req.param("id"),
      parseIfMatch(context.req.header("If-Match")),
    );
    context.header("ETag", memberProfileRevisionEtag(result.profileRevisionToken));
    return context.json(deleteMemberProfileMediaResponseSchema.parse({
      ok: result.ok,
      profile_revision_token: result.profileRevisionToken,
    }));
  });

  return routes;
}

function requireProfileMediaUpload(request: RequestContext, userId: string): void {
  const actor = request.authorization.requireAuthenticated();
  if (actor.userId !== userId) request.authorization.require(PERMISSION_ID.ADMIN_USERS_EDIT);
}

async function parseAudio(form: ParsedMultipartForm) {
  const file = form.get("file");
  if (!isMultipartFilePart(file)) throw validation("Audio file is required");
  if (file.type !== "audio/ogg") throw validation("Audio must use audio/ogg");
  if (file.size > MAX_CONFIGURABLE_AUDIO_BYTES) {
    throw new HttpPayloadTooLargeError(MAX_CONFIGURABLE_AUDIO_BYTES);
  }
  return { full: file.bytes, originalName: file.filename || "audio.opus" };
}
