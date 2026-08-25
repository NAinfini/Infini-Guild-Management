import {
  ApplicationRuntimeHealth,
  admitWebSocketHandshake,
  assertApplicationSchema,
  createApplication,
  createNotificationConnectionPolicy,
  maintenanceResponse,
  resolveStaticSiteBranding,
} from "@guild/application";
import type { BlobInventory, BlobStore, DeferredTasks, RateLimiter, SqlExecutor } from "@guild/kernel";
import { LIMITS } from "@guild/shared/config/limits";
import { serve } from "@hono/node-server";
import { mkdirSync, realpathSync } from "node:fs";
import { IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import path from "node:path";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import {
  FilesystemBlobStore,
  NodeDeferredTasks,
  NodeRateLimiter,
  NodeSqlExecutor,
} from "../adapters/public.js";
import { resolveVpsClientAddress } from "./client-address.js";
import { VpsAdminOperationsRuntime } from "./admin-operations-realtime.js";
import type { VpsRuntimeConfig } from "./config.js";
import { CloudflareRestEmailSender } from "../adapters/cloudflare-email-sender.js";
import {
  prepareAuthenticatedVpsNotificationConnection,
  VpsNotificationWebSocketHub,
  type VpsNotificationConnectionClaim,
  type VpsNotificationSocket,
} from "./notification-websocket-hub.js";
import { VpsScheduledJobScheduler } from "./scheduled-job-scheduler.js";
import { createVpsStaticFiles, type VpsStaticFilesHandler } from "./static-files.js";

type RuntimeApplication = ReturnType<typeof createApplication>;
type RuntimeState = "idle" | "starting" | "running" | "stopping" | "stopped";

export type VpsRuntimeTimings = Readonly<{
  startTimeoutMs: number;
  phaseTimeoutMs: number;
  httpGraceMs: number;
  forcedRequestWaitMs: number;
  deferredDrainMs: number;
}>;

const DEFAULT_TIMINGS: VpsRuntimeTimings = Object.freeze({
  startTimeoutMs: 30_000,
  phaseTimeoutMs: 10_000,
  httpGraceMs: 10_000,
  forcedRequestWaitMs: 1_000,
  deferredDrainMs: 10_000,
});

type HttpBoundary = (
  request: Request,
  bindings: Readonly<{ incoming: IncomingMessage }>,
) => Promise<Response>;

export type VpsHttpServerOptions = Readonly<{
  hostname: string;
  port: number;
  fetch: HttpBoundary;
  onListen(address: string, port: number): void;
}>;

export type CloseableSqlExecutor = SqlExecutor & Readonly<{
  close(): Promise<void>;
  terminate(): Promise<void>;
}>;

export type VpsServerRuntimeDependencies = Readonly<{
  prepareFilesystem(config: VpsRuntimeConfig, signal: AbortSignal): void | Promise<void>;
  /* 执行器自持全部 SQLite 连接（写通道 + 只读池），连接级 PRAGMA 随连接走，
     运行时只交路径、只管关停。 */
  createSql(databasePath: string): CloseableSqlExecutor;
  assertSchema(sql: SqlExecutor, signal: AbortSignal): Promise<void>;
  createBlobStore(config: VpsRuntimeConfig): BlobStore & BlobInventory;
  createDeferred(report: (message: string, error: unknown) => void): DeferredTasks & { drain(): Promise<void> };
  createRateLimiter(limit: number, windowMs: number, maxEntries: number): RateLimiter;
  createHub(sql: SqlExecutor, report: (message: string, error: unknown) => void): VpsNotificationWebSocketHub;
  createApplication: typeof createApplication;
  createStaticFiles: typeof createVpsStaticFiles;
  createScheduler(
    coordinator: RuntimeApplication["services"]["scheduledJobs"],
    report: (message: string, error: unknown) => void,
  ): VpsScheduledJobScheduler;
  createWebSocketServer(): WebSocketServer;
  createHttpServer(options: VpsHttpServerOptions): Server;
  stopWebSocketServer(server: WebSocketServer): Promise<void>;
  forceCloseWebSockets(server: WebSocketServer): void;
  resolveClientAddress(request: IncomingMessage, trusted: ReadonlySet<string>): string;
  nowIso(): string;
  info(message: string): void;
  error(message: string, error: unknown): void;
}>;

export type VpsServerRuntimeOptions = Readonly<{
  dependencies?: Partial<VpsServerRuntimeDependencies>;
  timings?: Partial<VpsRuntimeTimings>;
}>;

export interface VpsServerRuntime {
  readonly state: RuntimeState;
  start(): Promise<void>;
  stop(): Promise<void>;
  handleHttp(request: Request, incoming: IncomingMessage): Promise<Response>;
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>;
}

export function createVpsServerRuntime(
  config: VpsRuntimeConfig,
  options: VpsServerRuntimeOptions = {},
): VpsServerRuntime {
  return new DefaultVpsServerRuntime(
    config,
    Object.freeze({ ...defaultDependencies(), ...options.dependencies }),
    validatedTimings(options.timings),
  );
}

class DefaultVpsServerRuntime implements VpsServerRuntime {
  private currentState: RuntimeState = "idle";
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private stopRequested = false;
  private startAbort: AbortController | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private sql: CloseableSqlExecutor | null = null;
  private deferred: (DeferredTasks & { drain(): Promise<void> }) | null = null;
  private hub: VpsNotificationWebSocketHub | null = null;
  private scheduler: VpsScheduledJobScheduler | null = null;
  private schedulerRunning = false;
  private hubRunning = false;
  private webSockets: WebSocketServer | null = null;
  private server: Server | null = null;
  private application: RuntimeApplication | null = null;
  private staticFiles: VpsStaticFilesHandler | null = null;
  private handshakeLimiter: RateLimiter | null = null;
  private readonly requestClients = new WeakMap<Request, string>();
  private readonly activeRequests = new Set<Promise<Response>>();
  private readonly activeHandshakes = new Set<Promise<void>>();
  private readonly handshakeClaims = new Set<VpsNotificationConnectionClaim>();
  private readonly startupTasks = new Set<Promise<unknown>>();

  constructor(
    private readonly config: VpsRuntimeConfig,
    private readonly dependencies: VpsServerRuntimeDependencies,
    private readonly timings: VpsRuntimeTimings,
  ) {}

  get state(): RuntimeState {
    return this.currentState;
  }

  start(): Promise<void> {
    if (this.currentState === "running") return Promise.resolve();
    if (this.currentState === "starting" && this.startPromise) return this.startPromise;
    if (this.currentState !== "idle") return Promise.reject(new Error("VPS runtime cannot be restarted"));
    this.currentState = "starting";
    this.startPromise = this.startOnce();
    return this.startPromise;
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.currentState === "idle" || this.currentState === "stopped") {
      this.currentState = "stopped";
      return Promise.resolve();
    }
    if (this.currentState === "starting" && this.startPromise) {
      this.stopRequested = true;
      this.currentState = "stopping";
      this.startAbort?.abort(new Error("VPS runtime stop requested during startup"));
      this.stopPromise = this.startPromise.then(
        () => this.stopOnce(),
        (error: unknown) => {
          if (this.currentState === "stopped") return;
          throw error;
        },
      );
      return this.stopPromise;
    }
    if (this.currentState === "stopping" && this.startPromise) {
      this.stopPromise = this.startPromise.then(
        () => this.currentState === "stopped" ? undefined : this.stopOnce(),
        (error: unknown) => {
          if (this.currentState === "stopped") return;
          throw error;
        },
      );
      return this.stopPromise;
    }
    this.stopPromise = this.stopOnce();
    return this.stopPromise;
  }

  async handleHttp(request: Request, incoming: IncomingMessage): Promise<Response> {
    if (this.currentState !== "running") return unavailable();
    const operation = this.config.maintenanceMode
      ? Promise.resolve(maintenanceResponse(withPublicOrigin(request, this.config.application.publicUrl)))
      : this.dispatchHttp(request, incoming);
    this.activeRequests.add(operation);
    try {
      return await operation;
    } finally {
      this.activeRequests.delete(operation);
    }
  }

  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (this.currentState !== "running") return rejectUpgrade(socket, 503, "Server stopping");
    if (this.config.maintenanceMode) return rejectUpgrade(socket, 503, "Maintenance in progress", 300);
    const operation = this.performUpgrade(request, socket, head);
    this.activeHandshakes.add(operation);
    try {
      await operation;
    } finally {
      this.activeHandshakes.delete(operation);
    }
  }

  private async performUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const application = required(this.application, "application");
    const hub = required(this.hub, "notification hub");
    const webSockets = required(this.webSockets, "WebSocket server");
    const handshakeLimiter = required(this.handshakeLimiter, "WebSocket rate limiter");
    const url = new URL(request.url ?? "/", this.config.application.publicUrl);
    if (url.pathname !== "/ws") return rejectUpgrade(socket, 404, "WebSocket route not found");

    /* 客户端身份要先于闸门定下来：频控键就是这个地址，代理头都对不上的连接
       谈不上来源可信。 */
    let address: string;
    try {
      address = this.dependencies.resolveClientAddress(request, this.config.trustedProxyAddresses);
    } catch {
      return rejectUpgrade(socket, 400, "Invalid proxy headers");
    }

    const admission = await admitWebSocketHandshake({
      request: new Request(url, { headers: incomingHeaders(request) }),
      clientKey: address,
      rateLimiter: handshakeLimiter,
      auth: application.services.auth,
      config: this.config.application,
      nowIso: this.dependencies.nowIso(),
    });
    if (this.rejectStoppedUpgrade(socket)) return;
    if (!admission.accepted) {
      return rejectUpgrade(socket, admission.status, admission.reason, admission.retryAfterSeconds);
    }
    const preparation = await prepareAuthenticatedVpsNotificationConnection(hub, admission.authorization);
    if (preparation.accepted) this.handshakeClaims.add(preparation.claim);
    if (this.rejectStoppedUpgrade(socket, preparation.accepted ? preparation.claim : undefined)) return;
    if (!preparation.accepted) {
      return rejectUpgrade(
        socket,
        preparation.status,
        preparation.reason,
        preparation.status === 429 ? 1 : undefined,
      );
    }

    try {
      if (this.rejectStoppedUpgrade(socket, preparation.claim)) return;
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        if (!hub.attach(webSocket, preparation.claim)) {
          webSocket.close(1013, "WebSocket admission expired");
          return;
        }
        this.attachWebSocket(webSocket);
        webSockets.emit("connection", webSocket, request);
      });
    } catch (error) {
      hub.cancelConnection(preparation.claim);
      throw error;
    } finally {
      this.handshakeClaims.delete(preparation.claim);
    }
  }

  private rejectStoppedUpgrade(socket: Duplex, claim?: VpsNotificationConnectionClaim): boolean {
    if (this.currentState === "running") return false;
    if (claim && this.hub) {
      try {
        this.hub.cancelConnection(claim);
      } catch (error) {
        this.report("WebSocket claim cancellation failed", error);
      }
      this.handshakeClaims.delete(claim);
    }
    rejectUpgrade(socket, 503, "Server stopping");
    return true;
  }

  private async startOnce(): Promise<void> {
    this.startAbort = new AbortController();
    this.startTimer = setTimeout(() => {
      this.startAbort?.abort(new Error(`VPS startup exceeded ${this.timings.startTimeoutMs}ms`));
    }, this.timings.startTimeoutMs);
    (this.startTimer as { unref?: () => void }).unref?.();
    try {
      if (this.config.maintenanceMode) {
        this.startHttpBoundary();
        this.currentState = "running";
        return;
      }
      await this.runStartupTask((signal) => this.dependencies.prepareFilesystem(this.config, signal));
      this.assertStartupActive();
      this.sql = this.dependencies.createSql(this.config.databasePath);
      this.assertStartupActive();
      await this.runStartupTask((signal) => this.dependencies.assertSchema(required(this.sql, "SQL"), signal));
      this.assertStartupActive();

      const blobs = this.dependencies.createBlobStore(this.config);
      this.assertStartupActive();
      this.deferred = this.dependencies.createDeferred((message, error) => this.report(message, error));
      this.assertStartupActive();
      this.hub = this.dependencies.createHub(this.sql, (message, error) => this.report(message, error));
      this.assertStartupActive();
      const rateLimiter = (limit: number, windowMs: number, maxEntries: number) =>
        this.dependencies.createRateLimiter(limit, windowMs, maxEntries);
      this.application = this.dependencies.createApplication({
        sql: this.sql,
        blobs,
        blobInventory: blobs,
        notifications: this.hub,
        deferred: this.deferred,
        health: new ApplicationRuntimeHealth({
          sql: this.sql,
          blobs,
          realtime: () => `ok (${this.hub?.connectionCount ?? 0} connections)`,
          scheduler: () => this.schedulerRunning ? "running" : "stopped",
        }),
        adminOperationsRuntime: new VpsAdminOperationsRuntime(
          () => this.hubRunning && this.hub ? this.hub.connectionCount : null,
          this.dependencies.nowIso,
        ),
        authRateLimiter: rateLimiter(LIMITS.rateLimit.auth.maxRequests, LIMITS.rateLimit.auth.windowMs, 25_000),
        authIpRateLimiter: rateLimiter(LIMITS.rateLimit.authIp.maxRequests, LIMITS.rateLimit.authIp.windowMs, 25_000),
        emailSender: this.config.cloudflareEmail
          ? new CloudflareRestEmailSender(this.config.cloudflareEmail.accountId, this.config.cloudflareEmail.apiToken)
          : null,
        readRateLimiter: rateLimiter(LIMITS.rateLimit.reads.maxRequests, LIMITS.rateLimit.reads.windowMs, 50_000),
        expensiveReadRateLimiter: rateLimiter(
          LIMITS.rateLimit.expensiveReads.maxRequests,
          LIMITS.rateLimit.expensiveReads.windowMs,
          25_000,
        ),
        mutationRateLimiter: rateLimiter(LIMITS.rateLimit.mutations.maxRequests, LIMITS.rateLimit.mutations.windowMs, 50_000),
        uploadRateLimiter: rateLimiter(LIMITS.rateLimit.uploads.maxRequests, LIMITS.rateLimit.uploads.windowMs, 25_000),
        clientIdentifier: (request) => {
          const address = this.requestClients.get(request);
          if (!address) throw new TypeError("Trusted client address is missing from the Node request boundary");
          return address;
        },
        onUnexpectedError: (error, requestId) => this.report(`Portal API request failed (${requestId})`, error),
      }, this.config.application);
      this.assertStartupActive();
      this.staticFiles = this.dependencies.createStaticFiles({
        distRoot: this.config.staticPath,
        getSiteBranding: () =>
          resolveStaticSiteBranding(required(this.application, "application").services.siteConfig),
      });
      this.assertStartupActive();
      this.handshakeLimiter = rateLimiter(
        LIMITS.websocket.handshakes.maxRequests,
        LIMITS.websocket.handshakes.windowMs,
        25_000,
      );
      this.assertStartupActive();
      this.scheduler = this.dependencies.createScheduler(
        this.application.services.scheduledJobs,
        (message, error) => this.report(message, error),
      );
      this.assertStartupActive();
      this.webSockets = this.dependencies.createWebSocketServer();
      this.assertStartupActive();

      this.hubRunning = true;
      this.hub.start();
      this.assertStartupActive();
      this.schedulerRunning = true;
      this.scheduler.start();
      this.assertStartupActive();
      this.startHttpBoundary();
      this.currentState = "running";
    } catch (error) {
      this.currentState = "stopping";
      try {
        await this.shutdownResources();
        this.currentState = "stopped";
      } catch (shutdownError) {
        throw new AggregateError(
          [asError(error), asError(shutdownError)],
          "VPS startup failed and cleanup could not prove quiescence",
        );
      }
      throw error;
    } finally {
      if (this.startTimer) clearTimeout(this.startTimer);
      this.startTimer = null;
      this.startAbort = null;
    }
  }

  private startHttpBoundary(): void {
    this.server = this.dependencies.createHttpServer({
      hostname: this.config.host,
      port: this.config.port,
      fetch: (request, bindings) => this.handleHttp(request, bindings.incoming),
      onListen: (address, port) => this.dependencies.info(`Infini Guild VPS listening on ${address}:${port}`),
    });
    this.assertStartupActive();
    this.server.on("upgrade", (request, socket, head) => {
      void this.handleUpgrade(request, socket, head).catch((error: unknown) => {
        this.report("WebSocket upgrade failed", error);
        if (!socket.destroyed) rejectUpgrade(socket, 503, "WebSocket unavailable");
      });
    });
    this.assertStartupActive();
  }

  private async runStartupTask<T>(operation: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
    const controller = required(this.startAbort, "startup abort controller");
    this.assertStartupActive();
    const task = Promise.resolve().then(() => operation(controller.signal));
    this.startupTasks.add(task);
    void task.then(
      () => this.startupTasks.delete(task),
      () => this.startupTasks.delete(task),
    );
    const aborted = new Promise<never>((_resolve, reject) => {
      const rejectFromAbort = () => reject(abortReason(controller.signal));
      if (controller.signal.aborted) rejectFromAbort();
      else {
        controller.signal.addEventListener("abort", rejectFromAbort, { once: true });
        void task.then(
          () => controller.signal.removeEventListener("abort", rejectFromAbort),
          () => controller.signal.removeEventListener("abort", rejectFromAbort),
        );
      }
    });
    const result = await Promise.race([task, aborted]);
    this.assertStartupActive();
    return result;
  }

  private assertStartupActive(): void {
    const signal = this.startAbort?.signal;
    if (
      this.stopRequested
      || this.currentState !== "starting"
      || signal?.aborted
    ) {
      throw signal?.aborted
        ? abortReason(signal)
        : new Error("VPS startup was cancelled");
    }
  }

  private async dispatchHttp(request: Request, incoming: IncomingMessage): Promise<Response> {
    const publicRequest = withPublicOrigin(request, this.config.application.publicUrl);
    const pathname = new URL(publicRequest.url).pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      let address: string;
      try {
        address = this.dependencies.resolveClientAddress(incoming, this.config.trustedProxyAddresses);
      } catch {
        return new Response("Invalid proxy headers", { status: 400 });
      }
      this.requestClients.set(publicRequest, address);
      return required(this.application, "application").api.fetch(publicRequest);
    }
    /* 与 CF 对齐：普通 HTTP 打到 /ws 一律 426。真正的升级请求走 Node 的
       upgrade 事件，不会经过这里。 */
    if (pathname === "/ws") return new Response("Expected websocket", { status: 426 });
    return await required(this.staticFiles, "static files")(publicRequest)
      ?? new Response("Route not found", { status: 404 });
  }

  private attachWebSocket(webSocket: WebSocket): void {
    const hub = required(this.hub, "notification hub");
    const socket = webSocket as VpsNotificationSocket;
    webSocket.on("message", (data, isBinary) => {
      hub.receive(socket, isBinary ? binaryData(data) : textData(data));
    });
    webSocket.on("close", () => hub.disconnect(socket));
    webSocket.on("error", (error) => {
      this.report("WebSocket connection failed", error);
      hub.disconnect(socket);
    });
  }

  private async stopOnce(): Promise<void> {
    this.currentState = "stopping";
    await this.shutdownResources();
    this.currentState = "stopped";
  }

  private shutdownResources(): Promise<void> {
    this.shutdownPromise ??= this.shutdownOnce();
    return this.shutdownPromise;
  }

  private async shutdownOnce(): Promise<void> {
    const failures: Error[] = [];
    if (this.schedulerRunning) {
      const stopped = this.scheduler
        ? await this.runBounded("scheduler shutdown", () => this.scheduler!.stop(), this.timings.phaseTimeoutMs)
        : false;
      if (stopped) this.schedulerRunning = false;
      else failures.push(new Error("Scheduler did not stop cleanly"));
    }

    if (this.hub) {
      for (const claim of this.handshakeClaims) {
        try {
          this.hub.cancelConnection(claim);
        } catch (error) {
          this.report("WebSocket claim cancellation failed", error);
          failures.push(asError(error));
        }
      }
      this.handshakeClaims.clear();
    }
    if (this.hubRunning) {
      const stopped = this.hub
        ? await this.runBounded("WebSocket hub shutdown", () => this.hub!.stop(), this.timings.phaseTimeoutMs)
        : false;
      if (stopped) this.hubRunning = false;
      else failures.push(new Error("WebSocket hub did not stop cleanly"));
    }

    if (this.activeHandshakes.size > 0) {
      const drained = await this.runBounded(
        "WebSocket handshake drain",
        () => Promise.allSettled([...this.activeHandshakes]).then(() => undefined),
        this.timings.phaseTimeoutMs,
      );
      if (!drained) failures.push(new Error("WebSocket handshakes did not drain"));
    }
    if (this.webSockets) {
      const webSockets = this.webSockets;
      if (await this.stopWebSockets(webSockets)) this.webSockets = null;
      else failures.push(new Error("WebSocket server did not stop cleanly"));
    }
    if (this.server) {
      const server = this.server;
      if (await this.stopHttp(server)) this.server = null;
      else failures.push(new Error("HTTP server did not stop cleanly"));
    }
    if (this.deferred) {
      const drained = await this.runBounded(
        "deferred task drain",
        () => this.deferred!.drain(),
        this.timings.deferredDrainMs,
      );
      if (!drained) failures.push(new Error("Deferred tasks did not drain"));
    }
    if (this.startupTasks.size > 0) {
      const drained = await this.runBounded(
        "startup task drain",
        () => Promise.allSettled([...this.startupTasks]).then(() => undefined),
        this.timings.phaseTimeoutMs,
      );
      if (!drained) failures.push(new Error("Startup tasks did not drain"));
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "VPS runtime could not prove every resource was quiescent");
    }
    if (this.sql) {
      const sql = this.sql;
      if (await this.runBounded("SQLite close", () => sql.close(), this.timings.phaseTimeoutMs)) {
        this.sql = null;
        return;
      }
      try {
        await sql.terminate();
      } catch (error) {
        this.report("SQLite terminate failed", error);
      }
      throw new AggregateError(
        [new Error("SQLite worker pool did not close within its grace period")],
        "SQLite did not close cleanly",
      );
    }
  }

  private async stopWebSockets(webSockets: WebSocketServer): Promise<boolean> {
    const close = Promise.resolve().then(() => this.dependencies.stopWebSocketServer(webSockets));
    try {
      if (await completesWithin(close, this.timings.phaseTimeoutMs)) return true;
      this.report(
        "WebSocket server shutdown timed out",
        new Error(`WebSocket server shutdown exceeded ${this.timings.phaseTimeoutMs}ms`),
      );
    } catch (error) {
      this.report("WebSocket server shutdown failed", error);
    }
    try {
      this.dependencies.forceCloseWebSockets(webSockets);
    } catch (error) {
      this.report("WebSocket force-close failed", error);
    }
    return false;
  }

  private async stopHttp(server: Server): Promise<boolean> {
    const close = new Promise<void>((resolve, reject) => {
      try {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
    const requests = Promise.allSettled([...this.activeRequests]).then(() => undefined);
    const quiet = Promise.all([close, requests]).then(() => undefined);
    try {
      if (await completesWithin(quiet, this.timings.httpGraceMs)) return true;
    } catch (error) {
      this.report("HTTP shutdown failed", error);
      try {
        server.closeAllConnections();
      } catch (forceError) {
        this.report("HTTP force-close failed", forceError);
      }
      return false;
    }
    try {
      server.closeAllConnections();
    } catch (error) {
      this.report("HTTP force-close failed", error);
      return false;
    }
    try {
      if (await completesWithin(quiet, this.timings.forcedRequestWaitMs)) return true;
      this.report(
        "HTTP shutdown timed out",
        new Error(`HTTP shutdown exceeded its grace and ${this.timings.forcedRequestWaitMs}ms force-close wait`),
      );
    } catch (error) {
      this.report("HTTP shutdown failed after force-close", error);
    }
    return false;
  }

  private async runBounded(label: string, operation: () => Promise<void>, timeoutMs: number): Promise<boolean> {
    try {
      if (await completesWithin(Promise.resolve().then(operation), timeoutMs)) return true;
      this.report(`${label} timed out`, new Error(`${label} exceeded ${timeoutMs}ms`));
    } catch (error) {
      this.report(`${label} failed`, error);
    }
    return false;
  }

  private report(message: string, error: unknown): void {
    try {
      this.dependencies.error(message, error);
    } catch {
      // Runtime cleanup must continue even when its reporter is broken.
    }
  }
}

function defaultDependencies(): VpsServerRuntimeDependencies {
  return {
    prepareFilesystem: (config, signal) => {
      signal.throwIfAborted();
      mkdirSync(path.dirname(config.databasePath), { recursive: true });
      mkdirSync(config.blobPath, { recursive: true });
      realpathSync(config.staticPath);
      signal.throwIfAborted();
    },
    createSql: (databasePath) => new NodeSqlExecutor(databasePath),
    assertSchema: async (sql, signal) => {
      signal.throwIfAborted();
      await assertApplicationSchema(sql);
      signal.throwIfAborted();
    },
    createBlobStore: (config) => new FilesystemBlobStore(config.blobPath),
    createDeferred: (report) => new NodeDeferredTasks({
      concurrency: 4,
      maxPending: 1_000,
      onError: (error) => report("Deferred task failed", error),
    }),
    createRateLimiter: (limit, windowMs, maxEntries) => new NodeRateLimiter({ limit, windowMs, maxEntries }),
    createHub: (sql, report) => new VpsNotificationWebSocketHub(
      createNotificationConnectionPolicy(sql),
      { onError: (error) => report("Notification WebSocket hub failed", error) },
    ),
    createApplication,
    createStaticFiles: createVpsStaticFiles,
    createScheduler: (coordinator, report) => new VpsScheduledJobScheduler(coordinator, {
      onError: (error, schedule) => report(`Scheduled ${schedule} jobs failed`, error),
    }),
    createWebSocketServer: () => new WebSocketServer({
      noServer: true,
      maxPayload: 16_384,
      perMessageDeflate: false,
    }),
    createHttpServer: (options) => serve({
      hostname: options.hostname,
      port: options.port,
      fetch: (request, bindings) => {
        if (!(bindings.incoming instanceof IncomingMessage)) {
          throw new TypeError("VPS runtime requires an HTTP/1 server");
        }
        return options.fetch(request, { incoming: bindings.incoming });
      },
    }, ({ address, port }) => options.onListen(address, port)) as Server,
    stopWebSocketServer: (server) => new Promise<void>((resolve, reject) => {
      try {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    }),
    forceCloseWebSockets: (server) => {
      for (const socket of server.clients) socket.terminate();
    },
    resolveClientAddress: resolveVpsClientAddress,
    nowIso: () => new Date().toISOString(),
    info: (message) => console.info(message),
    error: (message, error) => console.error(message, error),
  };
}

function validatedTimings(input: Partial<VpsRuntimeTimings> | undefined): VpsRuntimeTimings {
  const value = { ...DEFAULT_TIMINGS, ...input };
  for (const [name, duration] of Object.entries(value)) {
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 60_000) {
      throw new TypeError(`${name} must be an integer between 1 and 60000 milliseconds`);
    }
  }
  return Object.freeze(value);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("VPS startup was aborted");
}

function required<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`VPS runtime ${label} is unavailable`);
  return value;
}

function unavailable(): Response {
  return new Response("Server stopping", {
    status: 503,
    headers: { Connection: "close", "Retry-After": "1" },
  });
}

function completesWithin(operation: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);
    (timer as { unref?: () => void }).unref?.();
    operation.then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function binaryData(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function textData(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
}

function incomingHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

function withPublicOrigin(request: Request, publicUrl: string): Request {
  const source = new URL(request.url);
  const url = new URL(`${source.pathname}${source.search}`, publicUrl);
  return new Request(url, request);
}

function rejectUpgrade(
  socket: Duplex,
  status: number,
  message: string,
  retryAfter?: number,
): void {
  if (socket.destroyed) return;
  const safeMessage = message.replace(/[\r\n]/g, " ").slice(0, 120);
  const headers = [
    `HTTP/1.1 ${status} ${safeMessage}`,
    "Connection: close",
    "Content-Type: text/plain; charset=UTF-8",
    `Content-Length: ${Buffer.byteLength(safeMessage)}`,
    ...(retryAfter ? [`Retry-After: ${retryAfter}`] : []),
    "",
    safeMessage,
  ];
  socket.end(headers.join("\r\n"));
}
