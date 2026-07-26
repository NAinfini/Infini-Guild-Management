import type { HeartbeatAckMessage, HeartbeatMessage, PushMessage } from "@guild/shared";
import type { Bindings } from "../index";
import { isSessionStillValid } from "../services/auth";

const STALE_TIMEOUT_MS = 90_000;
const SWEEP_INTERVAL_MS = 60_000;
export const MAX_WEBSOCKET_CONNECTIONS = 1500;

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

type SocketAttachment = {
  /** Last heartbeat, epoch ms. */
  ts: number;
  /** Hashed session id this socket authenticated with. */
  sid: string;
  /** Last time the session was confirmed to still be valid, epoch ms. */
  checkedAt: number;
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
      if (!attachment?.sid) {
        // No session id to check against. Either a socket accepted by an older
        // build of this DO (its attachment was `{ ts }` only) or a bug — either
        // way it cannot be revalidated, so it cannot be trusted to stay open.
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
      if (!authHeader || authHeader !== `Bearer ${this.env.SIGNING_SECRET}`) {
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

    if (this.state.getWebSockets().length >= MAX_WEBSOCKET_CONNECTIONS) {
      return new Response("Too many connections", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    const now = Date.now();
    server.serializeAttachment({ ts: now, sid: sessionId, checkedAt: now } satisfies SocketAttachment);

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
