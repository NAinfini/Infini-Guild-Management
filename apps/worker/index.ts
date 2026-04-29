import { Hono } from "hono";
import { cors } from "hono/cors";
import { runAnnouncementPublishCron, runAnnouncementExpiryCron } from "./crons/announcement-publish";
import { runAuditArchiveCron } from "./crons/audit-archive";
import { runBotReminderCron } from "./crons/bot-reminder";
import { runEventAutoArchiveCron } from "./crons/event-auto-archive";
import { runEventInstanceGenerationCron } from "./crons/event-instance-gen";
import { runMediaOrphanCleanupCron } from "./crons/media-orphan-cleanup";
import { WebSocketDO } from "./durable-objects/WebSocketDO";
import { etagMiddleware } from "./middleware/etag";
import { handleAppError } from "./middleware/error-handler";
import { hmacMiddleware } from "./middleware/hmac";
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
import { internalBotRoutes } from "./routes/internal-bot";
import { usersRoutes } from "./routes/users";
import { wikiRoutes } from "./routes/wiki";

export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  WS: DurableObjectNamespace;
  BOT_RUNTIME_URL?: string;
  BOT_SHARED_SECRET?: string;
  PORTAL_ORIGIN?: string;
  ENVIRONMENT?: string;
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
  maxRequests: 30,
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
      if (!allowedOrigin || origin !== allowedOrigin) return "";
      return origin;
    },
    allowHeaders: ["Content-Type", "If-None-Match", "If-Match", "X-Signature", "X-Timestamp", "X-Request-Id", "X-Requested-With"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.use("*", securityHeadersMiddleware);

app.use("/api/*", async (c, next) => {
  const portalOrigin = c.env.PORTAL_ORIGIN;
  if (isMutationMethod(c.req.method)) {
    if (!portalOrigin) {
      return c.json({ error_code: "FORBIDDEN", message: "Server misconfigured: PORTAL_ORIGIN not set", request_id: c.get("requestId") }, 403);
    }
    const origin = c.req.header("Origin");
    if (origin && origin !== portalOrigin) {
      return c.json({ error_code: "FORBIDDEN", message: "Origin not allowed", request_id: c.get("requestId") }, 403);
    }
    if (!c.req.header("X-Requested-With")) {
      return c.json({ error_code: "FORBIDDEN", message: "Missing required header", request_id: c.get("requestId") }, 403);
    }
  }
  await next();
});

app.onError((error, c) => handleAppError(error, c));

app.use("/api/*", etagMiddleware);
app.use("/api/auth/login", authRateLimit);
app.use("/api/auth/register/*", authRateLimit);
app.use("/api/auth/check-username", checkUsernameRateLimit);
app.use("/api/users", async (c, next) => {
  if (c.req.method === "GET") {
    await readRateLimit(c, next);
    return;
  }
  await next();
});
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

  await next();
});
app.use("/internal/bot/*", hmacMiddleware);

app.get("/api/health", (c) => c.json({ ok: true, request_id: c.get("requestId") }));
app.post("/api/dev/seed", async (c) => {
  const env = c.env as Bindings;
  if (env.ENVIRONMENT !== "development") {
    return c.json({ error_code: "NOT_FOUND", message: "Not found", request_id: c.get("requestId") }, 404);
  }
  const session = await resolveSession(c);
  if (!session || !session.user.permissions.has("admin.roles.manage")) {
    return c.json({ error_code: "FORBIDDEN", message: "Requires admin permissions", request_id: c.get("requestId") }, 403);
  }
  const { seedDatabase } = await import("./db/seed");
  await seedDatabase(c.env);
  return c.json({ ok: true, message: "Database seeded" });
});
app.post("/api/dev/reseed", async (c) => {
  const env = c.env as Bindings;
  if (env.ENVIRONMENT !== "development") {
    return c.json({ error_code: "NOT_FOUND", message: "Not found", request_id: c.get("requestId") }, 404);
  }
  const session = await resolveSession(c);
  if (!session || !session.user.permissions.has("admin.roles.manage")) {
    return c.json({ error_code: "FORBIDDEN", message: "Requires admin permissions", request_id: c.get("requestId") }, 403);
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
app.route("/internal/bot", internalBotRoutes);

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => {
    const safe = (fn: () => Promise<void>, name: string) =>
      fn().catch((e) => console.error(`[cron] ${name} failed`, e));
    const tasks: Promise<void>[] = [];

    if (event.cron === "0 0 * * *") {
      tasks.push(safe(() => runEventInstanceGenerationCron(env), "event-instance-gen"));
    }

    if (event.cron === "*/15 * * * *") {
      tasks.push(safe(() => runAnnouncementPublishCron(env), "announcement-publish"));
      tasks.push(safe(() => runAnnouncementExpiryCron(env), "announcement-expiry"));
      tasks.push(safe(() => runBotReminderCron(env), "bot-reminder"));
      tasks.push(safe(() => runEventAutoArchiveCron(env), "event-auto-archive"));
    }

    if (event.cron === "0 2 * * *") {
      tasks.push(safe(() => runAuditArchiveCron(env), "audit-archive"));
    }

    if (event.cron === "0 3 * * *") {
      tasks.push(safe(() => runMediaOrphanCleanupCron(env), "media-orphan-cleanup"));
    }

    ctx.waitUntil(Promise.all(tasks));
  },
};

export { WebSocketDO };
