import type { HeartbeatAckMessage, HeartbeatMessage, PushMessage } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import type { Bindings } from "../index";
import { isSessionStillValid } from "../services/auth";

const STALE_TIMEOUT_MS = 90_000;
const SWEEP_INTERVAL_MS = 60_000;
const CONNECTION_LIMIT_RETRY_MS = 1_000;
export const MAX_WEBSOCKET_CONNECTIONS = LIMITS.websocket.maxConnections;

/**
 * How long a socket may keep pushing on a session that is no longer verified.
 * Rechecked on the existing 60 s sweep alarm, so the real bound is 5–6 minutes.
 */
const SESSION_RECHECK_INTERVAL_MS = 5 * 60_000;

/**
 * Close code for a session that has been revoked, expired, or deactivated while
 * the socket was open. 4401 is what the portal already treats as an auth
 * failure: it stops reconnecting and falls back to polling instead of hammering
 * `/ws` with a dead cookie.
 */
const WS_CLOSE_UNAUTHORIZED = 4401;

/**
 * Hashed session id of the connecting user, set by the `/ws` handler in
 * index.ts. Always overwritten there, so a client cannot forge it.
 */
export const WS_SESSION_ID_HEADER = "X-Internal-Session-Id";
export const WS_ACCOUNT_ID_HEADER = "X-Internal-Account-Id";

/**
 * Compares the presented bearer token against the shared secret in constant
 * time. Both sides are hashed first so neither the length nor a matching
 * prefix of the real secret can be probed through response timing.
 */
async function bearerTokenMatches(authHeader: string, secret: string): Promise<boolean> {
  if (!authHeader.startsWith("Bearer ")) return false;
  const presented = authHeader.slice("Bearer ".length);
  const encoder = new TextEncoder();
  const [presentedDigest, secretDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  ]);
  const presentedBytes = new Uint8Array(presentedDigest);
  const secretBytes = new Uint8Array(secretDigest);
  let difference = 0;
  for (let i = 0; i < presentedBytes.length; i += 1) {
    difference |= (presentedBytes[i] ?? 0) ^ (secretBytes[i] ?? 0);
  }
  return difference === 0;
}

type SocketAttachment = {
  /** Last heartbeat, epoch ms. */
  ts: number;
  /** Hashed session id this socket authenticated with. */
  sid: string;
  /** Trusted internal account id resolved by the `/ws` route. */
  accountId: string;
  /** Last time the session was confirmed to still be valid, epoch ms. */
  checkedAt: number;
};

type HandshakeBucket = {
  count: number;
  windowId: number;
};

type HandshakeDecision = {
  count: number;
  resetAt: number;
};

export class WebSocketDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Bindings,
  ) {}

  private getAttachment(ws: WebSocket): SocketAttachment | null {
    return ws.deserializeAttachment() as SocketAttachment | null;
  }

  private getLastHeartbeat(ws: WebSocket): number {
    return this.getAttachment(ws)?.ts ?? 0;
  }

  private setLastHeartbeat(ws: WebSocket, ts: number): void {
    const attachment = this.getAttachment(ws);
    if (!attachment) return;
    ws.serializeAttachment({ ...attachment, ts });
  }

  private countAccountConnections(accountId: string, sockets: WebSocket[]): number {
    let count = 0;
    for (const socket of sockets) {
      if (this.getAttachment(socket)?.accountId === accountId) count += 1;
    }
    return count;
  }

  private async consumeHandshake(accountId: string, now: number): Promise<HandshakeDecision> {
    const { windowMs } = LIMITS.websocket.handshakes;
    const windowId = Math.floor(now / windowMs);
    const key = `websocket-handshakes:${accountId}`;

    const count = await this.state.storage.transaction(async (txn) => {
      const current = await txn.get<HandshakeBucket>(key);
      const nextCount = current?.windowId === windowId ? current.count + 1 : 1;
      await txn.put(key, { count: nextCount, windowId } satisfies HandshakeBucket);
      return nextCount;
    });

    return { count, resetAt: (windowId + 1) * windowMs };
  }

  private rateLimited(
    scope: string,
    limit: number,
    resetAt: number,
    now: number,
    message: string,
  ): Response {
    const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
    return new Response(message, {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Scope": scope,
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
      },
    });
  }

  private broadcast(payload: string): void {
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        try { socket.close(1011, "broadcast failed"); } catch { /* ignore */ }
      }
    }
  }

  private sweepStaleConnections(): void {
    const now = Date.now();
    for (const socket of this.state.getWebSockets()) {
      const lastSeen = this.getLastHeartbeat(socket);
      if (lastSeen > 0 && now - lastSeen > STALE_TIMEOUT_MS) {
        try { socket.close(4001, "heartbeat timeout"); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Re-checks each open socket's session against D1 once per
   * SESSION_RECHECK_INTERVAL_MS and closes the ones whose session is gone.
   * Distinct session ids are queried once per sweep, so a user with several tabs
   * costs one read, not one per tab.
   */
  private async revalidateSessions(): Promise<void> {
    const now = Date.now();
    const verdicts = new Map<string, boolean>();

    for (const socket of this.state.getWebSockets()) {
      const attachment = this.getAttachment(socket);
      if (!attachment?.sid || !attachment.accountId) {
        // Missing trusted identity means this socket was accepted by an older
        // build or through a broken internal call. It cannot be accounted for
        // and revalidated safely, so it cannot stay open.
        try { socket.close(WS_CLOSE_UNAUTHORIZED, "session identity missing"); } catch { /* ignore */ }
        continue;
      }
      if (now - attachment.checkedAt < SESSION_RECHECK_INTERVAL_MS) continue;

      let valid = verdicts.get(attachment.sid);
      if (valid === undefined) {
        valid = await isSessionStillValid(this.env.DB, attachment.sid, now);
        verdicts.set(attachment.sid, valid);
      }

      if (valid) {
        socket.serializeAttachment({ ...attachment, checkedAt: now });
      } else {
        try { socket.close(WS_CLOSE_UNAUTHORIZED, "session revoked"); } catch { /* ignore */ }
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/publish") {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !(await bearerTokenMatches(authHeader, this.env.SIGNING_SECRET))) {
        return new Response("Unauthorized", { status: 401 });
      }
      let message: PushMessage;
      try { message = (await request.json()) as PushMessage; } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      this.broadcast(JSON.stringify(message));
      return new Response(JSON.stringify({ ok: true, delivered: this.state.getWebSockets().length }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    // No session id means the request did not come through the `/ws` handler.
    // Accepting it would create a socket that can never be revalidated.
    const sessionId = request.headers.get(WS_SESSION_ID_HEADER);
    if (!sessionId) {
      return new Response("Missing session identity", { status: 401 });
    }
    const accountId = request.headers.get(WS_ACCOUNT_ID_HEADER);
    if (!accountId) {
      return new Response("Missing account identity", { status: 401 });
    }

    const now = Date.now();
    const handshake = await this.consumeHandshake(accountId, now);
    if (handshake.count > LIMITS.websocket.handshakes.maxRequests) {
      return this.rateLimited(
        "websocket-handshakes",
        LIMITS.websocket.handshakes.maxRequests,
        handshake.resetAt,
        now,
        "Too many WebSocket handshakes",
      );
    }

    // This snapshot, both limit checks, and acceptWebSocket are intentionally
    // synchronous. No other DO request can interleave and oversubscribe either
    // connection limit between the count and the accept.
    const sockets = this.state.getWebSockets();
    if (sockets.length >= MAX_WEBSOCKET_CONNECTIONS) {
      return new Response("Too many connections", { status: 503 });
    }
    if (this.countAccountConnections(accountId, sockets) >= LIMITS.websocket.connectionsPerAccount) {
      return this.rateLimited(
        "websocket-connections",
        LIMITS.websocket.connectionsPerAccount,
        now + CONNECTION_LIMIT_RETRY_MS,
        now,
        "Too many connections for this account",
      );
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ ts: now, sid: sessionId, accountId, checkedAt: now } satisfies SocketAttachment);

    const currentAlarm = await this.state.storage.getAlarm();
    if (currentAlarm == null) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (typeof message !== "string") return;

    let parsed: { type?: string };
    try { parsed = JSON.parse(message) as { type?: string }; } catch { return; }

    if (parsed.type === "heartbeat") {
      const heartbeat = parsed as HeartbeatMessage;
      this.setLastHeartbeat(ws, Date.now());

      const ack: HeartbeatAckMessage = {
        type: "heartbeat_ack",
        tab_id: heartbeat.tab_id,
        seq: heartbeat.seq,
        server_at: new Date().toISOString(),
        connections: this.state.getWebSockets().length,
      };
      ws.send(JSON.stringify(ack));
    }
  }

  webSocketClose(): void {}

  webSocketError(ws: WebSocket): void {
    try { ws.close(1011, "websocket error"); } catch { /* ignore */ }
  }

  async alarm(): Promise<void> {
    this.sweepStaleConnections();
    await this.revalidateSessions();

    if (this.state.getWebSockets().length > 0) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }
}
