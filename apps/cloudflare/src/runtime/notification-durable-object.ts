import type { AuthorizationContext } from "@guild/kernel";
import { createAppDatabase, SqliteAuthStore } from "@guild/persistence-sqlite";
import {
  AuthStoreNotificationSessionResolver,
  INTERNAL_NOTIFICATION_SESSION_HEADER,
  NOTIFICATION_CONNECTION_POLICY,
  NotificationConnectionPolicy,
  restoreNotificationConnectionState,
  type NotificationConnectionState,
} from "@guild/server";
import { D1SqlExecutor } from "../adapters/d1-sql-executor.js";

const MAX_PUBLISH_BYTES = 16_384;
const encoder = new TextEncoder();

export type CloudflareNotificationEnvironment = Readonly<{ DB: D1Database }>;

export type CloudflareNotificationTarget = Readonly<{
  fetch(request: Request): Promise<Response>;
}>;

function defaultPolicy(database: D1Database): NotificationConnectionPolicy {
  const executor = new D1SqlExecutor(database);
  const store = new SqliteAuthStore(createAppDatabase(executor), executor);
  return new NotificationConnectionPolicy(new AuthStoreNotificationSessionResolver(store));
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

  constructor(
    private readonly state: DurableObjectState,
    env: CloudflareNotificationEnvironment,
    policy?: NotificationConnectionPolicy,
  ) {
    this.policy = policy ?? defaultPolicy(env.DB);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
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
      const socket = valid[index]?.socket;
      if (!socket) return;
      if ("close" in decision) {
        safeClose(socket, decision.close.code, decision.close.reason);
      } else {
        socket.serializeAttachment(decision.state);
      }
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
    let message;
    try {
      message = this.policy.parseOutbound(JSON.parse(body) as unknown);
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
}
