import { APPLICATION_MIGRATIONS } from "@guild/application";
import { createAuthorizationContext } from "@guild/kernel";
import { INTERNAL_NOTIFICATION_SESSION_HEADER } from "@guild/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCloudflareHandler,
  type CloudflareComposition,
  type CloudflareEnvironment,
} from "./root-handler.js";
import { CLOUDFLARE_SCHEDULED_CRONS } from "./scheduled-dispatcher.js";

type SchemaState = "missing" | "ok" | "wrong";

function executionContext(): { context: ExecutionContext; pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return {
    context: {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    } as unknown as ExecutionContext,
    pending,
  };
}

function fixture(options: Readonly<{
  authenticated?: boolean;
  schema?: SchemaState;
  websocketAllowed?: boolean;
}> = {}) {
  const authorization = options.authenticated
    ? createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 1,
      permissions: [],
    })
    : createAuthorizationContext(null);
  const execute = vi.fn(async () => {
    if (options.schema === "missing") throw new Error("no such table: app_migrations");
    return {
      rows: options.schema === "wrong"
        ? [["0000_old", 0, "0".repeat(64)]]
        : APPLICATION_MIGRATIONS.map(({ id, ordinal, checksum }) => [id, ordinal, checksum]),
    };
  });
  const sql = { execute, batch: vi.fn(async () => []) };
  const apiFetch = vi.fn(async (_request: Request) => Response.json({ source: "shared-api" }));
  const resolveAuthorization = vi.fn(async (_token: string | null, _now: string) => ({ authorization }));
  const getPublic = vi.fn(async () => ({
    site_name: "Infini Test",
    site_logo_media_id: null,
    default_site_logo_url: "/logo.svg",
  }));
  const runSchedule = vi.fn(async (_schedule: "daily" | "quarter-hourly") => []);
  const notificationFetch = vi.fn(async (_request: Request) => new Response("forwarded"));
  const composition = {
    application: {
      api: { fetch: apiFetch },
      services: {
        auth: { resolveAuthorization },
        scheduledJobs: { runSchedule },
        siteConfig: { getPublic },
      },
    },
    clientIdentifier: (request: Request) => request.headers.get("CF-Connecting-IP") ?? "127.0.0.1",
    config: {
      publicUrl: "https://guild.test",
      allowedOrigins: ["https://admin.guild.test"],
      sessionCookieName: "ig_session",
      inviteTokenSecret: "x".repeat(32),
      auditDownloadSecret: new Uint8Array(32),
      passwordIterations: 10_000,
    },
    notifications: { fetch: notificationFetch },
    sql,
  } as unknown as CloudflareComposition;
  const compose = vi.fn(() => composition);
  const assetFetch = vi.fn(async (request: Request) => {
    if (new URL(request.url).pathname === "/index.html") {
      return new Response("<title>{{SITE_NAME}}</title><img src=\"{{SITE_LOGO_URL}}\">", {
        headers: { "Content-Type": "text/html" },
      });
    }
    return new Response("missing", { status: 404, headers: { "Content-Type": "text/plain" } });
  });
  const websocketLimit = vi.fn(async () => ({ success: options.websocketAllowed !== false }));
  const environment = {
    DB: {} as D1Database,
    BLOBS: {} as R2Bucket,
    ASSETS: { fetch: assetFetch } as unknown as Fetcher,
    NOTIFICATIONS: {} as DurableObjectNamespace,
    AUTH_RATE_LIMITER: {} as RateLimit,
    READ_RATE_LIMITER: {} as RateLimit,
    MUTATION_RATE_LIMITER: {} as RateLimit,
    UPLOAD_RATE_LIMITER: {} as RateLimit,
    WEBSOCKET_RATE_LIMITER: { limit: websocketLimit } as unknown as RateLimit,
    IG_PUBLIC_URL: "https://guild.test",
    IG_INVITE_TOKEN_SECRET: "x".repeat(32),
    IG_AUDIT_DOWNLOAD_SECRET: "x".repeat(32),
  } satisfies CloudflareEnvironment;
  return {
    apiFetch,
    assetFetch,
    compose,
    environment,
    execute,
    getPublic,
    handler: createCloudflareHandler(compose),
    notificationFetch,
    resolveAuthorization,
    runSchedule,
    websocketLimit,
  };
}

function websocketRequest(origin: string): Request {
  return new Request("https://guild.test/ws", {
    headers: {
      "CF-Connecting-IP": "203.0.113.10",
      Cookie: "ig_session=session-token",
      Origin: origin,
      Upgrade: "websocket",
    },
  });
}

describe("Cloudflare root handler", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("has no composition or binding side effects until an event is handled", () => {
    const runtime = fixture();

    expect(runtime.compose).not.toHaveBeenCalled();
    expect(runtime.execute).not.toHaveBeenCalled();
    expect(runtime.assetFetch).not.toHaveBeenCalled();
  });

  it("redirects external HTTP before composition and sends HSTS over HTTPS", async () => {
    const redirected = fixture();
    const redirect = await redirected.handler.fetch(
      new Request("http://guild.test/dashboard?tab=events"),
      redirected.environment,
      executionContext().context,
    );
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("Location")).toBe("https://guild.test/dashboard?tab=events");
    expect(redirected.compose).not.toHaveBeenCalled();
    expect(redirected.execute).not.toHaveBeenCalled();

    const secured = fixture();
    const response = await secured.handler.fetch(
      new Request("https://guild.test/api/site-config"),
      secured.environment,
      executionContext().context,
    );
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  });

  it("returns the shared API 503 envelope for uninitialized and mismatched schemas", async () => {
    for (const schema of ["missing", "wrong"] as const) {
      const runtime = fixture({ schema });
      const execution = executionContext();
      const response = await runtime.handler.fetch(
        new Request("https://guild.test/api/site-config"),
        runtime.environment,
        execution.context,
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        error_code: "UPSTREAM_ERROR",
        message: "Service unavailable",
        request_id: expect.any(String),
      }));
      expect(runtime.apiFetch).not.toHaveBeenCalled();
      expect(runtime.assetFetch).not.toHaveBeenCalled();
    }
  });

  it("delegates API requests to the shared application after one schema check", async () => {
    const runtime = fixture();
    const execution = executionContext();
    const request = new Request("https://guild.test/api/site-config");
    const response = await runtime.handler.fetch(request, runtime.environment, execution.context);

    await expect(response.json()).resolves.toEqual({ source: "shared-api" });
    expect(runtime.apiFetch).toHaveBeenCalledWith(request);
    expect(runtime.compose).toHaveBeenCalledWith(runtime.environment, execution.context);
    expect(runtime.execute).toHaveBeenCalledOnce();
    expect(runtime.assetFetch).not.toHaveBeenCalled();
  });

  it("serves the branded SPA fallback through the ASSETS binding", async () => {
    const runtime = fixture();
    const execution = executionContext();
    const response = await runtime.handler.fetch(new Request("https://guild.test/dashboard", {
      headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" },
    }), runtime.environment, execution.context);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>Infini Test</title><img src=\"/logo.svg\">");
    expect(runtime.getPublic).toHaveBeenCalledOnce();
    expect(runtime.assetFetch).toHaveBeenCalledTimes(2);
    expect(runtime.apiFetch).not.toHaveBeenCalled();
  });

  it("checks WebSocket origin, rate limit, and authentication before forwarding", async () => {
    const forbidden = fixture({ authenticated: true });
    const forbiddenExecution = executionContext();
    const forbiddenResponse = await forbidden.handler.fetch(
      websocketRequest("https://evil.test"),
      forbidden.environment,
      forbiddenExecution.context,
    );
    expect(forbiddenResponse.status).toBe(403);
    expect(forbidden.websocketLimit).not.toHaveBeenCalled();
    expect(forbidden.resolveAuthorization).not.toHaveBeenCalled();

    const limited = fixture({ authenticated: true, websocketAllowed: false });
    const limitedResponse = await limited.handler.fetch(
      websocketRequest("https://guild.test"),
      limited.environment,
      executionContext().context,
    );
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("Retry-After")).toBe("60");
    expect(limited.resolveAuthorization).not.toHaveBeenCalled();

    const anonymous = fixture();
    const anonymousResponse = await anonymous.handler.fetch(
      websocketRequest("https://guild.test"),
      anonymous.environment,
      executionContext().context,
    );
    expect(anonymousResponse.status).toBe(401);
    expect(anonymous.notificationFetch).not.toHaveBeenCalled();

    const authenticated = fixture({ authenticated: true });
    const forwarded = await authenticated.handler.fetch(
      websocketRequest("https://admin.guild.test"),
      authenticated.environment,
      executionContext().context,
    );
    expect(forwarded.status).toBe(200);
    expect(authenticated.resolveAuthorization).toHaveBeenCalledWith("session-token", expect.any(String));
    const forwardedRequest = authenticated.notificationFetch.mock.calls[0]?.[0] as Request;
    expect(forwardedRequest.headers.get(INTERNAL_NOTIFICATION_SESSION_HEADER)).toBe("session-1");
  });

  it("dispatches configured schedules through ExecutionContext.waitUntil", async () => {
    const runtime = fixture();
    const execution = executionContext();
    await runtime.handler.scheduled(
      { cron: CLOUDFLARE_SCHEDULED_CRONS.daily } as ScheduledController,
      runtime.environment,
      execution.context,
    );

    await Promise.all(execution.pending);
    expect(runtime.runSchedule).toHaveBeenCalledWith("daily");
    expect(execution.pending).toHaveLength(1);
    expect(runtime.compose).toHaveBeenCalledWith(runtime.environment, execution.context);
  });
});
