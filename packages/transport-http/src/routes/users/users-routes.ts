import type { AuthService } from "@guild/server/modules/auth";
import type { MemberService } from "@guild/server/modules/members";
import {
  absenceWindowQuerySchema,
  changePasswordSchema,
  changeUsernameSchema,
  createMemberAbsenceSchema,
  deleteProfileImagesSchema,
} from "@guild/shared";
import { LIMITS, MAX_CONFIGURABLE_AUDIO_BYTES } from "@guild/shared/config/limits";
import { Hono } from "hono";
import { z } from "zod";
import { HttpPayloadTooLargeError } from "../../core/body-limit.js";
import { requestContext, type HttpEnv } from "../../core/http-env.js";
import {
  parseFormData,
  parseImageUploads,
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
  page: z.coerce.number().int().positive().default(1),
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
type CredentialHttpService = Pick<AuthService, "changePassword" | "changeUsername">;

export type UsersRoutesDependencies = Readonly<{
  service: MemberHttpService;
  authService: CredentialHttpService;
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
    return context.json(presentMemberProfile(await dependencies.service.updateProfile(
      requestContext(context),
      context.req.param("id"),
      body,
    )));
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
    const uploads = await parseImageUploads(await parseFormData(context.req.raw));
    return context.json(await dependencies.service.uploadImages(
      requestContext(context),
      context.req.param("id"),
      uploads,
    ), 201);
  });

  routes.delete("/:id/media/images", async (context) => {
    const input = await parseJsonBody(context.req.raw, deleteProfileImagesSchema, "Invalid image delete payload");
    return context.json(await dependencies.service.deleteImages(
      requestContext(context),
      context.req.param("id"),
      input.media_ids,
    ));
  });

  routes.post("/:id/media/avatar", async (context) => {
    const uploads = await parseImageUploads(await parseFormData(context.req.raw));
    if (uploads.length !== 1) throw validation("Exactly one avatar is required");
    return context.json(await dependencies.service.uploadAvatar(
      requestContext(context),
      context.req.param("id"),
      uploads[0]!,
    ), 201);
  });

  routes.delete("/:id/media/avatar", async (context) => context.json(
    await dependencies.service.deleteAvatar(requestContext(context), context.req.param("id")),
  ));

  routes.post("/:id/media/audio", async (context) => {
    const upload = await parseAudio(await parseFormData(context.req.raw));
    return context.json(await dependencies.service.uploadAudio(
      requestContext(context),
      context.req.param("id"),
      upload,
    ), 201);
  });

  routes.delete("/:id/media/audio", async (context) => context.json(
    await dependencies.service.deleteAudio(requestContext(context), context.req.param("id")),
  ));

  routes.post("/:id/change-password", async (context) => {
    const input = await parseJsonBody(context.req.raw, changePasswordSchema, "Invalid password change payload");
    return context.json(await dependencies.authService.changePassword(requestContext(context), {
      targetUserId: context.req.param("id"),
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    }));
  });

  routes.post("/:id/change-username", async (context) => {
    const input = await parseJsonBody(context.req.raw, changeUsernameSchema, "Invalid username change payload");
    return context.json(await dependencies.authService.changeUsername(requestContext(context), {
      targetUserId: context.req.param("id"),
      currentPassword: input.currentPassword,
      newUsername: input.newUsername,
    }));
  });

  return routes;
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
