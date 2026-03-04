import type { PushMessage } from "@guild/shared";

export class WebSocketDO {
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

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (typeof message === "string" && message.trim().toLowerCase() === "ping") {
      ws.send("pong");
    }
  }

  webSocketClose(_ws: WebSocket): void {
    // Cloudflare Durable Objects manage socket lifecycle.
  }
}
