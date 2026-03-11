import { ERROR_STATUS, type ErrorCode, type Role, type StandardErrorResponse } from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { createPasswordHash, destroySession, resolveSession, verifyPassword } from "../services/auth";
import { writeAuditLog } from "../services/audit";
import { publishEntityChanged } from "../services/push";
import { deleteMediaObject, storeProfileAudio, storeProfileImage } from "../services/media";
import { UserService, type SessionUser } from "../services/UserService";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

export const usersRoutes = new Hono();

function getDb(c: Context) {
  return drizzle((c.env as Bindings).DB);
}

function getUserService(c: Context) {
  return new UserService(getDb(c), {
    writeAuditLog: (input) => writeAuditLog(c, input),
    publishEntityChanged: (payload) => publishEntityChanged(c.env as Bindings, payload),
    storeProfileImage: (userId, file) => storeProfileImage(c, userId, file),
    storeProfileAudio: (userId, file) => storeProfileAudio(c, userId, file),
    deleteMediaObject: (key) => deleteMediaObject(c, key),
    verifyPassword,
    createPasswordHash,
    destroySession: () => destroySession(c),
  });
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
  if (!resolved) return buildError(c, "UNAUTHORIZED", "Authentication required");
  return resolved.user;
}

function serviceResponse(c: Context, result: { ok: true; data: unknown } | { ok: false; code: ErrorCode; message: string; details?: unknown }, status?: number) {
  if (result.ok) return status ? c.json(result.data, status as 201) : c.json(result.data);
  return buildError(c, result.code, result.message, result.details);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function parseJsonBody(c: Context): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }
}

// --- Routes ---

usersRoutes.get("/", async (c) => {
  const resolved = await resolveSession(c);
  const sessionUser = resolved?.user ?? null;
  const query = c.req.query();

  const result = await getUserService(c).listUsers({
    page: parsePage(query.page, 1),
    limit: Math.min(100, parsePage(query.limit, 20)),
    search: (query.search ?? "").trim().toLowerCase(),
    roleFilter: query.role as Role | undefined,
    classFilter: query.class,
    activeFilter: parseBoolean(query.active),
    externalView: parseBoolean(query.external_view) ?? false,
    sessionUser,
  });
  return serviceResponse(c, result);
});

usersRoutes.get("/:id", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;
  return serviceResponse(c, await getUserService(c).getUser(sessionUser, c.req.param("id")));
});

usersRoutes.patch("/:id/profile", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  return serviceResponse(c, await getUserService(c).updateProfile(sessionUser, c.req.param("id"), body));
});

usersRoutes.post("/:id/media/images", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;

  let form: FormData;
  try { form = await c.req.formData(); } catch {
    return buildError(c, "VALIDATION_ERROR", "Request must be multipart/form-data");
  }
  const files: File[] = [];
  const single = form.get("file");
  if (single instanceof File) files.push(single);
  for (const value of form.getAll("files")) {
    if (value instanceof File) files.push(value);
  }

  return serviceResponse(c, await getUserService(c).uploadProfileImages(sessionUser, c.req.param("id"), files));
});

usersRoutes.delete("/:id/media/images/:key", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;
  const key = decodeURIComponent(c.req.param("key"));
  return serviceResponse(c, await getUserService(c).deleteProfileImage(sessionUser, c.req.param("id"), key));
});

usersRoutes.post("/:id/media/audio", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;

  let form: FormData;
  try { form = await c.req.formData(); } catch {
    return buildError(c, "VALIDATION_ERROR", "Request must be multipart/form-data");
  }
  const audio = form.get("file");
  if (!(audio instanceof File)) return buildError(c, "VALIDATION_ERROR", "Audio file is required");

  return serviceResponse(c, await getUserService(c).uploadProfileAudio(sessionUser, c.req.param("id"), audio));
});

usersRoutes.delete("/:id/media/audio", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;
  return serviceResponse(c, await getUserService(c).deleteProfileAudio(sessionUser, c.req.param("id")));
});

usersRoutes.post("/:id/discord-link/verify", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const code = typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : "";
  return serviceResponse(c, await getUserService(c).verifyDiscordLink(sessionUser, c.req.param("id"), code));
});

usersRoutes.delete("/:id/discord-link", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;
  return serviceResponse(c, await getUserService(c).unlinkDiscord(sessionUser, c.req.param("id")));
});

usersRoutes.post("/:id/change-password", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  return serviceResponse(c, await getUserService(c).changePassword(sessionUser, c.req.param("id"), body));
});

usersRoutes.post("/:id/change-username", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  return serviceResponse(c, await getUserService(c).changeUsername(sessionUser, c.req.param("id"), body));
});
