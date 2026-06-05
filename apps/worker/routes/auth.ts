import {
  loginSchema,
  registerSchema,
} from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { createPasswordHash, createSession, deleteUserSessions, destroySession, resolveSession, verifyPassword } from "../services/auth";
import { AuthService } from "../services/AuthService";
import { writeAuditLog } from "../services/audit";
import { publishEntityChanged } from "../services/push";
import { createRateLimitMiddleware } from "../middleware/rate-limit";
import { buildError, getDb, handleResult, parseJsonBody } from "./_shared";

export const authRoutes = new Hono();

// Per-username throttle layered on top of the IP-based auth limiter in index.ts.
// Defeats credential-stuffing that rotates source IPs against a single account.
// The username is passed per-request via a keyResolver that reads a header set
// just before invocation (the limiter only reads the key, never mutates context).
function makeUsernameLoginLimiter(username: string) {
  return createRateLimitMiddleware({
    keyPrefix: "auth-user",
    maxRequests: LIMITS.rateLimit.auth.maxRequests,
    windowMs: LIMITS.rateLimit.auth.windowMs,
    keyResolver: () => username,
  });
}

function getService(c: Context): AuthService {
  const env = c.env as Bindings;
  return new AuthService(getDb(c), {
    rawDb: env.DB,
    createPasswordHash,
    verifyPassword,
    createSession: async (userId, opts) => { await createSession(c, userId, opts); },
    destroySession: (sessionId) => destroySession(c, sessionId),
    deleteUserSessions: (userId) => deleteUserSessions(c, userId),
    publishEntityChanged: (payload) => publishEntityChanged(c, payload),
    writeAuditLog: (input) => writeAuditLog(c, input),
  });
}

// --- Routes ---

authRoutes.post("/login", async (c) => {
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid login payload", parsed.error.flatten());

  // Throttle by username (normalized) in addition to the IP-based limiter.
  const username = parsed.data.username.trim().toLowerCase();
  await makeUsernameLoginLimiter(username)(c, async () => {});
  if (c.res.status === 429) return c.res;

  const bodyRecord = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const stayLoggedIn = typeof bodyRecord.stay_logged_in === "boolean" ? bodyRecord.stay_logged_in : false;
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
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
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
