import type { HeartbeatAckMessage, HeartbeatMessage, PushMessage } from "@guild/shared";
import type { Bindings } from "../index";

const STALE_TIMEOUT_MS = 90_000;
const SWEEP_INTERVAL_MS = 60_000;
export const MAX_WEBSOCKET_CONNECTIONS = 1500;

export class WebSocketDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Bindings,
  ) {}

  private getLastHeartbeat(ws: WebSocket): number {
    const attachment = ws.deserializeAttachment() as { ts?: number } | null;
    return attachment?.ts ?? 0;
  }

  private setLastHeartbeat(ws: WebSocket, ts: number): void {
    ws.serializeAttachment({ ts });
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

    if (this.state.getWebSockets().length >= MAX_WEBSOCKET_CONNECTIONS) {
      return new Response("Too many connections", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    this.setLastHeartbeat(server, Date.now());

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

    if (this.state.getWebSockets().length > 0) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }
}
