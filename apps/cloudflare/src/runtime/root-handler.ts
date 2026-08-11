import { AppError, type SqlExecutor } from "@guild/kernel";
import {
  ApplicationRuntimeHealth,
  assertApplicationSchema,
  createApplication,
  readSessionCookie,
  resolveSessionCookieName,
  type ApplicationConfig,
} from "@guild/application";
import { LIMITS } from "@guild/shared/config/limits";
import { CloudflareDeferredTasks } from "../adapters/deferred-tasks.js";
import { D1SqlExecutor } from "../adapters/d1-sql-executor.js";
import { CloudflareNotificationPublisher } from "../adapters/notification-publisher.js";
import { R2BlobStore } from "../adapters/r2-blob-store.js";
import { CloudflareRateLimiter } from "../adapters/rate-limiter.js";
import {
  forwardCloudflareNotificationWebSocket,
  type CloudflareNotificationTarget,
} from "./notification-durable-object.js";
import { dispatchCloudflareScheduledJobs } from "./scheduled-dispatcher.js";
import { createCloudflareStaticAssets } from "./static-assets.js";
import { cloudflareClientIdentifier, readCloudflareRuntimeConfig } from "./config.js";

export interface CloudflareEnvironment {
  DB: D1Database;
  BLOBS: R2Bucket;
  ASSETS: Fetcher;
  NOTIFICATIONS: DurableObjectNamespace;
  AUTH_RATE_LIMITER: RateLimit;
  READ_RATE_LIMITER: RateLimit;
  MUTATION_RATE_LIMITER: RateLimit;
  UPLOAD_RATE_LIMITER: RateLimit;
  WEBSOCKET_RATE_LIMITER: RateLimit;
  IG_PUBLIC_URL: string;
  IG_ALLOWED_ORIGINS?: string;
  IG_SESSION_COOKIE_NAME?: string;
  IG_INVITE_TOKEN_SECRET: string;
  IG_AUDIT_DOWNLOAD_SECRET: string;
  IG_PBKDF2_ITERATIONS?: string;
}

type CloudflareApplication = ReturnType<typeof createApplication>;
type NotificationBinding = CloudflareNotificationTarget & {
  fetch(input: string, init: RequestInit): Promise<Response>;
};

export type CloudflareComposition = Readonly<{
  application: CloudflareApplication;
  clientIdentifier(request: Request): string;
  config: ApplicationConfig;
  notifications: NotificationBinding;
  sql: SqlExecutor;
}>;

export type CloudflareCompositionFactory = (
  environment: CloudflareEnvironment,
  execution: ExecutionContext,
) => CloudflareComposition;

const seconds = (milliseconds: number) => milliseconds / 1_000;

function notificationTarget(environment: CloudflareEnvironment): NotificationBinding {
  return environment.NOTIFICATIONS.get(
    environment.NOTIFICATIONS.idFromName("global"),
  ) as NotificationBinding;
}

export function createCloudflareComposition(
  environment: CloudflareEnvironment,
  execution: ExecutionContext,
): CloudflareComposition {
  const runtimeConfig = readCloudflareRuntimeConfig({
    IG_PUBLIC_URL: environment.IG_PUBLIC_URL,
    IG_ALLOWED_ORIGINS: environment.IG_ALLOWED_ORIGINS,
    IG_SESSION_COOKIE_NAME: environment.IG_SESSION_COOKIE_NAME,
    IG_INVITE_TOKEN_SECRET: environment.IG_INVITE_TOKEN_SECRET,
    IG_AUDIT_DOWNLOAD_SECRET: environment.IG_AUDIT_DOWNLOAD_SECRET,
    IG_PBKDF2_ITERATIONS: environment.IG_PBKDF2_ITERATIONS,
  });
  const config = runtimeConfig.application;
  const clientIdentifier = (request: Request) => cloudflareClientIdentifier(request, runtimeConfig.localDevelopment);
  const sql = new D1SqlExecutor(environment.DB);
  const blobs = new R2BlobStore(environment.BLOBS);
  const notifications = notificationTarget(environment);
  const application = createApplication({
    sql,
    blobs,
    blobInventory: blobs,
    notifications: new CloudflareNotificationPublisher(notifications),
    deferred: new CloudflareDeferredTasks(execution),
    health: new ApplicationRuntimeHealth({
      sql,
      blobs,
      realtime: () => "ok (Durable Object)",
      scheduler: () => "configured (Cron Triggers)",
    }),
    authRateLimiter: new CloudflareRateLimiter(
      environment.AUTH_RATE_LIMITER,
      seconds(LIMITS.rateLimit.auth.windowMs),
    ),
    readRateLimiter: new CloudflareRateLimiter(
      environment.READ_RATE_LIMITER,
      seconds(LIMITS.rateLimit.reads.windowMs),
    ),
    mutationRateLimiter: new CloudflareRateLimiter(
      environment.MUTATION_RATE_LIMITER,
      seconds(LIMITS.rateLimit.mutations.windowMs),
    ),
    uploadRateLimiter: new CloudflareRateLimiter(
      environment.UPLOAD_RATE_LIMITER,
      seconds(LIMITS.rateLimit.uploads.windowMs),
    ),
    clientIdentifier,
    onUnexpectedError: (error, requestId) => console.error("Portal API request failed", { requestId, error }),
  }, config);
  return Object.freeze({ application, clientIdentifier, config, notifications, sql });
}

export function createCloudflareHandler(
  compose: CloudflareCompositionFactory = createCloudflareComposition,
) {
  const schemaChecks = new WeakMap<D1Database, Promise<void>>();

  async function assertSchema(database: D1Database, sql: SqlExecutor): Promise<void> {
    let check = schemaChecks.get(database);
    if (!check) {
      check = assertApplicationSchema(sql).catch((error: unknown) => {
        schemaChecks.delete(database);
        throw error;
      });
      schemaChecks.set(database, check);
    }
    await check;
  }

  return {
    async fetch(
      request: Request,
      environment: CloudflareEnvironment,
      execution: ExecutionContext,
    ): Promise<Response> {
      const requestUrl = new URL(request.url);
      if (shouldRedirectToHttps(requestUrl)) return redirectToHttps(requestUrl);
      try {
        const runtime = compose(environment, execution);
        await assertSchema(environment.DB, runtime.sql);
        const pathname = requestUrl.pathname;
        if (pathname === "/ws") return handleWebSocket(request, environment, runtime);
        if (isApiPath(pathname)) {
          return withTransportSecurity(await runtime.application.api.fetch(request), requestUrl);
        }

        const staticFiles = createCloudflareStaticAssets({
          assets: environment.ASSETS,
          getSiteBranding: async () => {
            const site = await runtime.application.services.siteConfig.getPublic();
            return {
              siteName: site.site_name,
              siteLogoUrl: site.site_logo_media_id
                ? `/api/media/${encodeURIComponent(site.site_logo_media_id)}/view`
                : site.default_site_logo_url,
            };
          },
        });
        return withTransportSecurity(
          await staticFiles(request) ?? unavailable(request, 404, "Route not found"),
          requestUrl,
        );
      } catch (error) {
        console.error("Cloudflare runtime request failed", error);
        return withTransportSecurity(unavailable(request, 503, "Service unavailable"), requestUrl);
      }
    },

    async scheduled(
      event: ScheduledController,
      environment: CloudflareEnvironment,
      execution: ExecutionContext,
    ): Promise<void> {
      try {
        const runtime = compose(environment, execution);
        await assertSchema(environment.DB, runtime.sql);
        if (!dispatchCloudflareScheduledJobs(event, execution, runtime.application.services.scheduledJobs)) {
          console.warn("Ignoring unknown Cloudflare schedule", { cron: event.cron });
        }
      } catch (error) {
        console.error("Cloudflare scheduled dispatch failed", error);
        throw error;
      }
    },
  } satisfies ExportedHandler<CloudflareEnvironment>;
}

async function handleWebSocket(
  request: Request,
  environment: CloudflareEnvironment,
  runtime: CloudflareComposition,
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const allowed = new Set([runtime.config.publicUrl, ...(runtime.config.allowedOrigins ?? [])]);
  if (!origin || !allowed.has(origin)) return new Response("Forbidden WebSocket origin", { status: 403 });
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }

  const retryAfterSeconds = seconds(LIMITS.websocket.handshakes.windowMs);
  const rate = await new CloudflareRateLimiter(environment.WEBSOCKET_RATE_LIMITER, retryAfterSeconds)
    .consume(`ws:${runtime.clientIdentifier(request)}`);
  if (!rate.allowed) {
    return new Response("Too many WebSocket handshakes", {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfterSeconds ?? retryAfterSeconds) },
    });
  }

  const token = readSessionCookie(request, resolveSessionCookieName(runtime.config.sessionCookieName));
  const { authorization } = await runtime.application.services.auth.resolveAuthorization(
    token,
    new Date().toISOString(),
  );
  if (!authorization.isAuthenticated()) return new Response("Authentication required", { status: 401 });
  return forwardCloudflareNotificationWebSocket(request, authorization, runtime.notifications);
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function shouldRedirectToHttps(url: URL): boolean {
  return url.protocol === "http:" && !isLoopbackHostname(url.hostname);
}

function redirectToHttps(url: URL): Response {
  const target = new URL(url);
  target.protocol = "https:";
  if (target.port === "80") target.port = "";
  return new Response(null, {
    status: 308,
    headers: {
      "Cache-Control": "no-store",
      Location: target.toString(),
    },
  });
}

function withTransportSecurity(response: Response, url: URL): Response {
  if (url.protocol !== "https:" || isLoopbackHostname(url.hostname)) return response;
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

function unavailable(request: Request, status: 404 | 503, message: string): Response {
  if (isApiPath(new URL(request.url).pathname)) {
    const requestId = crypto.randomUUID();
    const error = new AppError({
      code: status === 404 ? "NOT_FOUND" : "UPSTREAM_ERROR",
      status,
      message,
    });
    return Response.json(error.toResponseBody(requestId), {
      status,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  }
  return new Response(request.method === "HEAD" ? null : message, {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=UTF-8" },
  });
}

export default createCloudflareHandler();
