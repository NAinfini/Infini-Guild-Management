import { AppError, type RateLimiter, type RequestContext } from "@guild/kernel";
import type { AuthService, EmailVerificationService, OAuthProvider, OAuthService } from "@guild/server/modules/auth";
import {
  accountSecurityResponseSchema,
  changeLoginNameSchema,
  changePasswordSchema,
  completePasswordResetSchema,
  linkedOAuthProviderSchema,
  loginSchema,
  logoutResponseSchema,
  oauthStartSchema,
  removeEmailSchema,
  registerSchema,
  requestEmailVerificationSchema,
  resendEmailVerificationSchema,
  verifyEmailSchema,
} from "@guild/shared";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { consumeCredentialRateLimit } from "../../core/credential-rate-limit.js";
import { clientIdentifier, requestContext, type HttpEnv } from "../../core/http-env.js";
import { parseJsonBody } from "../../core/parsing.js";
import { presentAuthSession, presentInviteVerification } from "../../presenters/auth/auth-presenter.js";

export const DEFAULT_SESSION_COOKIE_NAME = "ig_session";
export const HOST_SESSION_COOKIE_NAME = "__Host-ig_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_TRANSACTION_MAX_AGE_SECONDS = 10 * 60;

type AuthHttpService = Pick<AuthService,
  "login" | "logout" | "verifyInvite" | "register" | "getMe" | "getSecurity" | "changePassword" | "changeLoginName" | "completePasswordReset" | "createSessionForUserId"
>;

export type AuthCookieConfig = Readonly<{
  publicUrl: string;
  name?: string;
}>;

export type AuthRoutesDependencies = Readonly<{
  service: AuthHttpService;
  oauth: OAuthService;
  emailVerification: EmailVerificationService;
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
      loginName: input.login_name,
      password: input.password,
      stayLoggedIn: input.stay_logged_in === true,
      now: request.now,
      clientIdentifier: clientIdentifier(context),
    });
    writeSessionCookie(context, cookie, result.session);
    return context.json(presentAuthSession(result));
  });

  routes.post("/oauth/:provider/start", async (context) => {
    const request = requestContext(context);
    const provider = parseProvider(context.req.param("provider"));
    const input = await parseJsonBody(context.req.raw, oauthStartSchema, "Invalid OAuth start payload");
    await consume(dependencies.rateLimiter, "oauth-start", clientIdentifier(context));
    const actor = request.authorization.actor;
    if (actor) {
      await consumeCredentialRateLimit(dependencies.rateLimiter, actor.userId, clientIdentifier(context));
    }
    const result = actor
      ? await dependencies.oauth.startLink(request, provider, input.current_password ?? "")
      : await dependencies.oauth.startLogin(provider, request.now);
    writeOAuthTransactionCookie(context, cookie, result.browserBindingToken);
    return context.json({ authorization_url: result.authorizationUrl });
  });

  routes.get("/oauth/:provider/callback", async (context) => {
    const request = requestContext(context);
    const browserBindingToken = getCookie(context, cookie.oauthTransactionName);
    deleteCookie(context, cookie.oauthTransactionName, cookie.oauthTransactionOptions);
    const provider = parseProvider(context.req.param("provider"));
    const state = context.req.query("state");
    const code = context.req.query("code");
    if (!state || !code || !browserBindingToken || context.req.query("error")) {
      return context.redirect(callbackFailureUrl(cookie.publicUrl));
    }
    try {
      await consume(dependencies.rateLimiter, "oauth-callback", clientIdentifier(context));
      const result = await dependencies.oauth.finish(request, {
        provider,
        state,
        browserBindingToken,
        code,
        now: request.now,
      });
      if (result.kind === "login") {
        const session = await dependencies.service.createSessionForUserId(result.userId, request.now, result.authRevision);
        writeSessionCookie(context, cookie, session.session);
        return context.redirect(callbackSuccessUrl(cookie.publicUrl));
      }
      return context.redirect(callbackSuccessUrl(cookie.publicUrl, "linked"));
    } catch (error) {
      if (error instanceof AppError && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")) {
        return context.redirect(callbackFailureUrl(cookie.publicUrl));
      }
      throw error;
    }
  });

  routes.post("/logout", async (context) => {
    requestContext(context);
    const result = await dependencies.service.logout(getCookie(context, cookie.name) ?? null);
    deleteCookie(context, cookie.name, cookie.options);
    return context.json(logoutResponseSchema.parse(result));
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
      inviteCode: context.req.param("inviteCode"),
      loginName: input.login_name,
      displayName: input.display_name,
      password: input.password,
    });
    writeSessionCookie(context, cookie, result.session);
    return context.json(presentAuthSession(result), 201);
  });

  routes.get("/me", async (context) => {
    const result = await dependencies.service.getMe(requestContext(context));
    return context.json(presentAuthSession(result));
  });

  routes.get("/security", async (context) => {
    const request = requestContext(context);
    const [identity, oauthProviders, email] = await Promise.all([
      dependencies.service.getSecurity(request),
      dependencies.oauth.listLinkedProviders(request),
      dependencies.emailVerification.getVerifiedEmail(request),
    ]);
    return context.json(accountSecurityResponseSchema.parse({
      login_name: identity.loginName,
      display_name: identity.displayName,
      oauth_providers: oauthProviders,
      email,
      email_available: dependencies.emailVerification.available,
    }));
  });

  routes.patch("/security/password", async (context) => {
    const request = await credentialRequest(dependencies, context);
    const input = await parseJsonBody(context.req.raw, changePasswordSchema, "Invalid password change payload");
    return context.json(await dependencies.service.changePassword(request, {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    }));
  });

  routes.patch("/security/login-name", async (context) => {
    const request = await credentialRequest(dependencies, context);
    const input = await parseJsonBody(context.req.raw, changeLoginNameSchema, "Invalid login name payload");
    return context.json(await dependencies.service.changeLoginName(request, {
      currentPassword: input.currentPassword,
      loginName: input.login_name,
    }));
  });

  routes.post("/complete-password-reset", async (context) => {
    const input = await parseJsonBody(context.req.raw, completePasswordResetSchema, "Invalid password reset payload");
    const result = await dependencies.service.completePasswordReset(requestContext(context), {
      loginName: input.login_name,
      newPassword: input.new_password,
    });
    writeSessionCookie(context, cookie, result.session);
    return context.json(presentAuthSession(result));
  });

  routes.delete("/security/oauth/:provider", async (context) => {
    const request = await credentialRequest(dependencies, context);
    const input = await parseJsonBody(context.req.raw, oauthStartSchema, "Invalid OAuth unlink payload");
    if (!input.current_password) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Current password is required" });
    }
    return context.json(await dependencies.oauth.unlink(
      request,
      parseProvider(context.req.param("provider")),
      input.current_password,
    ));
  });

  routes.post("/security/email", async (context) => {
    const request = await credentialRequest(dependencies, context);
    const input = await parseJsonBody(context.req.raw, requestEmailVerificationSchema, "Invalid email verification payload");
    return context.json(await dependencies.emailVerification.request(request, {
      currentPassword: input.current_password,
      email: input.email,
    }));
  });

  routes.post("/security/email/resend", async (context) => {
    const request = await credentialRequest(dependencies, context);
    const input = await parseJsonBody(context.req.raw, resendEmailVerificationSchema, "Invalid email resend payload");
    return context.json(await dependencies.emailVerification.resend(request, input.current_password));
  });

  routes.post("/security/email/verify", async (context) => {
    const input = await parseJsonBody(context.req.raw, verifyEmailSchema, "Invalid email verification token");
    return context.json(await dependencies.emailVerification.verify(requestContext(context), input.token));
  });

  routes.delete("/security/email", async (context) => {
    const request = await credentialRequest(dependencies, context);
    const input = await parseJsonBody(context.req.raw, removeEmailSchema, "Invalid email removal payload");
    return context.json(await dependencies.emailVerification.remove(request, input.current_password));
  });

  return routes;
}

async function credentialRequest(
  dependencies: AuthRoutesDependencies,
  context: Context<HttpEnv>,
): Promise<RequestContext> {
  const request = requestContext(context);
  const actor = request.authorization.requireAuthenticated();
  await consumeCredentialRateLimit(dependencies.rateLimiter, actor.userId, clientIdentifier(context));
  return request;
}

function parseProvider(value: string): OAuthProvider {
  return linkedOAuthProviderSchema.parse(value);
}

function callbackSuccessUrl(publicUrl: string, status?: "linked"): string {
  const url = new URL(status === "linked" ? "/profile" : "/", publicUrl);
  if (status === "linked") {
    url.searchParams.set("tab", "account");
    url.searchParams.set("oauth", "linked");
  }
  return url.toString();
}

function callbackFailureUrl(publicUrl: string): string {
  const url = new URL("/login", publicUrl);
  url.searchParams.set("oauth", "failed");
  return url.toString();
}

type CookieSettings = Readonly<{
  name: string;
  oauthTransactionName: string;
  publicUrl: string;
  options: Readonly<{ httpOnly: true; sameSite: "Lax"; path: "/"; secure: boolean }>;
  oauthTransactionOptions: Readonly<{
    httpOnly: true;
    sameSite: "Lax";
    path: "/";
    secure: boolean;
  }>;
}>;

function resolveCookieConfig(config: AuthCookieConfig): CookieSettings {
  const publicUrl = new URL(config.publicUrl);
  if (publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") {
    throw new TypeError("Auth cookie publicUrl must use http or https");
  }
  const configuredName = config.name?.trim();
  if (
    publicUrl.protocol === "https:"
    && configuredName
    && configuredName !== DEFAULT_SESSION_COOKIE_NAME
    && configuredName !== HOST_SESSION_COOKIE_NAME
  ) {
    throw new TypeError("HTTPS session cookies must use the __Host-ig_session name");
  }
  const name = publicUrl.protocol === "https:"
    ? HOST_SESSION_COOKIE_NAME
    : configuredName || DEFAULT_SESSION_COOKIE_NAME;
  return {
    name,
    oauthTransactionName: `${name}_oauth_transaction`,
    publicUrl: publicUrl.origin,
    options: {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: publicUrl.protocol === "https:",
    },
    oauthTransactionOptions: {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: publicUrl.protocol === "https:",
    },
  };
}

function writeOAuthTransactionCookie(
  context: Parameters<typeof setCookie>[0],
  cookie: CookieSettings,
  browserBindingToken: string,
): void {
  setCookie(context, cookie.oauthTransactionName, browserBindingToken, {
    ...cookie.oauthTransactionOptions,
    maxAge: OAUTH_TRANSACTION_MAX_AGE_SECONDS,
  });
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
  operation: "register" | "invite-verify" | "oauth-start" | "oauth-callback",
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
