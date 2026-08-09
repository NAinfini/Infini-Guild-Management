import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { LIMITS } from "@guild/shared/config/limits";
import { logger } from "./utils/logger";
import { runDailyMaintenanceCron, runQuarterHourlyMaintenanceCron } from "./crons/maintenance";
import { WebSocketDO, WS_ACCOUNT_ID_HEADER, WS_SESSION_ID_HEADER } from "./durable-objects/WebSocketDO";
import { etagMiddleware } from "./middleware/etag";
import { featureGateMiddleware } from "./middleware/feature-gate";
import { handleAppError } from "./middleware/error-handler";
import { createRateLimitMiddleware } from "./middleware/rate-limit";
import { buildSpaHtmlCsp, HSTS_VALUE, PERMISSIONS_POLICY_VALUE, REFERRER_POLICY_VALUE, securityHeadersMiddleware, X_CONTENT_TYPE_VALUE } from "./middleware/security-headers";
import { sessionMiddleware } from "./middleware/session";
import { resolveSession, type SessionUser } from "./services/auth";
import { adminRoutes } from "./routes/admin";
import { announcementsRoutes } from "./routes/announcements";
import { authRoutes } from "./routes/auth";
import { dashboardRoutes } from "./routes/dashboard";
import { eventsRoutes } from "./routes/events";
import { galleryRoutes } from "./routes/gallery";
import { guildWarRoutes } from "./routes/guild-war";
import { searchRoutes } from "./routes/search";
import { storageRoutes } from "./routes/storage";
import { siteConfigRoutes } from "./routes/site-config";
import { usersRoutes } from "./routes/users";
import { wikiRoutes } from "./routes/wiki";
import { badgeRoutes } from "./routes/badges";
import { classTagRoutes } from "./routes/class-tags";
import { classRoutes } from "./routes/classes";
import { mediaRoutes } from "./routes/media";
import { systemTestTrackingMiddleware } from "./middleware/system-test-tracking";
import { MediaService } from "./services/MediaService";

export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  WS: DurableObjectNamespace;
  ASSETS: Fetcher;
  PORTAL_ORIGIN?: string;
  ENVIRONMENT?: string;
  PBKDF2_ITERATIONS?: string;
  SIGNING_SECRET: string;
  SITE_LOGO_URL: string;
};

type Variables = {
  requestId: string;
  user: SessionUser | null;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const RL = LIMITS.rateLimit;
const authRateLimit = createRateLimitMiddleware({
  keyPrefix: "auth",
  maxRequests: RL.auth.maxRequests,
  windowMs: RL.auth.windowMs,
});
const checkUsernameRateLimit = createRateLimitMiddleware({
  keyPrefix: "auth-check",
  maxRequests: RL.usernameCheck.maxRequests,
  windowMs: RL.usernameCheck.windowMs,
});
const mutationRateLimit = createRateLimitMiddleware({
  keyPrefix: "mutation",
  maxRequests: RL.mutations.maxRequests,
  windowMs: RL.mutations.windowMs,
});
const uploadRateLimit = createRateLimitMiddleware({
  keyPrefix: "upload",
  maxRequests: RL.uploads.maxRequests,
  windowMs: RL.uploads.windowMs,
});
const credentialChangeRateLimit = createRateLimitMiddleware({
  keyPrefix: "cred-change",
  maxRequests: RL.credentials.maxRequests,
  windowMs: RL.credentials.windowMs,
});
const readRateLimit = createRateLimitMiddleware({
  keyPrefix: "read",
  maxRequests: RL.reads.maxRequests,
  windowMs: RL.reads.windowMs,
  deferWrite: true,
});

function isMutationMethod(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE";
}

function isCredentialChangePath(path: string): boolean {
  return path.endsWith("/change-password") || path.endsWith("/change-username");
}

function rejectBadOrigin(c: Context<{ Bindings: Bindings; Variables: Variables }>): Response | null {
  const origin = c.req.header("Origin");
  if (!origin) {
    return c.json({ error_code: "FORBIDDEN", message: "Origin header required", request_id: c.get("requestId") }, 403);
  }
  const portalOrigin = c.env.PORTAL_ORIGIN;
  const selfOrigin = new URL(c.req.url).origin;
  if (origin !== selfOrigin && (!portalOrigin || origin !== portalOrigin)) {
    return c.json({ error_code: "FORBIDDEN", message: "Origin not allowed", request_id: c.get("requestId") }, 403);
  }
  return null;
}

function isUploadPath(path: string): boolean {
  return (
    path === "/api/events" ||
    path === "/api/gallery/images" ||
    path === "/api/announcements/images" ||
    /^\/api\/classes\/[^/]+\/icon$/.test(path) ||
    path === "/api/admin/site-config/logo" ||
    /^\/api\/users\/[^/]+\/media\/(?:images|avatar|audio)$/.test(path) ||
    /^\/api\/(?:announcements|events)\/[^/]+\/images$/.test(path) ||
    /^\/api\/wiki\/articles\/[^/]+\/images$/.test(path) ||
    /^\/api\/storage\/items\/[^/]+\/images$/.test(path)
  );
}

export function getApiRequestBodyLimit(path: string): number {
  return isUploadPath(path) ? LIMITS.requestBody.upload : LIMITS.requestBody.ordinary;
}

export function isImmutableBuildAssetPath(pathname: string): boolean {
  if (!pathname.startsWith("/assets/")) return false;
  const filename = pathname.split("/").pop() ?? "";
  return /(?:^|[-.])[A-Za-z0-9_-]{8,}\.(?:css|js|mjs|woff2?|png|jpe?g|webp|svg)$/i.test(filename);
}

app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  await next();
  c.header("X-Request-Id", c.get("requestId"));
});

app.use("*", async (c, next) => {
  const env = c.env as Bindings;
  if (env.ENVIRONMENT !== "development") {
    const missing = ["SIGNING_SECRET", "SITE_LOGO_URL"].filter(k => !env[k as keyof Bindings]);
    if (missing.length > 0) {
      logger.error("Missing required environment variables", { missing });
      return c.json({ error_code: "SERVER_ERROR", message: "Server misconfigured", request_id: c.get("requestId") }, 500);
    }
  }
  await next();
});

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowedOrigin = c.env.PORTAL_ORIGIN;
      if (!allowedOrigin) return null;
      if (origin !== allowedOrigin) return null;
      return origin;
    },
    allowHeaders: ["Content-Type", "If-None-Match", "If-Match", "X-Signature", "X-Timestamp", "X-Request-Id", "X-Requested-With", "X-System-Test", "X-System-Test-Audit", "X-System-Test-Run-Id"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 86400,
  }),
);

app.use("*", securityHeadersMiddleware);

app.use("/api/*", async (c, next) => {
  if (isMutationMethod(c.req.method)) {
    const blocked = rejectBadOrigin(c);
    if (blocked) return blocked;
    if (c.req.header("X-Requested-With") !== "XMLHttpRequest") {
      return c.json({ error_code: "FORBIDDEN", message: "Missing required header", request_id: c.get("requestId") }, 403);
    }
  }
  await next();
});

app.onError((error, c) => handleAppError(error, c));

app.get("/api/health", async (c) => {
  const env = c.env as Bindings;
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (!result || result.ok !== 1) {
      return c.json({ ok: false, request_id: c.get("requestId") }, 503);
    }
  } catch {
    return c.json({ ok: false, request_id: c.get("requestId") }, 503);
  }
  return c.json({ ok: true, request_id: c.get("requestId") });
});

// Wrap every downstream API middleware so a test-triggered 5xx can register
// its exact error-log UUID before the run lease is released.
app.use("/api/*", systemTestTrackingMiddleware);
app.use("/api/auth/login", authRateLimit);
app.use("/api/auth/register/*", authRateLimit);
app.use("/api/auth/check-username", checkUsernameRateLimit);
app.use("/api/admin/*", sessionMiddleware);
app.use("/api/*", async (c, next) => {
  if (c.req.method === "POST" && isUploadPath(c.req.path)) {
    await uploadRateLimit(c, next);
    return;
  }

  if (c.req.method === "POST" && isCredentialChangePath(c.req.path)) {
    await credentialChangeRateLimit(c, next);
    return;
  }

  if (isMutationMethod(c.req.method)) {
    await mutationRateLimit(c, next);
    return;
  }

  if (c.req.method === "GET" || c.req.method === "HEAD") {
    await readRateLimit(c, next);
    return;
  }

  await next();
});
app.use("/api/*", async (c, next) => {
  if (!isMutationMethod(c.req.method)) return next();
  return bodyLimit({
    maxSize: getApiRequestBodyLimit(c.req.path),
    onError: () => c.json({
      error_code: "VALIDATION_ERROR",
      message: "Request body too large",
      request_id: c.get("requestId"),
    }, 413),
  })(c, next);
});
app.use("/api/*", etagMiddleware);

function rejectNonDev(c: Context<{ Bindings: Bindings; Variables: Variables }>): Response | null {
  const env = c.env as Bindings;
  if (env.ENVIRONMENT !== "development") {
    return c.json({ error_code: "NOT_FOUND", message: "Not found", request_id: c.get("requestId") }, 404);
  }
  return null;
}

app.post("/api/dev/seed", async (c) => {
  const blocked = rejectNonDev(c);
  if (blocked) return blocked;
  const { seedDatabase } = await import("./db/seed");
  await seedDatabase(c.env);
  return c.json({ ok: true, message: "Database seeded" });
});
app.post("/api/dev/reseed", async (c) => {
  const blocked = rejectNonDev(c);
  if (blocked) return blocked;
  const { clearAllData, seedDatabase } = await import("./db/seed");
  const { clearLocalMediaObjects } = await import("./db/seed-media");
  await clearAllData(c.env);
  await clearLocalMediaObjects(c.env);
  await seedDatabase(c.env);
  return c.json({ ok: true, message: "Database cleared and reseeded" });
});
/*
 * e2e 的清理断言基准。列表接口只能看到它们愿意暴露的东西——
 * 靠它们判断「清干净了」等于用抽样冒充证据。这里直接读每张表的行数
 * 和 R2 的对象数，跑前跑后逐项比对，任何一条残留都对不上。
 * 与 seed/reseed 同一个 development 门禁，生产环境返回 404。
 */
app.get("/api/dev/table-counts", async (c) => {
  const blocked = rejectNonDev(c);
  if (blocked) return blocked;
  const env = c.env as Bindings;
  const counts: Record<string, number> = {};
  try {
    /* D1 不允许读 sqlite_master（SQLITE_AUTH），所以表清单取自 seed 自己维护的那份。
       它同时也是 clearAllData 的清单——用同一份列表，就不会出现
       「能被重种清掉、却不在残留检查视野里」的表。 */
    const { SEED_CLEAR_TABLES } = await import("./db/seed");

    for (const name of SEED_CLEAR_TABLES) {
      // name 来自代码里的常量数组，不是请求输入，拼接不引入注入面。
      const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM "${name}"`).first<{ total: number }>();
      counts[`table:${name}`] = row?.total ?? 0;
    }

    let mediaObjects = 0;
    let cursor: string | undefined;
    do {
      const page = await env.MEDIA.list(cursor ? { cursor, limit: 1000 } : { limit: 1000 });
      mediaObjects += page.objects.length;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    counts["r2:media"] = mediaObjects;
  } catch (error) {
    // 这是给 e2e 用的诊断端点：把真实原因原样抬出来，别让它变成一句 Internal server error。
    return c.json({ error_code: "SERVER_ERROR", message: error instanceof Error ? error.stack ?? error.message : String(error) }, 500);
  }

  return c.json({ counts });
});
app.get("/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected websocket", 426);
  }

  // Validate origin to prevent cross-origin WebSocket hijacking
  const blocked = rejectBadOrigin(c);
  if (blocked) return blocked;

  const session = await resolveSession(c);
  if (!session) {
    return c.json({ error_code: "UNAUTHORIZED", message: "Authentication required", request_id: c.get("requestId") }, 401);
  }

  const objectId = c.env.WS.idFromName("global");
  const stub = c.env.WS.get(objectId);

  // The DO needs the session id for periodic revalidation and the account id for
  // per-account quotas. `set` overwrites both client-supplied internal headers.
  const headers = new Headers(c.req.raw.headers);
  headers.set(WS_ACCOUNT_ID_HEADER, session.user.id);
  headers.set(WS_SESSION_ID_HEADER, session.sessionId);
  return stub.fetch(c.req.url, { method: "GET", headers });
});

app.use("/api/*", featureGateMiddleware);

app.route("/api/auth", authRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/events", eventsRoutes);
app.route("/api/announcements", announcementsRoutes);
app.route("/api/guild-war", guildWarRoutes);
app.route("/api/wiki", wikiRoutes);
app.route("/api/gallery", galleryRoutes);
app.route("/api/badges", badgeRoutes);
app.route("/api/classes", classRoutes);
app.route("/api/media", mediaRoutes);
/* 单独挂一个前缀而不是塞进 /api/classes：那边已经有 /:id，"tags" 会被当成职业 id
   吃掉，只能靠注册顺序绕开——一条以后随时会被踩坏的隐式约束。 */
app.route("/api/class-tags", classTagRoutes);
app.route("/api/storage", storageRoutes);
app.route("/api/site-config", siteConfigRoutes);
app.route("/api/admin", adminRoutes);

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
      return app.fetch(request, env, ctx);
    }
    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      let siteRow: { site_name: string } | null;
      try {
        siteRow = await env.DB.prepare("SELECT site_name FROM site_config WHERE id = ?1")
          .bind("default")
          .first<{ site_name: string }>();
      } catch (error) {
        logger.error("Failed to load site name from D1", {
          error: error instanceof Error ? error.message : String(error),
        });
        return new Response("Site configuration unavailable", { status: 500 });
      }
      if (!siteRow || siteRow.site_name.length === 0 || siteRow.site_name !== siteRow.site_name.trim()) {
        logger.error("Required D1 site configuration is missing or invalid");
        return new Response("Site configuration unavailable", { status: 500 });
      }
      let html = await assetResponse.text();
      html = html.replaceAll("{{SITE_NAME}}", siteRow.site_name);
      html = html.replaceAll("{{SITE_LOGO_URL}}", env.SITE_LOGO_URL);
      const response = new Response(html, assetResponse);
      response.headers.set("Cache-Control", "no-cache, no-store, must-revalidate, no-transform");
      response.headers.set("X-Content-Type-Options", X_CONTENT_TYPE_VALUE);
      response.headers.set("X-Frame-Options", "DENY");
      response.headers.set("Strict-Transport-Security", HSTS_VALUE);
      response.headers.set("Referrer-Policy", REFERRER_POLICY_VALUE);
      response.headers.set("Permissions-Policy", PERMISSIONS_POLICY_VALUE);
      response.headers.set("Content-Security-Policy", buildSpaHtmlCsp(url));
      return response;
    }
    if (isImmutableBuildAssetPath(url.pathname)) {
      const immutableResponse = new Response(assetResponse.body, assetResponse);
      immutableResponse.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      immutableResponse.headers.set("X-Content-Type-Options", X_CONTENT_TYPE_VALUE);
      immutableResponse.headers.set("Strict-Transport-Security", HSTS_VALUE);
      immutableResponse.headers.set("Referrer-Policy", REFERRER_POLICY_VALUE);
      return immutableResponse;
    }
    const genericResponse = new Response(assetResponse.body, assetResponse);
    genericResponse.headers.set("X-Content-Type-Options", X_CONTENT_TYPE_VALUE);
    genericResponse.headers.set("Strict-Transport-Security", HSTS_VALUE);
    genericResponse.headers.set("Referrer-Policy", REFERRER_POLICY_VALUE);
    return genericResponse;
  },
  scheduled: async (event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => {
    const tasks: Promise<void>[] = [];

    switch (event.cron) {
      case "0 0 * * *":
        tasks.push(runDailyMaintenanceCron(env, event.cron));
        break;
      case "*/15 * * * *":
        tasks.push(runQuarterHourlyMaintenanceCron(env, event.cron));
        tasks.push((async () => {
          try {
            const deleted = await new MediaService(env.DB, env.MEDIA).deleteUnclaimed(new Date().toISOString());
            logger.info("Unclaimed media cleanup completed", { source: "cron", deleted });
          } catch (error) {
            logger.error("Unclaimed media cleanup failed", {
              source: "cron",
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
            throw error;
          }
        })());
        break;
    }

    ctx.waitUntil(Promise.all(tasks));
  },
};

export { app, WebSocketDO };
