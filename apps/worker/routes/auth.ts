import {
  ERROR_STATUS,
  loginSchema,
  registerSchema,
  type ErrorCode,
  type StandardErrorResponse,
} from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { createPasswordHash, createSession, destroySession, resolveSession, verifyPassword } from "../services/auth";
import { AuthService } from "../services/AuthService";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

export const authRoutes = new Hono();

function getService(c: Context): AuthService {
  const env = c.env as Bindings;
  return new AuthService(drizzle(env.DB), {
    rawDb: env.DB,
    createPasswordHash,
    verifyPassword,
    createSession: async (userId, opts) => { await createSession(c, userId, opts); },
    destroySession: (sessionId) => destroySession(c, sessionId),
  });
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = { error_code: code, message, request_id: requestId, ...(details ? { details } : {}) };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

function handleResult(c: Context, result: { ok: true; data: unknown } | { ok: false; code: ErrorCode; message: string; details?: unknown }, status?: number): Response {
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, status as never);
}

// --- Routes ---

authRoutes.post("/login", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid login payload", parsed.error.flatten());
  const bodyRecord = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const stayLoggedInRaw = bodyRecord.stay_logged_in ?? bodyRecord.stayLoggedIn;
  const stayLoggedIn = typeof stayLoggedInRaw === "boolean" ? stayLoggedInRaw : false;
  const result = await getService(c).login(parsed.data.username, parsed.data.password, stayLoggedIn);
  return handleResult(c, result);
});

authRoutes.post("/logout", async (c) => {
  const resolved = await resolveSession(c);
  if (!resolved) return buildError(c, "UNAUTHORIZED", "Authentication required");
  const result = await getService(c).logout(resolved.sessionId);
  return handleResult(c, result);
});

authRoutes.get("/check-username", async (c) => {
  const username = (c.req.query("username") ?? "").trim();
  const result = await getService(c).checkUsername(username);
  return handleResult(c, result);
});

authRoutes.get("/verify-invite/:code", async (c) => {
  const code = c.req.param("code");
  if (!code) return buildError(c, "VALIDATION_ERROR", "Missing invite code");
  const result = await getService(c).verifyInvite(code);
  return handleResult(c, result);
});

authRoutes.post("/register/:inviteCode", async (c) => {
  const inviteCode = c.req.param("inviteCode");
  if (!inviteCode) return buildError(c, "VALIDATION_ERROR", "Missing invite code");
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid registration payload", parsed.error.flatten());
  const result = await getService(c).register(inviteCode, parsed.data.username, parsed.data.password);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

authRoutes.get("/me", async (c) => {
  const resolved = await resolveSession(c);
  if (!resolved) return buildError(c, "UNAUTHORIZED", "Authentication required");
  const result = await getService(c).getMe(resolved.user.id, resolved.sessionId);
  return handleResult(c, result);
});
