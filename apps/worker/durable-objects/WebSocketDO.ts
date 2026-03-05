import type { HeartbeatAckMessage, HeartbeatMessage, PushMessage } from "@guild/shared";

const STALE_TIMEOUT_MS = 90_000;
const SWEEP_INTERVAL_MS = 30_000;

export class WebSocketDO {
  private lastHeartbeat = new Map<WebSocket, number>();

  constructor(private readonly state: DurableObjectState) {}

  private broadcast(payload: string): void {
    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        try {
          socket.close(1011, "broadcast failed");
        } catch {
          // ignore close failures
        }
      }
    }
  }

  private sweepStaleConnections(): void {
    const now = Date.now();
    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      const lastSeen = this.lastHeartbeat.get(socket);
      if (lastSeen != null && now - lastSeen > STALE_TIMEOUT_MS) {
        this.lastHeartbeat.delete(socket);
        try {
          socket.close(4001, "heartbeat timeout");
        } catch {
          // ignore close failures
        }
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/publish") {
      let message: PushMessage;
      try {
        message = (await request.json()) as PushMessage;
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      this.broadcast(JSON.stringify(message));
      return new Response(JSON.stringify({ ok: true, delivered: this.state.getWebSockets().length }), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    this.lastHeartbeat.set(server, Date.now());

    // Schedule the sweep alarm if not already running
    const currentAlarm = await this.state.storage.getAlarm();
    if (currentAlarm == null) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (typeof message !== "string") {
      return;
    }

    let parsed: { type?: string };
    try {
      parsed = JSON.parse(message) as { type?: string };
    } catch {
      // Legacy ping support
      if (message.trim().toLowerCase() === "ping") {
        ws.send("pong");
      }
      return;
    }

    if (parsed.type === "heartbeat") {
      const heartbeat = parsed as HeartbeatMessage;
      this.lastHeartbeat.set(ws, Date.now());

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

  webSocketClose(ws: WebSocket): void {
    this.lastHeartbeat.delete(ws);
  }

  async alarm(): Promise<void> {
    this.sweepStaleConnections();

    // Reschedule if there are still active connections
    if (this.state.getWebSockets().length > 0) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }
}
