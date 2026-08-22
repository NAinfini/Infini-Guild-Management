import {
  AppError,
  createAuthorizationContext,
  createRequestContext,
  type DeferredTasks,
  type RateLimiter,
} from "@guild/kernel";
import { AuditArchiveDownloadTokens } from "@guild/server";
import {
  createAdminRoutes,
  createAdminAnalyticsSettingsRoutes,
  createAdminOperationsRoutes,
  createAdminSiteConfigRoutes,
  createAdminStatusRoutes,
  createAnnouncementRoutes,
  createAuditArchiveRoutes,
  createAuditRoutes,
  createAuthRoutes,
  createBadgeRoutes,
  createBlobReconciliationRoutes,
  createClassRoutes,
  createClassTagRoutes,
  createDashboardRoutes,
  createEventsRoutes,
  createErrorLogRoutes,
  createGalleryRoutes,
  createGuildWarRoutes,
  createHealthRoutes,
  createHttpErrorHandler,
  createMediaRoutes,
  createMutationSecurityMiddleware,
  createPublicSiteConfigRoutes,
  createRequestBodyLimitMiddleware,
  createRequestContextMiddleware,
  createSearchRoutes,
  createStorageRoutes,
  createSystemTestRequestMiddleware,
  createSystemTestRoutes,
  createUsersRoutes,
  createWikiRoutes,
  DEFAULT_SESSION_COOKIE_NAME,
  parseImageUploads,
  type HttpEnv,
} from "@guild/transport-http";
import { Hono } from "hono";
import type { ApplicationServices } from "./services.js";

export type PortalApiConfig = Readonly<{
  publicUrl: string;
  allowedOrigins?: readonly string[];
  sessionCookieName?: string;
  auditDownloadSecret: Uint8Array;
}>;

export type PortalApiRuntime = Readonly<{
  authRateLimiter: RateLimiter;
  readRateLimiter: RateLimiter;
  expensiveReadRateLimiter: RateLimiter;
  mutationRateLimiter: RateLimiter;
  uploadRateLimiter: RateLimiter;
  deferred: DeferredTasks;
  clientIdentifier(request: Request): string;
  onUnexpectedError?(error: Error, requestId: string): void;
}>;

export function createPortalApiApp(
  services: ApplicationServices,
  runtime: PortalApiRuntime,
  config: PortalApiConfig,
): Hono<HttpEnv> {
  const publicOrigin = resolvePublicOrigin(config.publicUrl);
  const cookieName = resolveSessionCookieName(config.sessionCookieName);
  const downloadTokens = new AuditArchiveDownloadTokens(config.auditDownloadSecret);
  const app = new Hono<HttpEnv>();

  app.onError(createHttpErrorHandler({
    onUnexpected: async (error, requestId, request) => {
      runtime.onUnexpectedError?.(error, requestId);
      await services.errorLog.recordUnexpected({
        error,
        requestId,
        requestPath: request.path,
        requestMethod: request.method,
        createdAt: request.occurredAt,
      });
    },
  }));
  app.use("/api/*", async (context, next) => {
    if (!SUPPORTED_API_METHODS.has(context.req.method)) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: "HTTP method is not supported",
      });
    }
    const client = runtime.clientIdentifier(context.req.raw).trim();
    if (!client) throw new TypeError("Request rate-limit client identifier is required");
    context.set("clientIdentifier", client);
    return next();
  });
  app.use("/api/*", createMutationSecurityMiddleware({
    allowedOrigins: [publicOrigin, ...(config.allowedOrigins ?? [])],
  }));
  app.use("/api/*", async (context, next) => {
    const client = context.get("clientIdentifier");
    const method = context.req.method;
    const read = method === "GET" || method === "HEAD";
    const upload = MUTATION_METHODS.has(method)
      && context.req.header("Content-Type")?.toLowerCase().startsWith("multipart/form-data") === true;
    const limiter = read
      ? runtime.readRateLimiter
      : upload
        ? runtime.uploadRateLimiter
        : MUTATION_METHODS.has(method)
          ? runtime.mutationRateLimiter
          : null;
    if (!limiter) return next();
    const bucket = read ? "read" : upload ? "upload" : "mutation";
    const decision = await limiter.consume(`api:${bucket}:${encodeURIComponent(client)}`);
    if (!decision.allowed) {
      throw new AppError({
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many requests",
        details: { retry_after_seconds: decision.retryAfterSeconds ?? 1 },
      });
    }
    if (read && isExpensiveRead(context.req.path)) {
      const expensiveDecision = await runtime.expensiveReadRateLimiter.consume(
        `api:expensive-read:${encodeURIComponent(client)}`,
      );
      if (!expensiveDecision.allowed) {
        throw new AppError({
          code: "RATE_LIMITED",
          status: 429,
          message: "Too many expensive requests",
          details: { retry_after_seconds: expensiveDecision.retryAfterSeconds ?? 1 },
        });
      }
    }
    return next();
  });
  app.use("/api/*", createRequestBodyLimitMiddleware());
  const authenticatedRequestContext = createRequestContextMiddleware(async (request) => {
    const now = new Date().toISOString();
    const { authorization } = await services.auth.resolveAuthorization(readSessionCookie(request, cookieName), now);
    return createRequestContext({
      requestId: crypto.randomUUID(),
      authorization,
      now,
      signal: request.signal,
    });
  });
  app.use("/api/*", async (context, next) => {
    if (context.req.path !== "/api/health") return authenticatedRequestContext(context, next);
    context.set("requestContext", createRequestContext({
      requestId: crypto.randomUUID(),
      authorization: createAuthorizationContext(null),
      now: new Date().toISOString(),
      signal: context.req.raw.signal,
    }));
    return next();
  });
  app.use("/api/*", createSystemTestRequestMiddleware(services.systemTest));
  app.use("/api/*", async (context, next) => {
    await next();
    if (!context.res.headers.has("Cache-Control")) context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
  });

  app.route("/api/site-config", createPublicSiteConfigRoutes({ service: services.siteConfig }));
  app.route("/api/health", createHealthRoutes({ service: services.health }));
  app.route("/api/auth", createAuthRoutes({
    service: services.auth,
    rateLimiter: runtime.authRateLimiter,
    cookie: { publicUrl: publicOrigin, name: cookieName },
  }));
  app.route("/api/users", createUsersRoutes({ service: services.members, authService: services.auth }));
  app.route("/api/classes", createClassRoutes({ service: services.memberCatalog }));
  app.route("/api/class-tags", createClassTagRoutes({ service: services.memberCatalog }));
  app.route("/api/badges", createBadgeRoutes({ service: services.memberCatalog }));

  app.route("/api/events", createEventsRoutes({
    service: services.events,
    stageEventImages: async (context, form) => {
      const [uploads, current] = await Promise.all([parseImageUploads(form), services.siteConfig.getRuntimePolicy()]);
      return services.media.uploadImages(
        context,
        "event_image",
        uploads,
        current.media_policy.max_file_size_bytes.event_image,
      );
    },
  }));
  app.route("/api/guild-war", createGuildWarRoutes({ service: services.guildWar }));
  app.route("/api/storage", createStorageRoutes({
    service: services.storage,
    parseImageFormData: parseImageUploads,
  }));

  const imagePolicy = (kind: "announcement" | "gallery" | "wiki") => async () => {
    const current = await services.siteConfig.getRuntimePolicy();
    return {
      maxBytes: current.media_policy.max_file_size_bytes[`${kind}_image`],
      quota: current.media_policy.quotas[kind],
    };
  };
  app.route("/api/announcements", createAnnouncementRoutes({
    service: services.announcements,
    publicOrigin,
    getImagePolicy: imagePolicy("announcement"),
  }));
  app.route("/api/gallery", createGalleryRoutes({
    service: services.gallery,
    getImagePolicy: imagePolicy("gallery"),
  }));
  app.route("/api/wiki", createWikiRoutes({
    service: services.wiki,
    publicOrigin,
    getImagePolicy: imagePolicy("wiki"),
  }));
  app.route("/api/media", createMediaRoutes({ service: services.media }));

  app.route("/api/dashboard", createDashboardRoutes({ service: services.portalReadModels }));
  app.route("/api/search", createSearchRoutes({ service: services.portalReadModels }));
  app.route("/api/admin/status", createAdminStatusRoutes({ service: services.adminStatus }));
  app.route("/api/admin/operations", createAdminOperationsRoutes({ service: services.adminOperations }));
  app.route("/api/admin/analytics-settings", createAdminAnalyticsSettingsRoutes({ service: services.siteConfig }));
  app.route("/api/admin/site-config", createAdminSiteConfigRoutes({ service: services.siteConfig }));
  app.route("/api/admin", createAdminRoutes({ service: services.identityAdmin }));
  app.route("/api/admin", createErrorLogRoutes({ service: services.errorLog }));
  app.route("/api/admin", createSystemTestRoutes(services.systemTest));
  app.route("/api/admin", createAuditRoutes({ service: services.audit }));
  app.route("/api/admin", createAuditArchiveRoutes({ service: services.auditArchive, tokens: downloadTokens }));
  app.route("/api/admin", createBlobReconciliationRoutes({ service: services.blobReconciliation }));

  app.notFound((context) => {
    const requestId = context.get("requestContext")?.requestId ?? crypto.randomUUID();
    const error = new AppError({ code: "NOT_FOUND", status: 404, message: "API route not found" });
    return context.json(error.toResponseBody(requestId), 404, { "X-Request-Id": requestId });
  });
  return app;
}

function resolvePublicOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new TypeError("publicUrl must be a root HTTP(S) URL");
  }
  return url.origin;
}

export function resolveSessionCookieName(value: string | undefined): string {
  const name = value?.trim() || DEFAULT_SESSION_COOKIE_NAME;
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new TypeError("Invalid session cookie name");
  return name;
}

export function readSessionCookie(request: Request, name: string): string | null {
  const values = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length !== 1 || !values[0]) return null;
  try {
    return decodeURIComponent(values[0]);
  } catch {
    return null;
  }
}

const MUTATION_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const SUPPORTED_API_METHODS = new Set(["GET", "HEAD", ...MUTATION_METHODS]);
const EXPENSIVE_READ_PATHS = new Set([
  "/api/guild-war/analytics",
  "/api/search",
  "/api/users",
]);

function isExpensiveRead(pathname: string): boolean {
  return EXPENSIVE_READ_PATHS.has(pathname);
}
