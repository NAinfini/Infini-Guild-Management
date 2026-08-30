import { createNotificationConnectionPolicy } from "@guild/application";
import type { AuthorizationContext } from "@guild/kernel";
import {
  INTERNAL_NOTIFICATION_SESSION_HEADER,
  NOTIFICATION_CONNECTION_POLICY,
  NotificationConnectionPolicy,
  restoreNotificationConnectionState,
  type NotificationConnectionState,
  type NotificationSweepDecision,
} from "@guild/server";
import { D1SqlExecutor } from "../adapters/d1-sql-executor.js";

const MAX_PUBLISH_BYTES = 16_384;
const encoder = new TextEncoder();

export type CloudflareNotificationEnvironment = Readonly<{ DB: D1Database }>;

export type CloudflareNotificationTarget = Readonly<{
  fetch(request: Request): Promise<Response>;
}>;

function defaultPolicy(database: D1Database): NotificationConnectionPolicy {
  return createNotificationConnectionPolicy(new D1SqlExecutor(database));
}

function rejectionResponse(status: 401 | 429 | 503, reason: string): Response {
  return new Response(reason, {
    status,
    ...(status === 429 ? { headers: { "Retry-After": "1" } } : {}),
  });
}

function safeClose(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // The platform already considers a throwing socket unusable.
  }
}

function sameAuthorizationVersion(
  current: NotificationConnectionState,
  captured: NotificationConnectionState,
): boolean {
  const left = current.session;
  const right = captured.session;
  return current.lastSessionCheckedAt === captured.lastSessionCheckedAt
    && left.sessionId === right.sessionId
    && left.userId === right.userId
    && left.roleId === right.roleId
    && left.roleLevel === right.roleLevel
    && left.permissions.length === right.permissions.length
    && left.permissions.every((permission, index) => permission === right.permissions[index]);
}

function applyAuthorizationDecision(
  socket: WebSocket,
  captured: NotificationConnectionState,
  decision: NotificationSweepDecision,
): "closed" | "updated" | "skipped" {
  const current = restoreNotificationConnectionState(socket.deserializeAttachment());
  if (!current) {
    safeClose(socket, NOTIFICATION_CONNECTION_POLICY.closeCodes.unauthorized, "session identity missing");
    return "closed";
  }
  if (!sameAuthorizationVersion(current, captured)) return "skipped";
  if ("close" in decision) {
    if (
      decision.close.code === NOTIFICATION_CONNECTION_POLICY.closeCodes.heartbeatTimeout
      && current.lastHeartbeatAt !== captured.lastHeartbeatAt
    ) return "skipped";
    safeClose(socket, decision.close.code, decision.close.reason);
    return "closed";
  }
  if (decision.state === captured) return "skipped";
  socket.serializeAttachment(Object.freeze({
    ...current,
    session: decision.state.session,
    lastSessionCheckedAt: decision.state.lastSessionCheckedAt,
  }));
  return "updated";
}

/**
 * Root-route leaf: call only after the HTTP layer has validated the WebSocket
 * origin and resolved the cookie into this authorization context.
 */
export function forwardCloudflareNotificationWebSocket(
  request: Request,
  authorization: AuthorizationContext,
  target: CloudflareNotificationTarget,
): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return Promise.resolve(new Response("Expected websocket", { status: 426 }));
  }
  const actor = authorization.requireAuthenticated();
  const headers = new Headers(request.headers);
  headers.set(INTERNAL_NOTIFICATION_SESSION_HEADER, actor.sessionId);
  return target.fetch(new Request(request, { headers }));
}

export class CloudflareNotificationDurableObject {
  private readonly policy: NotificationConnectionPolicy;
  private authorizationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectState,
    env: CloudflareNotificationEnvironment,
    policy?: NotificationConnectionPolicy,
  ) {
    this.policy = policy ?? defaultPolicy(env.DB);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json({
        observed_at: new Date().toISOString(),
        connection_count: this.state.getWebSockets().length,
      });
    }
    if (request.method === "POST" && url.pathname === "/publish") {
      return this.publish(request);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    try {
      if (await this.state.storage.getAlarm() === null) {
        await this.state.storage.setAlarm(this.policy.nowMs() + NOTIFICATION_CONNECTION_POLICY.sweepIntervalMs);
      }
    } catch {
      return new Response("Notification scheduling unavailable", { status: 503 });
    }

    const sessionId = request.headers.get(INTERNAL_NOTIFICATION_SESSION_HEADER) ?? "";
    let session;
    try {
      session = await this.policy.resolveSession(sessionId);
    } catch {
      return new Response("Session verification unavailable", { status: 503 });
    }

    // Resolve first, then count and accept without another await. This keeps the
    // count/accept boundary atomic within one Durable Object turn.
    const sockets = this.state.getWebSockets();
    const active = sockets.flatMap((socket) => {
      const connection = restoreNotificationConnectionState(socket.deserializeAttachment());
      return connection ? [connection] : [];
    });
    const admission = this.policy.admit(session, active, sockets.length);
    if (!admission.accepted) return rejectionResponse(admission.status, admission.reason);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    server.serializeAttachment(admission.state);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): void {
    const connection = restoreNotificationConnectionState(socket.deserializeAttachment());
    if (!connection) {
      safeClose(socket, NOTIFICATION_CONNECTION_POLICY.closeCodes.unauthorized, "session identity missing");
      return;
    }
    const decision = this.policy.handleClientMessage(
      connection,
      typeof message === "string" ? message : null,
      this.state.getWebSockets().length,
    );
    if (decision.close) {
      safeClose(socket, decision.close.code, decision.close.reason);
      return;
    }
    socket.serializeAttachment(decision.state);
    if (decision.send) {
      try {
        socket.send(decision.send);
      } catch {
        safeClose(socket, NOTIFICATION_CONNECTION_POLICY.closeCodes.internalError, "websocket send failed");
      }
    }
  }

  webSocketClose(): void {}

  webSocketError(socket: WebSocket): void {
    safeClose(socket, NOTIFICATION_CONNECTION_POLICY.closeCodes.internalError, "websocket error");
  }

  async alarm(): Promise<void> {
    await this.runAuthorizationOperation(() => this.sweepAuthorization());
  }

  private async sweepAuthorization(): Promise<void> {
    const entries = this.state.getWebSockets().map((socket) => ({
      socket,
      connection: restoreNotificationConnectionState(socket.deserializeAttachment()),
    }));
    const valid = entries.filter(
      (entry): entry is { socket: WebSocket; connection: NotificationConnectionState } => entry.connection !== null,
    );
    for (const entry of entries) {
      if (!entry.connection) {
        safeClose(entry.socket, NOTIFICATION_CONNECTION_POLICY.closeCodes.unauthorized, "session identity missing");
      }
    }

    const decisions = await this.policy.sweep(valid.map(({ connection }) => connection));
    decisions.forEach((decision, index) => {
      const entry = valid[index];
      if (entry) applyAuthorizationDecision(entry.socket, entry.connection, decision);
    });

    if (this.state.getWebSockets().length > 0) {
      await this.state.storage.setAlarm(this.policy.nowMs() + NOTIFICATION_CONNECTION_POLICY.sweepIntervalMs);
    }
  }

  private async publish(request: Request): Promise<Response> {
    const body = await request.text();
    if (encoder.encode(body).byteLength > MAX_PUBLISH_BYTES) {
      return new Response("Notification payload too large", { status: 413 });
    }
    let input: unknown;
    try {
      input = JSON.parse(body) as unknown;
    } catch {
      return new Response("Invalid notification payload", { status: 400 });
    }
    try {
      const refresh = this.policy.parseAuthorizationRefresh(input);
      if (refresh) {
        return await this.runAuthorizationOperation(async () => {
          const entries = this.state.getWebSockets().flatMap((socket) => {
            const connection = restoreNotificationConnectionState(socket.deserializeAttachment());
            if (!connection) {
              safeClose(socket, NOTIFICATION_CONNECTION_POLICY.closeCodes.unauthorized, "session identity missing");
              return [];
            }
            return this.policy.matchesAuthorizationRefresh(connection, refresh) ? [{ socket, connection }] : [];
          });
          const decisions = await this.policy.refreshAuthorization(entries.map(({ connection }) => connection));
          let closed = 0;
          decisions.forEach((decision, index) => {
            const entry = entries[index];
            if (entry && applyAuthorizationDecision(entry.socket, entry.connection, decision) === "closed") {
              closed += 1;
            }
          });
          return Response.json({ ok: true, refreshed: entries.length, closed });
        });
      }
    } catch {
      return new Response("Invalid notification payload", { status: 400 });
    }

    let message;
    try {
      message = this.policy.parseOutbound(input);
    } catch {
      return new Response("Invalid notification payload", { status: 400 });
    }

    const payload = JSON.stringify(message);
    let delivered = 0;
    for (const socket of this.state.getWebSockets()) {
      const connection = restoreNotificationConnectionState(socket.deserializeAttachment());
      if (!connection) {
        safeClose(socket, NOTIFICATION_CONNECTION_POLICY.closeCodes.unauthorized, "session identity missing");
        continue;
      }
      if (!this.policy.canDeliver(connection, message)) continue;
      try {
        socket.send(payload);
        delivered += 1;
      } catch {
        safeClose(socket, NOTIFICATION_CONNECTION_POLICY.closeCodes.internalError, "websocket send failed");
      }
    }
    return Response.json({ ok: true, delivered });
  }

  private runAuthorizationOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.authorizationTail.then(operation, operation);
    this.authorizationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
