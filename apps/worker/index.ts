import { Hono } from "hono";
import { cors } from "hono/cors";
import { runAnnouncementPublishCron } from "./crons/announcement-publish";
import { runAuditArchiveCron } from "./crons/audit-archive";
import { runBotReminderCron } from "./crons/bot-reminder";
import { runEventAutoArchiveCron } from "./crons/event-auto-archive";
import { runEventInstanceGenerationCron } from "./crons/event-instance-gen";
import { runMediaOrphanCleanupCron } from "./crons/media-orphan-cleanup";
import { clearAllData, seedDatabase } from "./db/seed";
import { WebSocketDO } from "./durable-objects/WebSocketDO";
import { etagMiddleware } from "./middleware/etag";
import { handleAppError } from "./middleware/error-handler";
import { hmacMiddleware } from "./middleware/hmac";
import { createRateLimitMiddleware } from "./middleware/rate-limit";
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
};

type Variables = {
  requestId: string;
  user: { id: string; role: "admin" | "moderator" | "member" } | null;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const authRateLimit = createRateLimitMiddleware({
  keyPrefix: "auth",
  maxRequests: 5,
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

function isMutationMethod(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE";
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
      if (!allowedOrigin) return origin;
      return origin === allowedOrigin ? origin : "";
    },
    allowHeaders: ["Content-Type", "If-None-Match", "If-Match", "X-Signature", "X-Timestamp", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.onError((error, c) => handleAppError(error, c));

app.use("/api/*", etagMiddleware);
app.use("/api/auth/login", authRateLimit);
app.use("/api/auth/register/*", authRateLimit);
app.use("/api/*", async (c, next) => {
  if (c.req.method === "POST" && isUploadPath(c.req.path)) {
    await uploadRateLimit(c, next);
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
  await seedDatabase(c.env);
  return c.json({ ok: true, message: "Database seeded" });
});
app.post("/api/dev/reseed", async (c) => {
  await clearAllData(c.env);
  await seedDatabase(c.env);
  return c.json({ ok: true, message: "Database cleared and reseeded" });
});
app.get("/ws", (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected websocket", 426);
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
    const tasks: Promise<void>[] = [];

    if (event.cron === "0 0 * * *") {
      tasks.push(runEventInstanceGenerationCron(env));
    }

    if (event.cron === "*/15 * * * *") {
      tasks.push(runAnnouncementPublishCron(env));
      tasks.push(runBotReminderCron(env));
      tasks.push(runEventAutoArchiveCron(env));
    }

    if (event.cron === "0 2 * * *") {
      tasks.push(runAuditArchiveCron(env));
    }

    if (event.cron === "0 3 * * *") {
      tasks.push(runMediaOrphanCleanupCron(env));
    }

    ctx.waitUntil(Promise.all(tasks));
  },
};

export { WebSocketDO };
