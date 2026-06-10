import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { LIMITS } from "@guild/shared/config/limits";
import { DEFAULT_FEATURE_FLAGS, featureFlagsSchema, type FeatureFlags } from "@guild/shared/config/features";
import { logger } from "./utils/logger";
import { runDailyMaintenanceCron, runQuarterHourlyMaintenanceCron } from "./crons/maintenance";
import { WebSocketDO } from "./durable-objects/WebSocketDO";
import { etagMiddleware } from "./middleware/etag";
import { handleAppError } from "./middleware/error-handler";
import { createRateLimitMiddleware } from "./middleware/rate-limit";
import { buildSpaHtmlCsp, HSTS_VALUE, REFERRER_POLICY_VALUE, securityHeadersMiddleware, X_CONTENT_TYPE_VALUE } from "./middleware/security-headers";
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
import { usersRoutes } from "./routes/users";
import { wikiRoutes } from "./routes/wiki";
import { badgeRoutes } from "./routes/badges";
import { gameDataRoutes } from "./routes/game-data";

export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  WS: DurableObjectNamespace;
  ASSETS: Fetcher;
  PORTAL_ORIGIN?: string;
  ENVIRONMENT?: string;
  SIGNING_SECRET: string;
  SITE_NAME: string;
  SITE_LOGO_URL: string;
  FEATURES?: string;
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
    path.includes("/media/images") ||
    path.includes("/media/audio") ||
    path.includes("/gallery/images") ||
    (path.endsWith("/images") && (path.includes("/announcements/") || path.includes("/events/") || path.includes("/wiki/articles/"))) ||
    (path.endsWith("/icons") && path.includes("/game-data/"))
  );
}

app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  await next();
  c.header("X-Request-Id", c.get("requestId"));
});

app.use("*", async (c, next) => {
  const env = c.env as Bindings;
  if (env.ENVIRONMENT !== "development") {
    const missing = ["SIGNING_SECRET", "SITE_NAME", "SITE_LOGO_URL"].filter(k => !env[k as keyof Bindings]);
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
    allowHeaders: ["Content-Type", "If-None-Match", "If-Match", "X-Signature", "X-Timestamp", "X-Request-Id", "X-Requested-With"],
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

app.get("/api/site-config", (c) => {
  const env = c.env as Bindings;
  const features: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS };
  if (env.FEATURES) {
    try {
      const parsed = JSON.parse(env.FEATURES);
      const validKeys = new Set(Object.keys(DEFAULT_FEATURE_FLAGS));
      const unknownKeys = Object.keys(parsed as object).filter((k) => !validKeys.has(k));
      if (unknownKeys.length > 0) {
        logger.error("FEATURES env var contains unknown keys — they will be ignored. Fix the FEATURES environment variable.", { unknownKeys, featuresRaw: env.FEATURES });
      }
      const validation = featureFlagsSchema.partial().safeParse(parsed);
      if (!validation.success) {
        logger.error("FEATURES env var contains invalid types — invalid fields will be ignored. Fix the FEATURES environment variable.", { issues: validation.error.issues, featuresRaw: env.FEATURES });
      }
      const overrides = (validation.success ? validation.data : parsed) as Partial<FeatureFlags>;
      for (const key of Object.keys(features) as (keyof FeatureFlags)[]) {
        if (typeof overrides[key] === "boolean") features[key] = overrides[key];
      }
    } catch (e) { logger.error("Malformed FEATURES var — ignoring overrides, using defaults. Fix the FEATURES environment variable.", { error: String(e), featuresRaw: env.FEATURES }); }
  }
  return c.json({
    site_name: env.SITE_NAME,
    site_logo_url: env.SITE_LOGO_URL,
    features,
  });
});

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

  if (c.req.method === "GET") {
    await readRateLimit(c, next);
    return;
  }

  await next();
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
  await clearAllData(c.env);
  await seedDatabase(c.env);
  return c.json({ ok: true, message: "Database cleared and reseeded" });
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
  return stub.fetch(c.req.raw);
});

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
app.route("/api/game-data", gameDataRoutes);
app.route("/api/admin", adminRoutes);

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
      return app.fetch(request, env, ctx);
    }
    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get("content-type") ?? "";
    const selfHost = url.host;
    if (contentType.includes("text/html")) {
      let html = await assetResponse.text();
      html = html.replaceAll("{{SITE_NAME}}", env.SITE_NAME);
      html = html.replaceAll("{{SITE_LOGO_URL}}", env.SITE_LOGO_URL);
      const response = new Response(html, assetResponse);
      response.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
      response.headers.set("X-Content-Type-Options", X_CONTENT_TYPE_VALUE);
      response.headers.set("X-Frame-Options", "DENY");
      response.headers.set("Strict-Transport-Security", HSTS_VALUE);
      response.headers.set("Referrer-Policy", REFERRER_POLICY_VALUE);
      response.headers.set("Content-Security-Policy", buildSpaHtmlCsp(selfHost));
      return response;
    }
    const filename = url.pathname.split("/").pop() ?? "";
    if (/\.[0-9a-f]{8,}\.[a-z0-9]+$/i.test(filename)) {
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
        break;
    }

    ctx.waitUntil(Promise.all(tasks));
  },
};

export { app, WebSocketDO };
