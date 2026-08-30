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
  displayName: "Member",
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
  lastLoginAt: null,
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
    scope: "normal",
  },
};

function buildApp(input: Readonly<{
  secure?: boolean;
  allowed?: boolean;
  cookieName?: string;
  authenticated?: boolean;
}> = {}) {
  const service = {
    login: vi.fn().mockResolvedValue(session),
    logout: vi.fn().mockResolvedValue({ ok: true as const }),
    verifyInvite: vi.fn().mockResolvedValue({
      valid: true as const,
      roleId: "member",
      roleName: "Member",
      roleColor: null,
      roleLevel: 100,
    }),
    register: vi.fn().mockResolvedValue({ ...session, session: { ...session.session, stayLoggedIn: false } }),
    getMe: vi.fn().mockResolvedValue({ user, profile, sessionScope: "normal" as const }),
    getSecurity: vi.fn().mockResolvedValue({ loginName: "member-login", displayName: "Member" }),
    changePassword: vi.fn().mockResolvedValue({ ok: true as const }),
    changeLoginName: vi.fn().mockResolvedValue({ ok: true as const }),
    completePasswordReset: vi.fn().mockResolvedValue(session),
    createSessionForUserId: vi.fn().mockResolvedValue(session),
  };
  const oauth = {
    startLogin: vi.fn(),
    startLink: vi.fn(),
    finish: vi.fn(),
    unlink: vi.fn().mockResolvedValue({ ok: true as const }),
    listLinkedProviders: vi.fn().mockResolvedValue([]),
  };
  const emailVerification = {
    available: false,
    getVerifiedEmail: vi.fn().mockResolvedValue(null),
    request: vi.fn().mockResolvedValue({ ok: true as const }),
    resend: vi.fn().mockResolvedValue({ ok: true as const }),
    verify: vi.fn(),
    remove: vi.fn().mockResolvedValue({ ok: true as const }),
  };
  const consume = vi.fn().mockResolvedValue({ allowed: input.allowed ?? true, retryAfterSeconds: 12 });
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", async (context, next) => {
    context.set("clientIdentifier", "client-1");
    context.set("requestContext", createRequestContext({
      requestId: "request-1",
      now: NOW,
      authorization: createAuthorizationContext(input.authenticated ? {
        userId: user.id,
        sessionId: "session-1",
        roleId: user.roleId,
        roleLevel: user.roleLevel,
        permissions: [],
      } : null),
    }));
    await next();
  });
  app.route("/api/auth", createAuthRoutes({
    service,
    oauth: oauth as never,
    emailVerification: emailVerification as never,
    rateLimiter: { consume },
    cookie: {
      publicUrl: input.secure === false ? "http://guild.test" : "https://guild.test",
      name: input.cookieName,
    },
  }));
  return { app, service, oauth, emailVerification, consume };
}

describe("auth Portal HTTP contract", () => {
  it("binds OAuth state to a short-lived HttpOnly browser transaction cookie", async () => {
    const value = buildApp();
    value.oauth.startLogin.mockResolvedValue({
      authorizationUrl: "https://provider.example/authorize?state=state",
      browserBindingToken: "browser-binding-token",
    });

    const start = await value.app.request("/api/auth/oauth/google/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await expect(start.json()).resolves.toEqual({
      authorization_url: "https://provider.example/authorize?state=state",
    });
    const transactionCookie = start.headers.get("Set-Cookie") ?? "";
    expect(transactionCookie).toContain("__Host-ig_session_oauth_transaction=browser-binding-token");
    expect(transactionCookie).toContain("HttpOnly");
    expect(transactionCookie).toContain("SameSite=Lax");
    expect(transactionCookie).toContain("Path=/");
    expect(transactionCookie).toContain("Secure");
    expect(transactionCookie).not.toContain("Domain=");

    const missingCookie = await value.app.request(
      "/api/auth/oauth/google/callback?state=state&code=code",
    );
    expect(missingCookie.status).toBe(302);
    expect(missingCookie.headers.get("Location")).toBe("https://guild.test/login?oauth=failed");
    expect(value.oauth.finish).not.toHaveBeenCalled();

    value.oauth.finish.mockResolvedValue({ kind: "login", userId: "user-1", authRevision: 1 });
    const callback = await value.app.request(
      "/api/auth/oauth/google/callback?state=state&code=code",
      { headers: { Cookie: "__Host-ig_session_oauth_transaction=browser-binding-token" } },
    );
    expect(callback.status).toBe(302);
    expect(value.oauth.finish).toHaveBeenCalledWith(expect.anything(), {
      provider: "google",
      state: "state",
      browserBindingToken: "browser-binding-token",
      code: "code",
      now: NOW,
    });
    expect(value.service.createSessionForUserId).toHaveBeenCalledWith("user-1", NOW, 1);
    expect(callback.headers.get("Location")).toBe("https://guild.test/");
    expect(callback.headers.get("Set-Cookie")).toContain("__Host-ig_session_oauth_transaction=");
  });

  it("redirects an OAuth account-link callback to the account security tab", async () => {
    const value = buildApp();
    value.oauth.finish.mockResolvedValue({ kind: "link" });

    const response = await value.app.request(
      "/api/auth/oauth/google/callback?state=state&code=code",
      { headers: { Cookie: "__Host-ig_session_oauth_transaction=browser-binding-token" } },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://guild.test/profile?tab=account&oauth=linked");
  });

  it("puts only the random session token in a hardened HTTPS cookie", async () => {
    const { app } = buildApp();
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login_name: "Member", password: "password", stay_logged_in: true }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ user: { id: "user-1", role: "member" }, profile: { user_id: "user-1" } });
    expect(JSON.stringify(body)).not.toContain("only-in-cookie");
    expect(JSON.stringify(body)).not.toContain("digest");
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("__Host-ig_session=only-in-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).toContain("Max-Age=2592000");
  });

  it("uses explicit public HTTP configuration to omit Secure and clears logout cookies", async () => {
    const { app, service } = buildApp({ secure: false });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login_name: "Member", password: "password" }),
    });
    expect(login.headers.get("Set-Cookie")).toContain("ig_session=only-in-cookie");
    expect(login.headers.get("Set-Cookie")).not.toContain("__Host-");
    expect(login.headers.get("Set-Cookie")).not.toContain("Secure");

    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: "ig_session=raw-from-cookie" },
    });
    expect(logout.status).toBe(200);
    expect(service.logout).toHaveBeenCalledWith("raw-from-cookie");
    expect(logout.headers.get("Set-Cookie")).toContain("ig_session=");
  });

  it("does not permit a custom HTTPS cookie name to bypass the Host cookie contract", () => {
    expect(() => buildApp({ cookieName: "custom-session" })).toThrow(
      "HTTPS session cookies must use the __Host-ig_session name",
    );
  });

  it("passes the trusted client identifier to the service and keeps other auth operations rate-limited", async () => {
    const { app, service, consume } = buildApp();
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login_name: "Member", password: "password" }),
    });
    expect(response.status).toBe(200);
    expect(service.login).toHaveBeenCalledWith(expect.objectContaining({ clientIdentifier: "client-1" }));
    expect(consume).not.toHaveBeenCalled();

    const allowed = buildApp();
    await allowed.app.request("/api/auth/verify-invite/A1B2C3D4E5");
    await allowed.app.request("/api/auth/register/A1B2C3D4E5", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login_name: "new_member",
        display_name: "New_Member",
        password: "Password123456789!",
        confirmPassword: "Password123456789!",
      }),
    });
    expect(allowed.consume.mock.calls.map(([key]) => key)).toEqual([
      "auth:invite-verify:client-1",
      "auth:register:client-1",
    ]);
    expect(allowed.service.verifyInvite).toHaveBeenCalledWith("A1B2C3D4E5", NOW);
    expect(allowed.service.register).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      inviteCode: "A1B2C3D4E5",
    }));
  });

  it("rate-limits current-password verification by both account and trusted source", async () => {
    const value = buildApp({ authenticated: true });
    value.oauth.startLink.mockResolvedValue({
      authorizationUrl: "https://provider.example/authorize",
      browserBindingToken: "binding-token",
    });
    const operations = [
      ["PATCH", "/api/auth/security/password", {
        currentPassword: "password",
        newPassword: "New-password",
        confirmNewPassword: "New-password",
      }],
      ["PATCH", "/api/auth/security/login-name", {
        currentPassword: "password",
        login_name: "member_login_2",
      }],
      ["DELETE", "/api/auth/security/oauth/google", { current_password: "password" }],
      ["POST", "/api/auth/security/email", { current_password: "password", email: "member@example.com" }],
      ["POST", "/api/auth/security/email/resend", { current_password: "password" }],
      ["DELETE", "/api/auth/security/email", { current_password: "password" }],
    ] as const;

    for (const [method, path, body] of operations) {
      value.consume.mockClear();
      const response = await value.app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(200);
      expect(value.consume.mock.calls.map(([key]) => key)).toEqual([
        "auth:credential:user:user-1",
        "auth:credential:source:client-1",
      ]);
    }

    value.consume.mockClear();
    const oauthStart = await value.app.request("/api/auth/oauth/google/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: "password" }),
    });
    expect(oauthStart.status).toBe(200);
    expect(value.consume.mock.calls.map(([key]) => key)).toEqual([
      "auth:oauth-start:client-1",
      "auth:credential:user:user-1",
      "auth:credential:source:client-1",
    ]);
  });

  it("returns only caller-scoped rate-limit metadata for a throttled login", async () => {
    const { app, service } = buildApp();
    service.login.mockRejectedValueOnce(new AppError({
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many authentication requests",
      details: { retry_after_seconds: 12 },
    }));
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login_name: "Member", password: "wrong" }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    const payload = await response.json();
    expect(payload).toEqual({
      error_code: "RATE_LIMITED",
      message: "Too many authentication requests",
      request_id: "request-1",
      details: { retry_after_seconds: 12 },
    });
    expect(JSON.stringify(payload)).not.toMatch(/locked_until|login_name/i);
    expect(service.login).toHaveBeenCalledOnce();
  });

  it("presents invite and current-session fields in the Portal snake_case shape", async () => {
    const { app } = buildApp();
    const invite = await app.request("/api/auth/verify-invite/A1B2C3D4E5");
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
