import { AsyncLocalStorage } from "node:async_hooks";
import { AppError, type SqlExecutor } from "@guild/kernel";
import {
  ApplicationRuntimeHealth,
  admitWebSocketHandshake,
  assertApplicationSchema,
  createApplication,
  isMaintenanceModeEnabled,
  maintenanceResponse,
  resolveStaticSiteBranding,
  type ApplicationConfig,
} from "@guild/application";
import { LIMITS } from "@guild/shared/config/limits";
import { CloudflareDeferredTasks } from "../adapters/deferred-tasks.js";
import { CloudflareAdminOperationsRuntime } from "../adapters/admin-operations-realtime.js";
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
  EXPENSIVE_READ_RATE_LIMITER: RateLimit;
  IG_PUBLIC_URL: string;
  IG_ALLOWED_ORIGINS?: string;
  IG_SESSION_COOKIE_NAME?: string;
  IG_INVITE_TOKEN_SECRET: string;
  IG_AUDIT_DOWNLOAD_SECRET: string;
  IG_PBKDF2_ITERATIONS?: string;
  IG_MAINTENANCE_MODE?: string;
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
  currentExecution: () => ExecutionContext,
) => CloudflareComposition;

type CloudflareResponseCache = Pick<Cache, "match" | "put">;
type CloudflareResponseCacheFactory = () => CloudflareResponseCache;
type CloudflareCacheStorage = CacheStorage & Readonly<{ default: Cache }>;

const seconds = (milliseconds: number) => milliseconds / 1_000;

/*
 * Durable Object stub 是 I/O 对象，绑在创建它的请求上下文上；组合体跨请求
 * 缓存之后，stub 必须每次使用现取，否则第二个请求会踩到 workerd 的
 * "Cannot perform I/O on behalf of a different request"。
 */
function notificationTarget(environment: CloudflareEnvironment): NotificationBinding {
  const stub = () => environment.NOTIFICATIONS.get(
    environment.NOTIFICATIONS.idFromName("global"),
  ) as NotificationBinding;
  return {
    fetch: (input: Request | string, init?: RequestInit) => stub().fetch(input as string, init as RequestInit),
  };
}

export function createCloudflareComposition(
  environment: CloudflareEnvironment,
  currentExecution: () => ExecutionContext,
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
    deferred: new CloudflareDeferredTasks(currentExecution),
    health: new ApplicationRuntimeHealth({
      sql,
      blobs,
      realtime: () => "ok (Durable Object)",
      scheduler: () => "configured (Cron Triggers)",
    }),
    adminOperationsRuntime: new CloudflareAdminOperationsRuntime(notifications),
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
    expensiveReadRateLimiter: new CloudflareRateLimiter(
      environment.EXPENSIVE_READ_RATE_LIMITER,
      seconds(LIMITS.rateLimit.expensiveReads.windowMs),
    ),
    clientIdentifier,
    onUnexpectedError: (error, requestId) => console.error("Portal API request failed", { requestId, error }),
  }, config);
  return Object.freeze({ application, clientIdentifier, config, notifications, sql });
}

export function createCloudflareHandler(
  compose: CloudflareCompositionFactory = createCloudflareComposition,
  responseCache: CloudflareResponseCacheFactory = () => (caches as CloudflareCacheStorage).default,
) {
  const schemaChecks = new WeakMap<D1Database, Promise<void>>();
  /*
   * 组合图只依赖 environment（绑定与配置），按隔离区缓存一份；请求域的
   * ExecutionContext 通过 AsyncLocalStorage 流进 defer 路径，而不是把
   * 某次请求的上下文烙进组合体——那正是过去每请求重建整张图的根因。
   */
  const compositions = new WeakMap<CloudflareEnvironment, CloudflareComposition>();
  const staticHandlers = new WeakMap<
    CloudflareEnvironment,
    ReturnType<typeof createCloudflareStaticAssets>
  >();
  const executionScope = new AsyncLocalStorage<ExecutionContext>();
  const currentExecution = (): ExecutionContext => {
    const execution = executionScope.getStore();
    if (!execution) throw new Error("No Cloudflare execution context is active");
    return execution;
  };

  function composition(environment: CloudflareEnvironment): CloudflareComposition {
    let cached = compositions.get(environment);
    if (!cached) {
      cached = compose(environment, currentExecution);
      compositions.set(environment, cached);
    }
    return cached;
  }

  function staticHandler(
    environment: CloudflareEnvironment,
    runtime: CloudflareComposition,
  ): ReturnType<typeof createCloudflareStaticAssets> {
    let cached = staticHandlers.get(environment);
    if (!cached) {
      cached = createCloudflareStaticAssets({
        assets: environment.ASSETS,
        getSiteBranding: () => resolveStaticSiteBranding(runtime.application.services.siteConfig),
      });
      staticHandlers.set(environment, cached);
    }
    return cached;
  }

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
    fetch(
      request: Request,
      environment: CloudflareEnvironment,
      execution: ExecutionContext,
    ): Promise<Response> {
      return executionScope.run(execution, async () => {
        const requestUrl = new URL(request.url);
        if (shouldRedirectToHttps(requestUrl)) return redirectToHttps(requestUrl);
        if (isMaintenanceModeEnabled(environment.IG_MAINTENANCE_MODE)) {
          return withTransportSecurity(maintenanceResponse(request), requestUrl);
        }
        try {
          const runtime = composition(environment);
          const pathname = requestUrl.pathname;
          if (pathname !== "/api/health") await assertSchema(environment.DB, runtime.sql);
          if (pathname === "/ws") return handleWebSocket(request, environment, runtime);
          if (isApiPath(pathname)) {
            return withTransportSecurity(
              await handleApiRequest(request, runtime, execution, responseCache),
              requestUrl,
            );
          }

          return withTransportSecurity(
            await staticHandler(environment, runtime)(request) ?? unavailable(request, 404, "Route not found"),
            requestUrl,
          );
        } catch (error) {
          console.error("Cloudflare runtime request failed", error);
          return withTransportSecurity(unavailable(request, 503, "Service unavailable"), requestUrl);
        }
      });
    },

    scheduled(
      event: ScheduledController,
      environment: CloudflareEnvironment,
      execution: ExecutionContext,
    ): Promise<void> {
      if (isMaintenanceModeEnabled(environment.IG_MAINTENANCE_MODE)) return Promise.resolve();
      return executionScope.run(execution, async () => {
        try {
          const runtime = composition(environment);
          await assertSchema(environment.DB, runtime.sql);
          if (!dispatchCloudflareScheduledJobs(event, execution, runtime.application.services.scheduledJobs)) {
            console.warn("Ignoring unknown Cloudflare schedule", { cron: event.cron });
          }
        } catch (error) {
          console.error("Cloudflare scheduled dispatch failed", error);
          throw error;
        }
      });
    },
  } satisfies ExportedHandler<CloudflareEnvironment>;
}

async function handleApiRequest(
  request: Request,
  runtime: CloudflareComposition,
  execution: ExecutionContext,
  responseCache: CloudflareResponseCacheFactory,
): Promise<Response> {
  if (!isCacheableMediaRequest(request)) return runtime.application.api.fetch(request);
  const cache = responseCache();
  const cacheKey = mediaCacheKey(request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await runtime.application.api.fetch(request);
  if (isPublicCacheableResponse(response)) {
    execution.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

function isCacheableMediaRequest(request: Request): boolean {
  return request.method === "GET"
    && new URL(request.url).pathname.startsWith("/api/media/")
    && !request.headers.has("Range");
}

function mediaCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = "";
  return new Request(url, { method: "GET" });
}

function isPublicCacheableResponse(response: Response): boolean {
  if (!response.ok) return false;
  const directives = new Set((response.headers.get("Cache-Control") ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase()));
  return directives.has("public") && !directives.has("private") && !directives.has("no-store");
}

async function handleWebSocket(
  request: Request,
  environment: CloudflareEnvironment,
  runtime: CloudflareComposition,
): Promise<Response> {
  /* 426 在闸门之前：普通 HTTP 打到 /ws 是协议用错了，与来源无关，两个运行时
     对这一点的答复必须一致。 */
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }

  const admission = await admitWebSocketHandshake({
    request,
    clientKey: runtime.clientIdentifier(request),
    rateLimiter: new CloudflareRateLimiter(
      environment.WEBSOCKET_RATE_LIMITER,
      seconds(LIMITS.websocket.handshakes.windowMs),
    ),
    auth: runtime.application.services.auth,
    config: runtime.config,
    nowIso: new Date().toISOString(),
  });
  if (!admission.accepted) {
    return new Response(admission.reason, {
      status: admission.status,
      ...(admission.retryAfterSeconds !== undefined
        ? { headers: { "Retry-After": String(admission.retryAfterSeconds) } }
        : {}),
    });
  }
  return forwardCloudflareNotificationWebSocket(request, admission.authorization, runtime.notifications);
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
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
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
