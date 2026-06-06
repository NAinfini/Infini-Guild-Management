import { deleteProfileImagesSchema, type Role } from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { createPasswordHash, destroySession, resolveSession, verifyPassword } from "../services/auth";
import { deleteMediaObject, storeProfileAudio, storeProfileImage } from "../services/media";
import { UserService } from "../services/UserService";
import { BadgeService } from "../services/BadgeService";
import { buildError, collectFiles, getDb, handleResult, parseBoolean, parseJsonBody, parsePage, requireSessionUser, serveR2Object } from "./_shared";
import { commonDeps } from "./service-factory";

export const usersRoutes = new Hono();

function getUserService(c: Context) {
  return new UserService(getDb(c), {
    ...commonDeps(c),
    storeProfileImage: (userId, file) => storeProfileImage(c, userId, file),
    storeProfileAudio: (userId, file) => storeProfileAudio(c, userId, file),
    deleteMediaObject: (key) => deleteMediaObject(c, key),
    verifyPassword,
    createPasswordHash,
    destroySession: () => destroySession(c),
  });
}

function getBadgeService(c: Context) {
  return new BadgeService(getDb(c), commonDeps(c));
}

// --- Routes ---

usersRoutes.get("/image", async (c) => {
  const key = c.req.query("key");
  if (!key) return buildError(c, "VALIDATION_ERROR", "key query parameter required");
  if (!key.startsWith("members/")) return buildError(c, "FORBIDDEN", "Invalid profile media key");
  return serveR2Object(c, key, "Profile media not found");
});

usersRoutes.get("/", async (c) => {
  const resolved = await resolveSession(c);
  const sessionUser = resolved?.user ?? null;
  const query = c.req.query();

  const isAdmin = sessionUser?.permissions.has("admin.users.view") === true;
  const explicitActive = parseBoolean(query.active);
  const activeFilter = explicitActive ?? (isAdmin ? undefined : true);

  const result = await getUserService(c).listUsers({
    page: parsePage(query.page, 1),
    limit: Math.min(500, parsePage(query.limit, 20)),
    search: (query.search ?? "").trim().toLowerCase(),
    roleFilter: query.role as Role | undefined,
    classFilter: query.class,
    activeFilter,
    sessionUser,
    includeTotal: parseBoolean(query.include_total) === true,
  });
  if (!result.ok) return handleResult(c, result);

  const data = result.data.data as Array<{ user: { id: string }; profile: unknown }>;
  const userIds = data.map((row) => row.user.id);
  const badgeMap = await getBadgeService(c).getBulkUserBadges(userIds);
  const enriched = data.map((row) => ({
    ...row,
    badges: badgeMap.get(row.user.id) ?? [],
  }));

  return c.json({ ...result.data, data: enriched });
});

usersRoutes.get("/stats", async (c) => {
  return handleResult(c, await getUserService(c).getUserStats());
});

usersRoutes.get("/:id", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getUserService(c).getUser(sessionUser, c.req.param("id"));
  if (!result.ok) return handleResult(c, result);
  const userData = result.data as { user: { id: string }; profile: unknown };
  const badges = await getBadgeService(c).getUserBadges(userData.user.id);
  return c.json({ ...userData, badges });
});

usersRoutes.patch("/:id/profile", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  return handleResult(c, await getUserService(c).updateProfile(sessionUser, c.req.param("id"), body));
});

usersRoutes.post("/:id/media/images", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;

  let form: FormData;
  try { form = await c.req.formData(); } catch {
    return buildError(c, "VALIDATION_ERROR", "Request must be multipart/form-data");
  }
  const files = collectFiles(form);

  return handleResult(c, await getUserService(c).uploadProfileImages(sessionUser, c.req.param("id"), files));
});

usersRoutes.delete("/:id/media/images", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = deleteProfileImagesSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid image delete payload", parsed.error.flatten());
  return handleResult(c, await getUserService(c).deleteProfileImages(sessionUser, c.req.param("id"), parsed.data.keys));
});

usersRoutes.post("/:id/media/avatar", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;

  let form: FormData;
  try { form = await c.req.formData(); } catch {
    return buildError(c, "VALIDATION_ERROR", "Request must be multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return buildError(c, "VALIDATION_ERROR", "Avatar file is required");

  return handleResult(c, await getUserService(c).uploadAvatar(sessionUser, c.req.param("id"), file));
});

usersRoutes.delete("/:id/media/avatar", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  return handleResult(c, await getUserService(c).deleteAvatar(sessionUser, c.req.param("id")));
});

usersRoutes.post("/:id/media/audio", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;

  let form: FormData;
  try { form = await c.req.formData(); } catch {
    return buildError(c, "VALIDATION_ERROR", "Request must be multipart/form-data");
  }
  const audio = form.get("file");
  if (!(audio instanceof File)) return buildError(c, "VALIDATION_ERROR", "Audio file is required");

  return handleResult(c, await getUserService(c).uploadProfileAudio(sessionUser, c.req.param("id"), audio));
});

usersRoutes.delete("/:id/media/audio", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  return handleResult(c, await getUserService(c).deleteProfileAudio(sessionUser, c.req.param("id")));
});

usersRoutes.post("/:id/change-password", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  return handleResult(c, await getUserService(c).changePassword(sessionUser, c.req.param("id"), body));
});

usersRoutes.post("/:id/change-username", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  return handleResult(c, await getUserService(c).changeUsername(sessionUser, c.req.param("id"), body));
});
