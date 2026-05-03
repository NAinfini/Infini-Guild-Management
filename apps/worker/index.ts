import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { users } from "./db/schema/auth";
import { runAnnouncementPublishCron, runAnnouncementExpiryCron } from "./crons/announcement-publish";
import { runAuditArchiveCron } from "./crons/audit-archive";
import { runEventAutoArchiveCron } from "./crons/event-auto-archive";
import { runEventInstanceGenerationCron } from "./crons/event-instance-gen";
import { runMediaOrphanCleanupCron } from "./crons/media-orphan-cleanup";
import { runSessionCleanupCron } from "./crons/session-cleanup";
import { WebSocketDO } from "./durable-objects/WebSocketDO";
import { etagMiddleware } from "./middleware/etag";
import { handleAppError } from "./middleware/error-handler";
import { createRateLimitMiddleware } from "./middleware/rate-limit";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import { sessionMiddleware } from "./middleware/session";
import { resolveSession, type SessionUser } from "./services/auth";
import { adminRoutes } from "./routes/admin";
import { announcementsRoutes } from "./routes/announcements";
import { authRoutes } from "./routes/auth";
import { eventsRoutes } from "./routes/events";
import { galleryRoutes } from "./routes/gallery";
import { guildWarRoutes } from "./routes/guild-war";
import { usersRoutes } from "./routes/users";
import { wikiRoutes } from "./routes/wiki";

export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  WS: DurableObjectNamespace;
  ASSETS: Fetcher;
  PORTAL_ORIGIN?: string;
  ENVIRONMENT?: string;
  SIGNING_SECRET?: string;
  SITE_NAME?: string;
  SITE_LOGO_URL?: string;
};

type Variables = {
  requestId: string;
  user: SessionUser | null;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const authRateLimit = createRateLimitMiddleware({
  keyPrefix: "auth",
  maxRequests: 5,
  windowMs: 60_000,
});
const checkUsernameRateLimit = createRateLimitMiddleware({
  keyPrefix: "auth-check",
  maxRequests: 15,
  windowMs: 60_000,
});
const mutationRateLimit = createRateLimitMiddleware({
  keyPrefix: "mutation",
  maxRequests: 80,
  windowMs: 60_000,
});
const uploadRateLimit = createRateLimitMiddleware({
  keyPrefix: "upload",
  maxRequests: 20,
  windowMs: 60_000,
});
const credentialChangeRateLimit = createRateLimitMiddleware({
  keyPrefix: "cred-change",
  maxRequests: 5,
  windowMs: 60_000,
});
const readRateLimit = createRateLimitMiddleware({
  keyPrefix: "read",
  maxRequests: 120,
  windowMs: 60_000,
});

function isMutationMethod(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE";
}

function isCredentialChangePath(path: string): boolean {
  return path.endsWith("/change-password") || path.endsWith("/change-username");
}

function isUploadPath(path: string): boolean {
  if (path.includes("/announcements/") && path.endsWith("/images")) {
    return true;
  }
  if (path.includes("/events/") && path.endsWith("/images")) {
    return true;
  }
  if (path.includes("/wiki/articles/") && path.endsWith("/images")) {
    return true;
  }
  return (
    path.includes("/media/images") ||
    path.includes("/media/audio") ||
    path.includes("/gallery/images")
  );
}

app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  await next();
  c.header("X-Request-Id", c.get("requestId"));
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
  }),
);

app.use("*", securityHeadersMiddleware);

app.use("/api/*", async (c, next) => {
  if (isMutationMethod(c.req.method)) {
    const origin = c.req.header("Origin");
    if (!origin) {
      return c.json({ error_code: "FORBIDDEN", message: "Origin header required", request_id: c.get("requestId") }, 403);
    }
    const portalOrigin = c.env.PORTAL_ORIGIN;
    const selfOrigin = new URL(c.req.url).origin;
    if (origin !== selfOrigin && (!portalOrigin || origin !== portalOrigin)) {
      return c.json({ error_code: "FORBIDDEN", message: "Origin not allowed", request_id: c.get("requestId") }, 403);
    }
    if (!c.req.header("X-Requested-With")) {
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
      return c.json({ ok: false, db: "unhealthy", request_id: c.get("requestId") }, 503);
    }
  } catch {
    return c.json({ ok: false, db: "unreachable", request_id: c.get("requestId") }, 503);
  }
  return c.json({ ok: true, request_id: c.get("requestId") });
});

app.get("/api/site-config", (c) => {
  const env = c.env as Bindings;
  return c.json({
    site_name: env.SITE_NAME || "Guild Portal",
    site_logo_url: env.SITE_LOGO_URL || null,
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
  const env = c.env as Bindings;
  const db = drizzle(env.DB);
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const isEmpty = row.count === 0;
  if (!isEmpty) {
    const session = await resolveSession(c);
    if (!session || !session.user.permissions.has("admin.roles.manage")) {
      return c.json({ error_code: "FORBIDDEN", message: "Requires admin permissions", request_id: c.get("requestId") }, 403);
    }
  }
  const { seedDatabase } = await import("./db/seed");
  await seedDatabase(c.env);
  return c.json({ ok: true, message: "Database seeded" });
});
app.post("/api/dev/reseed", async (c) => {
  const blocked = rejectNonDev(c);
  if (blocked) return blocked;
  const env = c.env as Bindings;
  const db = drizzle(env.DB);
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const isEmpty = row.count === 0;
  if (!isEmpty) {
    const session = await resolveSession(c);
    if (!session || !session.user.permissions.has("admin.roles.manage")) {
      return c.json({ error_code: "FORBIDDEN", message: "Requires admin permissions", request_id: c.get("requestId") }, 403);
    }
  }
  const { clearAllData, seedDatabase } = await import("./db/seed");
  await clearAllData(c.env);
  await seedDatabase(c.env);
  return c.json({ ok: true, message: "Database cleared and reseeded" });
});
app.get("/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected websocket", 426);
  }

  const session = await resolveSession(c);
  if (!session) {
    return c.json({ error_code: "UNAUTHORIZED", message: "Authentication required", request_id: c.get("requestId") }, 401);
  }

  const objectId = c.env.WS.idFromName("global");
  const stub = c.env.WS.get(objectId);
  return stub.fetch(c.req.raw);
});

app.route("/api/auth", authRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/events", eventsRoutes);
app.route("/api/announcements", announcementsRoutes);
app.route("/api/guild-war", guildWarRoutes);
app.route("/api/wiki", wikiRoutes);
app.route("/api/gallery", galleryRoutes);
app.route("/api/admin", adminRoutes);

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
  scheduled: async (event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => {
    const safe = async (fn: () => Promise<void>, name: string): Promise<void> => {
      const start = Date.now();
      try {
        await fn();
        console.log(`[cron] ${name} completed in ${Date.now() - start}ms`);
      } catch (e) {
        const elapsed = Date.now() - start;
        const message = e instanceof Error ? e.message : String(e);
        const stack = e instanceof Error ? e.stack : undefined;
        console.error(JSON.stringify({
          level: "error",
          source: "cron",
          job: name,
          cron: event.cron,
          elapsed_ms: elapsed,
          error: message,
          stack,
          timestamp: new Date().toISOString(),
        }));
      }
    };
    const tasks: Promise<void>[] = [];

    switch (event.cron) {
      case "0 0 * * *":
        tasks.push(safe(() => runEventInstanceGenerationCron(env), "event-instance-gen"));
        tasks.push(safe(() => runSessionCleanupCron(env), "session-cleanup"));
        break;
      case "*/15 * * * *":
        tasks.push(safe(() => runEventAutoArchiveCron(env), "event-auto-archive"));
        tasks.push(safe(() => runAnnouncementPublishCron(env), "announcement-publish"));
        tasks.push(safe(() => runAnnouncementExpiryCron(env), "announcement-expiry"));
        break;
      case "0 2 * * *":
        tasks.push(safe(() => runAuditArchiveCron(env), "audit-archive"));
        break;
      case "0 3 * * *":
        tasks.push(safe(() => runMediaOrphanCleanupCron(env), "media-orphan-cleanup"));
        break;
    }

    ctx.waitUntil(Promise.all(tasks));
  },
};

export { WebSocketDO };
