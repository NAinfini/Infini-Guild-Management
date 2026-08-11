import { createApplication } from "@guild/application";
import { createAuthorizationContext, type RateLimitDecision } from "@guild/kernel";
import type { SqlExecutor } from "@guild/kernel";
import { DatabaseSync } from "node:sqlite";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";
import { describe, expect, it, vi } from "vitest";
import type { VpsNotificationWebSocketHub } from "./notification-websocket-hub.js";
import { readVpsRuntimeConfig } from "./config.js";
import {
  createVpsServerRuntime,
  type VpsServerRuntimeDependencies,
  type VpsRuntimeTimings,
} from "./server-runtime.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const PUBLIC_URL = "https://guild.example";
const RUNTIME_CONFIG = readVpsRuntimeConfig({
  IG_PUBLIC_URL: PUBLIC_URL,
  IG_INVITE_TOKEN_SECRET: SECRET,
  IG_AUDIT_DOWNLOAD_SECRET: SECRET,
}, "C:/vps-runtime-test");

const AUTHENTICATED = createAuthorizationContext({
  userId: "user-1",
  sessionId: "session-1",
  roleId: "member",
  roleLevel: 100,
  permissions: [],
});
const ANONYMOUS = createAuthorizationContext(null);

type FixtureOptions = Readonly<{
  apiFetch?: (request: Request) => Promise<Response>;
  staticFetch?: (request: Request) => Promise<Response | null>;
  httpClose?: (callback: (error?: Error) => void) => void;
  timings?: Partial<VpsRuntimeTimings>;
}>;

function fixture(options: FixtureOptions = {}) {
  const events: string[] = [];
  const databaseClose = vi.fn(() => events.push("database"));
  const database = { close: databaseClose } as unknown as DatabaseSync;
  const sql = {} as SqlExecutor;
  const deferredDrain = vi.fn(async () => {
    events.push("deferred");
  });
  const deferred = { defer: vi.fn(), drain: deferredDrain };
  const scheduler = {
    start: vi.fn(() => events.push("scheduler-start")),
    stop: vi.fn(async () => {
      events.push("scheduler-stop");
    }),
  };
  const prepareConnection = vi.fn(async () => {
    events.push("hub-prepare");
    return { accepted: true as const, claim: { id: "claim-1" } };
  });
  const cancelConnection = vi.fn();
  const hub = {
    connectionCount: 0,
    start: vi.fn(() => events.push("hub-start")),
    stop: vi.fn(async () => {
      events.push("hub-stop");
    }),
    prepareConnection,
    attach: vi.fn(() => true),
    cancelConnection,
    receive: vi.fn(),
    disconnect: vi.fn(),
    publish: vi.fn(async () => undefined),
  } as unknown as VpsNotificationWebSocketHub;
  const webSockets = {
    handleUpgrade: vi.fn(() => events.push("ws-upgrade")),
    emit: vi.fn(),
    clients: new Set(),
  } as unknown as WebSocketServer;
  const httpClose = vi.fn((callback: (error?: Error) => void) => {
    events.push("http-close");
    if (options.httpClose) options.httpClose(callback);
    else callback();
  });
  const closeAllConnections = vi.fn(() => events.push("http-force-close"));
  const server = {
    on: vi.fn().mockReturnThis(),
    close: httpClose,
    closeAllConnections,
  } as unknown as Server;
  const handshakeConsume = vi.fn(async (): Promise<RateLimitDecision> => {
    events.push("ws-rate");
    return { allowed: true };
  });
  const resolveAuthorization = vi.fn(async () => {
    events.push("ws-auth");
    return { authorization: ANONYMOUS, session: null };
  });
  const apiFetch = vi.fn(options.apiFetch ?? (async (request: Request) => Response.json({
    url: request.url,
  })));
  const staticFetch = vi.fn(options.staticFetch ?? (async (request: Request) => new Response(
    `static:${new URL(request.url).pathname}`,
  )));
  let clientIdentifier: ((request: Request) => string) | undefined;
  const application = {
    api: {
      fetch: async (request: Request) => {
        const response = await apiFetch(request);
        response.headers.set("x-test-client", clientIdentifier?.(request) ?? "missing");
        return response;
      },
    },
    services: {
      auth: { resolveAuthorization },
      scheduledJobs: {},
      siteConfig: {
        getPublic: vi.fn(async () => ({
          site_name: "Guild",
          site_logo_media_id: null,
          default_site_logo_url: "/logo.svg",
        })),
      },
    },
  } as unknown as ReturnType<typeof createApplication>;

  const assertSchema = vi.fn(async (_sql: SqlExecutor, _signal: AbortSignal): Promise<void> => undefined);
  const createHttpServer = vi.fn(() => server);
  const dependencies: Partial<VpsServerRuntimeDependencies> = {
    prepareFilesystem: vi.fn(),
    openDatabase: vi.fn(() => database),
    configureDatabase: vi.fn(),
    createSql: vi.fn(() => sql),
    assertSchema,
    createBlobStore: vi.fn(() => ({} as never)),
    createDeferred: vi.fn(() => deferred),
    createRateLimiter: vi.fn(() => ({ consume: handshakeConsume })),
    createHub: vi.fn(() => hub),
    createApplication: vi.fn((input) => {
      clientIdentifier = input.clientIdentifier;
      return application;
    }) as unknown as typeof createApplication,
    createStaticFiles: vi.fn(() => staticFetch),
    createScheduler: vi.fn(() => scheduler as never),
    createWebSocketServer: vi.fn(() => webSockets),
    createHttpServer,
    stopWebSocketServer: vi.fn(async () => {
      events.push("ws-stop");
    }),
    forceCloseWebSockets: vi.fn(() => events.push("ws-force-close")),
    resolveClientAddress: vi.fn(() => "203.0.113.8"),
    nowIso: vi.fn(() => "2026-08-09T00:00:00.000Z"),
    info: vi.fn(),
    error: vi.fn(),
  };
  const runtime = createVpsServerRuntime(RUNTIME_CONFIG, {
    dependencies,
    timings: options.timings,
  });
  return {
    runtime,
    events,
    dependencies,
    databaseClose,
    deferredDrain,
    scheduler,
    hub,
    prepareConnection,
    cancelConnection,
    webSockets,
    server,
    httpClose,
    closeAllConnections,
    handshakeConsume,
    resolveAuthorization,
    apiFetch,
    staticFetch,
    assertSchema,
    createHttpServer,
  };
}

function incoming(url = "/", origin?: string) {
  return {
    url,
    headers: {
      ...(origin ? { origin } : {}),
      cookie: "ig_session=session-token",
    },
    socket: { remoteAddress: "203.0.113.8" },
  } as unknown as import("node:http").IncomingMessage;
}

function upgradeSocket() {
  const end = vi.fn();
  return {
    socket: { destroyed: false, end } as unknown as Duplex,
    end,
  };
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Expected runtime operation did not complete");
}

describe("VPS server composition root", () => {
  it("has no construction side effects and rejects an unmigrated SQLite database", async () => {
    const database = new DatabaseSync(":memory:");
    const openDatabase = vi.fn(() => database);
    const runtime = createVpsServerRuntime(RUNTIME_CONFIG, {
      dependencies: {
        prepareFilesystem: vi.fn(),
        openDatabase,
        configureDatabase: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(openDatabase).not.toHaveBeenCalled();
    await expect(runtime.start()).rejects.toThrow(/schema|migration|initialized/i);
    expect(runtime.state).toBe("stopped");
    expect(() => database.exec("SELECT 1")).toThrow();
  });

  it("aborts a blocked startup without activating services or closing an in-use database", async () => {
    const value = fixture({
      timings: {
        startTimeoutMs: 100,
        phaseTimeoutMs: 5,
        httpGraceMs: 5,
        forcedRequestWaitMs: 5,
        deferredDrainMs: 5,
      },
    });
    value.assertSchema.mockImplementationOnce(async () => new Promise<void>(() => undefined));
    const starting = value.runtime.start();
    await flushUntil(() => value.assertSchema.mock.calls.length === 1);

    const stopping = value.runtime.stop();
    const [startError, stopError] = await Promise.all([
      starting.catch((error: unknown) => error),
      stopping.catch((error: unknown) => error),
    ]);

    expect(startError).toBeInstanceOf(AggregateError);
    expect(stopError).toBe(startError);
    expect(value.runtime.state).toBe("stopping");
    expect(value.hub.start).not.toHaveBeenCalled();
    expect(value.scheduler.start).not.toHaveBeenCalled();
    expect(value.createHttpServer).not.toHaveBeenCalled();
    expect(value.databaseClose).not.toHaveBeenCalled();
  });

  it("forwards shared API routes and non-API routes to the static fallback", async () => {
    const value = fixture();
    await value.runtime.start();

    const apiResponse = await value.runtime.handleHttp(
      new Request("http://internal/api/site-config"),
      incoming("/api/site-config"),
    );
    expect(await apiResponse.json()).toEqual({ url: `${PUBLIC_URL}/api/site-config` });
    expect(apiResponse.headers.get("x-test-client")).toBe("203.0.113.8");
    expect(value.staticFetch).not.toHaveBeenCalled();

    const staticResponse = await value.runtime.handleHttp(
      new Request("http://internal/guild/members"),
      incoming("/guild/members"),
    );
    expect(await staticResponse.text()).toBe("static:/guild/members");
    expect(value.apiFetch).toHaveBeenCalledOnce();
    await value.runtime.stop();
  });

  it("checks WebSocket origin, rate limit, and authentication before upgrade", async () => {
    const value = fixture();
    await value.runtime.start();

    const missingOrigin = upgradeSocket();
    await value.runtime.handleUpgrade(incoming("/ws"), missingOrigin.socket, Buffer.alloc(0));
    expect(missingOrigin.end).toHaveBeenCalledWith(expect.stringContaining("403 Forbidden WebSocket origin"));
    expect(value.handshakeConsume).not.toHaveBeenCalled();

    value.handshakeConsume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 7 });
    const limited = upgradeSocket();
    await value.runtime.handleUpgrade(incoming("/ws", PUBLIC_URL), limited.socket, Buffer.alloc(0));
    expect(limited.end).toHaveBeenCalledWith(expect.stringContaining("429 Too many WebSocket handshakes"));
    expect(value.resolveAuthorization).not.toHaveBeenCalled();

    const anonymous = upgradeSocket();
    await value.runtime.handleUpgrade(incoming("/ws", PUBLIC_URL), anonymous.socket, Buffer.alloc(0));
    expect(anonymous.end).toHaveBeenCalledWith(expect.stringContaining("401 Authentication required"));
    expect(value.webSockets.handleUpgrade).not.toHaveBeenCalled();

    value.resolveAuthorization.mockImplementationOnce(async () => {
      value.events.push("ws-auth");
      return { authorization: AUTHENTICATED, session: null };
    });
    const acceptedEventsStart = value.events.length;
    const accepted = upgradeSocket();
    await value.runtime.handleUpgrade(incoming("/ws", PUBLIC_URL), accepted.socket, Buffer.alloc(0));
    expect(value.webSockets.handleUpgrade).toHaveBeenCalledOnce();
    expect(value.events.slice(acceptedEventsStart)).toEqual([
      "ws-rate",
      "ws-auth",
      "hub-prepare",
      "ws-upgrade",
    ]);
    await value.runtime.stop();
  });

  it("cancels a paused WebSocket handshake before 101 when shutdown starts", async () => {
    let releasePreparation!: (value: Readonly<{
      accepted: true;
      claim: Readonly<{ id: string }>;
    }>) => void;
    const preparation = new Promise<Readonly<{
      accepted: true;
      claim: Readonly<{ id: string }>;
    }>>((resolve) => {
      releasePreparation = resolve;
    });
    const value = fixture();
    value.resolveAuthorization.mockImplementationOnce(async () => ({
      authorization: AUTHENTICATED,
      session: null,
    }));
    value.prepareConnection.mockImplementationOnce(async () => preparation);
    await value.runtime.start();
    const socket = upgradeSocket();
    const upgrading = value.runtime.handleUpgrade(
      incoming("/ws", PUBLIC_URL),
      socket.socket,
      Buffer.alloc(0),
    );
    await flushUntil(() => value.prepareConnection.mock.calls.length === 1);

    const stopping = value.runtime.stop();
    await flushUntil(() => value.events.includes("hub-stop"));
    expect(value.databaseClose).not.toHaveBeenCalled();
    releasePreparation({ accepted: true, claim: { id: "paused-claim" } });
    await upgrading;
    await stopping;

    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining("503 Server stopping"));
    expect(value.cancelConnection).toHaveBeenCalledWith({ id: "paused-claim" });
    expect(value.webSockets.handleUpgrade).not.toHaveBeenCalled();
    expect(value.databaseClose).toHaveBeenCalledOnce();
  });

  it("stops scheduler, WebSockets, HTTP, deferred work, and SQLite in order", async () => {
    let completeRequest!: (response: Response) => void;
    const requestResult = new Promise<Response>((resolve) => {
      completeRequest = resolve;
    });
    const value = fixture({ apiFetch: async () => requestResult });
    await value.runtime.start();
    const inFlight = value.runtime.handleHttp(new Request("http://internal/api/status"), incoming("/api/status"));

    const stopping = value.runtime.stop();
    expect(value.runtime.state).toBe("stopping");
    expect((await value.runtime.handleHttp(new Request("http://internal/api/new"), incoming("/api/new"))).status)
      .toBe(503);
    const rejectedUpgrade = upgradeSocket();
    await value.runtime.handleUpgrade(incoming("/ws", PUBLIC_URL), rejectedUpgrade.socket, Buffer.alloc(0));
    expect(rejectedUpgrade.end).toHaveBeenCalledWith(expect.stringContaining("503 Server stopping"));

    await flushUntil(() => value.events.includes("http-close"));
    expect(value.events).not.toContain("deferred");
    expect(value.events).not.toContain("database");
    completeRequest(new Response("done"));
    expect(await (await inFlight).text()).toBe("done");
    await stopping;

    expect(value.events.slice(2)).toEqual([
      "scheduler-stop",
      "hub-stop",
      "ws-stop",
      "http-close",
      "deferred",
      "database",
    ]);
    await value.runtime.stop();
    expect(value.scheduler.stop).toHaveBeenCalledOnce();
    expect(value.hub.stop).toHaveBeenCalledOnce();
    expect(value.databaseClose).toHaveBeenCalledOnce();
  });

  it("forces lingering HTTP connections but keeps SQLite open when quiescence times out", async () => {
    const requestResult = new Promise<Response>(() => undefined);
    const value = fixture({
      apiFetch: async () => requestResult,
      httpClose: () => undefined,
      timings: {
        phaseTimeoutMs: 5,
        httpGraceMs: 5,
        forcedRequestWaitMs: 5,
        deferredDrainMs: 5,
      },
    });
    await value.runtime.start();
    void value.runtime.handleHttp(new Request("http://internal/api/slow"), incoming("/api/slow"));

    await expect(value.runtime.stop()).rejects.toThrow(/quiescent/);

    expect(value.closeAllConnections).toHaveBeenCalledOnce();
    expect(value.events.indexOf("http-force-close")).toBeLessThan(value.events.indexOf("deferred"));
    expect(value.databaseClose).not.toHaveBeenCalled();
    expect(value.runtime.state).toBe("stopping");
  });
});
