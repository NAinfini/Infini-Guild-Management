import { AppError, type RateLimiter } from "@guild/kernel";
import type { AuthService } from "@guild/server/modules/auth";
import {
  loginSchema,
  logoutResponseSchema,
  registerSchema,
  usernameAvailabilityResponseSchema,
} from "@guild/shared";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { clientIdentifier, requestContext, type HttpEnv } from "../../core/http-env.js";
import { parseJsonBody, parseQuery } from "../../core/parsing.js";
import { presentAuthSession, presentInviteVerification } from "../../presenters/auth/auth-presenter.js";

export const DEFAULT_SESSION_COOKIE_NAME = "ig_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const usernameQuerySchema = z.object({ username: z.string().min(1).max(50) }).strict();

type AuthHttpService = Pick<AuthService,
  "login" | "logout" | "checkUsername" | "verifyInvite" | "register" | "getMe"
>;

export type AuthCookieConfig = Readonly<{
  publicUrl: string;
  name?: string;
}>;

export type AuthRoutesDependencies = Readonly<{
  service: AuthHttpService;
  rateLimiter: RateLimiter;
  cookie: AuthCookieConfig;
}>;

export function createAuthRoutes(dependencies: AuthRoutesDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  const cookie = resolveCookieConfig(dependencies.cookie);

  routes.post("/login", async (context) => {
    const request = requestContext(context);
    const input = await parseJsonBody(context.req.raw, loginSchema, "Invalid login payload");
    const result = await dependencies.service.login({
      username: input.username,
      password: input.password,
      stayLoggedIn: input.stay_logged_in === true,
      now: request.now,
      clientIdentifier: clientIdentifier(context),
    });
    writeSessionCookie(context, cookie, result.session);
    return context.json(presentAuthSession(result));
  });

  routes.post("/logout", async (context) => {
    requestContext(context);
    const result = await dependencies.service.logout(getCookie(context, cookie.name) ?? null);
    deleteCookie(context, cookie.name, cookie.options);
    return context.json(logoutResponseSchema.parse(result));
  });

  routes.get("/check-username", async (context) => {
    requestContext(context);
    const input = parseQuery(context.req.raw, usernameQuerySchema);
    await consume(dependencies.rateLimiter, "username", clientIdentifier(context));
    return context.json(usernameAvailabilityResponseSchema.parse(
      await dependencies.service.checkUsername(input.username),
    ));
  });

  routes.get("/verify-invite/:code", async (context) => {
    const request = requestContext(context);
    await consume(dependencies.rateLimiter, "invite-verify", clientIdentifier(context));
    return context.json(presentInviteVerification(
      await dependencies.service.verifyInvite(context.req.param("code"), request.now),
    ));
  });

  routes.post("/register/:inviteCode", async (context) => {
    const request = requestContext(context);
    const input = await parseJsonBody(context.req.raw, registerSchema, "Invalid registration payload");
    await consume(dependencies.rateLimiter, "register", clientIdentifier(context));
    const result = await dependencies.service.register(request, {
      inviteToken: context.req.param("inviteCode"),
      username: input.username,
      password: input.password,
    });
    writeSessionCookie(context, cookie, result.session);
    return context.json(presentAuthSession(result), 201);
  });

  routes.get("/me", async (context) => {
    const result = await dependencies.service.getMe(requestContext(context));
    return context.json(presentAuthSession(result));
  });

  return routes;
}

type CookieSettings = Readonly<{
  name: string;
  options: Readonly<{ httpOnly: true; sameSite: "Lax"; path: "/"; secure: boolean }>;
}>;

function resolveCookieConfig(config: AuthCookieConfig): CookieSettings {
  const publicUrl = new URL(config.publicUrl);
  if (publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") {
    throw new TypeError("Auth cookie publicUrl must use http or https");
  }
  const name = config.name?.trim() || DEFAULT_SESSION_COOKIE_NAME;
  return {
    name,
    options: {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: publicUrl.protocol === "https:",
    },
  };
}

function writeSessionCookie(
  context: Parameters<typeof setCookie>[0],
  cookie: CookieSettings,
  session: Readonly<{ rawToken: string; expiresAt: string; stayLoggedIn: boolean }>,
): void {
  setCookie(context, cookie.name, session.rawToken, session.stayLoggedIn
    ? {
        ...cookie.options,
        maxAge: SESSION_MAX_AGE_SECONDS,
        expires: new Date(session.expiresAt),
      }
    : cookie.options);
}

async function consume(
  rateLimiter: RateLimiter,
  operation: "register" | "username" | "invite-verify",
  clientValue: string,
  subject?: string,
): Promise<void> {
  const client = clientValue.trim();
  if (!client) throw new TypeError("Auth rate-limit client identifier is required");
  const suffix = subject ? `:${encodeURIComponent(subject)}` : "";
  const decision = await rateLimiter.consume(`auth:${operation}:${encodeURIComponent(client)}${suffix}`);
  if (!decision.allowed) {
    throw new AppError({
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many authentication requests",
      details: { retry_after_seconds: decision.retryAfterSeconds ?? 1 },
    });
  }
}
