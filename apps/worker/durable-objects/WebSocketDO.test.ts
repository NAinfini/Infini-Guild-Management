import { LIMITS } from "@guild/shared/config/limits";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../index";
import {
  WebSocketDO,
  WS_ACCOUNT_ID_HEADER,
  WS_SESSION_ID_HEADER,
} from "./WebSocketDO";

class FakeWebSocket {
  attachment: unknown;

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  serializeAttachment(attachment: unknown): void {
    this.attachment = attachment;
  }

  send(): void {}

  close(): void {}
}

class FakeWebSocketPair {
  readonly 0 = new FakeWebSocket();
  readonly 1 = new FakeWebSocket();
}

class FakeResponse {
  readonly headers: Headers;
  readonly status: number;
  readonly webSocket?: WebSocket;

  constructor(
    readonly body: BodyInit | null = null,
    init: ResponseInit & { webSocket?: WebSocket } = {},
  ) {
    this.headers = new Headers(init.headers);
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
  }
}

type TestState = {
  state: DurableObjectState;
  sockets: FakeWebSocket[];
};

function createState(): TestState {
  const sockets: FakeWebSocket[] = [];
  const values = new Map<string, unknown>();
  let alarm: number | null = null;
  const transaction = {
    get: async <T>(key: string): Promise<T | undefined> => values.get(key) as T | undefined,
    put: async (key: string, value: unknown): Promise<void> => {
      values.set(key, value);
    },
  };
  const storage = {
    getAlarm: async () => alarm,
    setAlarm: async (scheduledTime: number) => {
      alarm = scheduledTime;
    },
    transaction: async <T>(callback: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> =>
      callback(transaction as unknown as DurableObjectTransaction),
  };
  const state = {
    acceptWebSocket: (socket: WebSocket) => sockets.push(socket as unknown as FakeWebSocket),
    getWebSockets: () => sockets as unknown as WebSocket[],
    storage,
  };

  return { state: state as unknown as DurableObjectState, sockets };
}

function createEnv(): Bindings {
  return {
    DB: {} as D1Database,
    SIGNING_SECRET: "test-secret",
  } as Bindings;
}

function upgradeRequest(accountId: string, sessionId = `session-${accountId}`): Request {
  return new Request("https://ws.internal/ws", {
    headers: {
      Upgrade: "websocket",
      [WS_ACCOUNT_ID_HEADER]: accountId,
      [WS_SESSION_ID_HEADER]: sessionId,
    },
  });
}

describe("WebSocketDO account limits", () => {
  beforeEach(() => {
    vi.stubGlobal("Response", FakeResponse);
    vi.stubGlobal("WebSocketPair", FakeWebSocketPair);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows the 12th connection, rejects the 13th, and still allows another account", async () => {
    const { state, sockets } = createState();
    const object = new WebSocketDO(state, createEnv());

    for (let count = 1; count <= LIMITS.websocket.connectionsPerAccount; count += 1) {
      const response = await object.fetch(upgradeRequest("account-a"));
      expect(response.status, `connection ${count}`).toBe(101);
    }
    expect(sockets).toHaveLength(12);

    const rejected = await object.fetch(upgradeRequest("account-a", "another-session"));
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("X-RateLimit-Scope")).toBe("websocket-connections");
    expect(rejected.headers.get("X-RateLimit-Limit")).toBe("12");
    expect(rejected.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(rejected.headers.get("X-RateLimit-Reset")).toBeTruthy();
    expect(rejected.headers.get("Retry-After")).toBeTruthy();

    const otherAccount = await object.fetch(upgradeRequest("account-b"));
    expect(otherAccount.status).toBe(101);
    expect(sockets).toHaveLength(13);
  });

  it("rejects the first handshake beyond the per-account minute limit", async () => {
    const { state, sockets } = createState();
    const object = new WebSocketDO(state, createEnv());

    for (let count = 1; count <= LIMITS.websocket.handshakes.maxRequests; count += 1) {
      const response = await object.fetch(upgradeRequest("account-a", `session-${count}`));
      expect(response.status, `handshake ${count}`).toBe(101);
      sockets.length = 0;
    }

    const rejected = await object.fetch(upgradeRequest("account-a", "session-over-limit"));
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("X-RateLimit-Scope")).toBe("websocket-handshakes");
    expect(rejected.headers.get("X-RateLimit-Limit")).toBe("30");
    expect(rejected.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(rejected.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(0);
    expect(Number(rejected.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
