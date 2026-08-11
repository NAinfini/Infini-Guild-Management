import { AppError, createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { AuthSessionResult, AuthUserRecord } from "@guild/server/modules/auth";
import type { MemberProfile } from "@guild/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createAuthRoutes } from "./auth-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";
const user: AuthUserRecord = {
  id: "user-1",
  username: "Member",
  roleId: "member",
  roleName: "Member",
  roleColor: null,
  roleLevel: 100,
  permissions: new Set(["events.create"]),
  isActive: true,
  deletedAt: null,
  revisionToken: "user-v1",
  createdAt: NOW,
  updatedAt: NOW,
};
const profile: MemberProfile = {
  user_id: user.id,
  power: 0,
  classes: [],
  title_html: null,
  bio: null,
  avatar_media_id: null,
  images: [],
  audio_media_id: null,
  audio_name: null,
  video_urls: [],
  availability: null,
  vacation_start: null,
  vacation_end: null,
  notes: null,
  created_at: NOW,
  updated_at: NOW,
};
const session: AuthSessionResult = {
  user,
  profile,
  session: {
    rawToken: "only-in-cookie",
    tokenDigest: "digest",
    expiresAt: "2026-09-08T12:00:00.000Z",
    stayLoggedIn: true,
  },
};

function buildApp(input: Readonly<{ secure?: boolean; allowed?: boolean }> = {}) {
  const service = {
    login: vi.fn().mockResolvedValue(session),
    logout: vi.fn().mockResolvedValue({ ok: true as const }),
    checkUsername: vi.fn().mockResolvedValue({ available: true }),
    verifyInvite: vi.fn().mockResolvedValue({
      valid: true as const,
      roleId: "member",
      roleName: "Member",
      roleColor: null,
      roleLevel: 100,
    }),
    register: vi.fn().mockResolvedValue({ ...session, session: { ...session.session, stayLoggedIn: false } }),
    getMe: vi.fn().mockResolvedValue({ user, profile }),
  };
  const consume = vi.fn().mockResolvedValue({ allowed: input.allowed ?? true, retryAfterSeconds: 12 });
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", async (context, next) => {
    context.set("clientIdentifier", "client-1");
    context.set("requestContext", createRequestContext({
      requestId: "request-1",
      now: NOW,
      authorization: createAuthorizationContext(null),
    }));
    await next();
  });
  app.route("/api/auth", createAuthRoutes({
    service,
    rateLimiter: { consume },
    cookie: { publicUrl: input.secure === false ? "http://guild.test" : "https://guild.test" },
  }));
  return { app, service, consume };
}

describe("auth Portal HTTP contract", () => {
  it("puts only the random session token in a hardened HTTPS cookie", async () => {
    const { app } = buildApp();
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Member", password: "password", stay_logged_in: true }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ user: { id: "user-1", role: "member" }, profile: { user_id: "user-1" } });
    expect(JSON.stringify(body)).not.toContain("only-in-cookie");
    expect(JSON.stringify(body)).not.toContain("digest");
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("ig_session=only-in-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=2592000");
  });

  it("uses explicit public HTTP configuration to omit Secure and clears logout cookies", async () => {
    const { app, service } = buildApp({ secure: false });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Member", password: "password" }),
    });
    expect(login.headers.get("Set-Cookie")).not.toContain("Secure");

    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: "ig_session=raw-from-cookie" },
    });
    expect(logout.status).toBe(200);
    expect(service.logout).toHaveBeenCalledWith("raw-from-cookie");
    expect(logout.headers.get("Set-Cookie")).toContain("ig_session=");
  });

  it("passes the trusted client identifier to the service and keeps other auth operations rate-limited", async () => {
    const { app, service, consume } = buildApp();
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Member", password: "password" }),
    });
    expect(response.status).toBe(200);
    expect(service.login).toHaveBeenCalledWith(expect.objectContaining({ clientIdentifier: "client-1" }));
    expect(consume).not.toHaveBeenCalled();

    const allowed = buildApp();
    await allowed.app.request("/api/auth/check-username?username=NewMember");
    await allowed.app.request("/api/auth/verify-invite/invite-code");
    await allowed.app.request("/api/auth/register/invite-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "NewMember", password: "password", confirmPassword: "password" }),
    });
    expect(allowed.consume.mock.calls.map(([key]) => key)).toEqual([
      "auth:username:client-1",
      "auth:invite-verify:client-1",
      "auth:register:client-1",
    ]);
  });

  it("keeps the persistent login lock duration readable in the canonical error envelope", async () => {
    const { app, service } = buildApp();
    service.login.mockRejectedValueOnce(new AppError({
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many failed login attempts",
      details: {
        retry_after_seconds: 30,
        locked_until: "2026-08-09T12:00:30.000Z",
      },
    }));
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Member", password: "wrong" }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error_code: "RATE_LIMITED",
      message: "Too many failed login attempts",
      request_id: "request-1",
      details: {
        retry_after_seconds: 30,
        locked_until: "2026-08-09T12:00:30.000Z",
      },
    });
  });

  it("presents invite and current-session fields in the Portal snake_case shape", async () => {
    const { app } = buildApp();
    const invite = await app.request("/api/auth/verify-invite/code");
    expect(await invite.json()).toEqual({
      valid: true,
      role_id: "member",
      role_name: "Member",
      role_color: null,
      role_level: 100,
    });
    const me = await app.request("/api/auth/me");
    expect(await me.json()).toMatchObject({
      user: { role_name: "Member", role_level: 100, is_active: true },
      profile: { avatar_media_id: null, video_urls: [] },
    });
  });
});
