import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_CONNECTION_POLICY,
  NotificationConnectionPolicy,
  type NotificationSessionSnapshot,
} from "@guild/server";
import { VpsNotificationWebSocketHub } from "@guild/vps/testing/notification-runtime";
import { CloudflareNotificationDurableObject } from "./notification-durable-object.js";

class FakeSocket {
  attachment: unknown;
  readonly sent: string[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  serializeAttachment(attachment: unknown): void {
    this.attachment = attachment;
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
  }
}

class FakeWebSocketPair {
  readonly 0 = new FakeSocket();
  readonly 1 = new FakeSocket();
}

class FakeResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly webSocket?: WebSocket;

  constructor(
    readonly body: BodyInit | null = null,
    init: ResponseInit = {},
  ) {
    this.status = init.status ?? 200;
    this.headers = new Headers(init.headers);
    this.webSocket = init.webSocket ?? undefined;
  }

  static json(value: unknown, init: ResponseInit = {}): FakeResponse {
    return new FakeResponse(JSON.stringify(value), {
      ...init,
      headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)) },
    });
  }

  async json(): Promise<unknown> {
    return JSON.parse(typeof this.body === "string" ? this.body : "null") as unknown;
  }
}

type RuntimeHarness = Readonly<{
  connect(): Promise<number>;
  receive(payload: string): void;
  publish(payload: unknown): Promise<void>;
  sweep(): Promise<void>;
  setNow(value: number): void;
  revoke(): void;
  sent(): readonly string[];
  closes(): readonly Readonly<{ code: number; reason: string }>[];
}>;

function snapshot(): NotificationSessionSnapshot {
  return {
    sessionId: "session-1",
    userId: "user-1",
    roleId: "member",
    roleLevel: 100,
    permissions: [],
  };
}

function snapshotFor(sessionId: string): NotificationSessionSnapshot {
  return {
    sessionId,
    userId: sessionId.replace("session-", "user-"),
    roleId: "member",
    roleLevel: 100,
    permissions: [],
  };
}

function snapshotWithPermissions(permissions: readonly string[]): NotificationSessionSnapshot {
  return { ...snapshot(), permissions };
}

async function verifyRuntimeContract(create: () => RuntimeHarness): Promise<void> {
  const runtime = create();
  expect(await runtime.connect()).toBe(101);
  runtime.receive(JSON.stringify({
    type: "heartbeat",
    tab_id: "tab-1",
    seq: 1,
    sent_at: "2026-08-09T00:00:00.000Z",
  }));
  await runtime.publish({
    type: "entity_changed",
    entity_type: "event",
    entity_id: "event-1",
    updated_at: "2026-08-09T00:00:00.000Z",
    hint: "event_created",
  });
  await runtime.publish({
    type: "entity_changed",
    entity_type: "member_badge",
    entity_id: "badge-1",
    updated_at: "2026-08-09T00:00:00.000Z",
    hint: "badge_assigned",
  });

  runtime.setNow(300_001);
  runtime.receive(JSON.stringify({
    type: "heartbeat",
    tab_id: "tab-1",
    seq: 2,
    sent_at: "2026-08-09T00:05:00.001Z",
  }));
  runtime.revoke();
  await runtime.sweep();

  expect(runtime.sent().map((payload) => JSON.parse(payload) as Record<string, unknown>)).toEqual([
    expect.objectContaining({ type: "heartbeat_ack", seq: 1, connections: 1 }),
    expect.objectContaining({ type: "entity_changed", hint: "event_created" }),
    expect.objectContaining({ type: "heartbeat_ack", seq: 2, connections: 1 }),
  ]);
  expect(runtime.closes()).toContainEqual({ code: 4401, reason: "session revoked" });
}

describe("notification runtime parity", () => {
  beforeEach(() => {
    vi.stubGlobal("Response", FakeResponse);
    vi.stubGlobal("WebSocketPair", FakeWebSocketPair);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies the same heartbeat, filtering, and revocation contract in Cloudflare", async () => {
    let now = 1;
    let valid = true;
    const policy = new NotificationConnectionPolicy({
      resolve: async () => valid ? snapshot() : null,
    }, { now: () => now });
    const sockets: FakeSocket[] = [];
    let alarm: number | null = null;
    const state = {
      acceptWebSocket(socket: WebSocket) {
        sockets.push(socket as unknown as FakeSocket);
      },
      getWebSockets() {
        return sockets as unknown as WebSocket[];
      },
      storage: {
        getAlarm: async () => alarm,
        setAlarm: async (value: number) => {
          alarm = value;
        },
      },
    } as unknown as DurableObjectState;
    const object = new CloudflareNotificationDurableObject(state, { DB: {} as D1Database }, policy);

    await verifyRuntimeContract(() => ({
      async connect() {
        const response = await object.fetch(new Request("https://notifications.internal/ws", {
          headers: { Upgrade: "websocket", "X-Internal-Notification-Session": "session-1" },
        }));
        return response.status;
      },
      receive(payload) {
        object.webSocketMessage(sockets[0] as unknown as WebSocket, payload);
      },
      async publish(payload) {
        const response = await object.fetch(new Request("https://notifications.internal/publish", {
          method: "POST",
          body: JSON.stringify(payload),
        }));
        expect(response.status).toBe(200);
      },
      sweep: () => object.alarm(),
      setNow(value) {
        now = value;
      },
      revoke() {
        valid = false;
      },
      sent: () => sockets[0]?.sent ?? [],
      closes: () => sockets[0]?.closes ?? [],
    }));
  });

  it("applies the same heartbeat, filtering, and revocation contract in VPS", async () => {
    let now = 1;
    let valid = true;
    const policy = new NotificationConnectionPolicy({
      resolve: async () => valid ? snapshot() : null,
    }, { now: () => now });
    const socket = new FakeSocket();
    const hub = new VpsNotificationWebSocketHub(policy);

    await verifyRuntimeContract(() => ({
      async connect() {
        return (await hub.connect(socket, "session-1")).accepted ? 101 : 503;
      },
      receive: (payload) => hub.receive(socket, payload),
      publish: (payload) => hub.publish(payload as never),
      sweep: () => hub.sweep(),
      setNow(value) {
        now = value;
      },
      revoke() {
        valid = false;
      },
      sent: () => socket.sent,
      closes: () => socket.closes,
    }));
  });

  it("immediately closes targeted revoked sockets in both runtimes", async () => {
    const cloudflareSocket = new FakeSocket();
    cloudflareSocket.serializeAttachment({
      session: snapshot(),
      lastHeartbeatAt: 1,
      lastSessionCheckedAt: 1,
    });
    const resolver = {
      resolve: vi.fn(async () => snapshot()),
      resolveMany: vi.fn(async () => new Map<string, NotificationSessionSnapshot | null>([["session-1", null]])),
    };
    const cloudflareObject = new CloudflareNotificationDurableObject({
      getWebSockets: () => [cloudflareSocket] as unknown as WebSocket[],
    } as unknown as DurableObjectState, { DB: {} as D1Database }, new NotificationConnectionPolicy(resolver));

    const cloudflareResponse = await cloudflareObject.fetch(new Request("https://notifications.internal/publish", {
      method: "POST",
      body: JSON.stringify({ type: "authorization_refresh", user_ids: ["user-1"] }),
    }));

    expect(await cloudflareResponse.json()).toEqual({ ok: true, refreshed: 1, closed: 1 });
    expect(cloudflareSocket.closes).toEqual([{ code: 4401, reason: "session revoked" }]);

    const vpsSocket = new FakeSocket();
    const vpsHub = new VpsNotificationWebSocketHub(new NotificationConnectionPolicy(resolver));
    expect((await vpsHub.connect(vpsSocket, "session-1")).accepted).toBe(true);

    await vpsHub.publish({ type: "authorization_refresh", user_ids: ["user-1"] });

    expect(vpsSocket.closes).toEqual([{ code: 4401, reason: "session revoked" }]);
    expect(vpsHub.connectionCount).toBe(0);
    await vpsHub.stop();
  });

  it("serializes Cloudflare authorization refreshes so an older result cannot overwrite a newer one", async () => {
    const socket = new FakeSocket();
    socket.serializeAttachment({
      session: snapshot(),
      lastHeartbeatAt: 1,
      lastSessionCheckedAt: 1,
    });
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    let call = 0;
    const resolveMany = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        firstStarted();
        await firstGate;
        return new Map([["session-1", snapshotWithPermissions(["permission:old"])]]);
      }
      return new Map([["session-1", snapshotWithPermissions(["permission:new"])]]);
    });
    const object = new CloudflareNotificationDurableObject({
      getWebSockets: () => [socket] as unknown as WebSocket[],
    } as unknown as DurableObjectState, { DB: {} as D1Database }, new NotificationConnectionPolicy({
      resolve: async () => snapshot(),
      resolveMany,
    }, { now: () => 100 }));
    const request = () => new Request("https://notifications.internal/publish", {
      method: "POST",
      body: JSON.stringify({ type: "authorization_refresh", user_ids: ["user-1"] }),
    });

    const first = object.fetch(request());
    await started;
    const second = object.fetch(request());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(resolveMany).toHaveBeenCalledTimes(1);

    releaseFirst();
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(second).resolves.toMatchObject({ status: 200 });
    expect((socket.attachment as { session: NotificationSessionSnapshot }).session.permissions)
      .toEqual(["permission:new"]);
  });

  it("preserves a heartbeat received while Cloudflare revalidates authorization", async () => {
    const socket = new FakeSocket();
    socket.serializeAttachment({
      session: snapshot(),
      lastHeartbeatAt: 1,
      lastSessionCheckedAt: 1,
    });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revalidationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const policy = new NotificationConnectionPolicy({
      resolve: async () => snapshot(),
      resolveMany: async () => {
        started();
        await gate;
        return new Map([["session-1", snapshotWithPermissions(["permission:new"])]]);
      },
    }, { now: () => 500 });
    const object = new CloudflareNotificationDurableObject({
      getWebSockets: () => [socket] as unknown as WebSocket[],
    } as unknown as DurableObjectState, { DB: {} as D1Database }, policy);

    const refresh = object.fetch(new Request("https://notifications.internal/publish", {
      method: "POST",
      body: JSON.stringify({ type: "authorization_refresh", user_ids: ["user-1"] }),
    }));
    await revalidationStarted;
    object.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({
      type: "heartbeat",
      tab_id: "tab-1",
      seq: 1,
      sent_at: "2026-08-09T00:00:00.000Z",
    }));
    release();
    await refresh;

    expect(socket.attachment).toMatchObject({
      lastHeartbeatAt: 500,
      lastSessionCheckedAt: 500,
      session: { permissions: ["permission:new"] },
    });
  });

  it("does not accept a Durable Object socket when alarm preparation fails", async () => {
    const acceptWebSocket = vi.fn();
    const state = {
      acceptWebSocket,
      getWebSockets: () => [],
      storage: {
        getAlarm: vi.fn().mockRejectedValue(new Error("storage unavailable")),
        setAlarm: vi.fn(),
      },
    } as unknown as DurableObjectState;
    const policy = new NotificationConnectionPolicy({ resolve: async () => snapshot() });
    const object = new CloudflareNotificationDurableObject(state, { DB: {} as D1Database }, policy);

    const response = await object.fetch(new Request("https://notifications.internal/ws", {
      headers: { Upgrade: "websocket", "X-Internal-Notification-Session": "session-1" },
    }));

    expect(response.status).toBe(503);
    expect(acceptWebSocket).not.toHaveBeenCalled();
  });

  it("observes the exact Durable Object WebSocket count", async () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    const state = {
      getWebSockets: () => sockets as unknown as WebSocket[],
    } as unknown as DurableObjectState;
    const policy = new NotificationConnectionPolicy({ resolve: async () => snapshot() });
    const object = new CloudflareNotificationDurableObject(state, { DB: {} as D1Database }, policy);

    const response = await object.fetch(new Request("https://notifications.internal/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      observed_at: expect.any(String),
      connection_count: 2,
    });
  });

  it("resumes bounded session revalidation on later alarms without closing deferred sockets", async () => {
    const now = NOTIFICATION_CONNECTION_POLICY.sessionRevalidationIntervalMs;
    const total = NOTIFICATION_CONNECTION_POLICY.sessionRevalidationsPerSweep + 1;
    const sockets = Array.from({ length: total }, (_, index) => {
      const socket = new FakeSocket();
      const session = snapshotFor(`session-${String(index).padStart(4, "0")}`);
      socket.serializeAttachment({
        session,
        lastHeartbeatAt: now,
        lastSessionCheckedAt: 0,
      });
      return socket;
    });
    const resolve = vi.fn(async (sessionId: string) => snapshotFor(sessionId));
    const policy = new NotificationConnectionPolicy({ resolve }, { now: () => now });
    const setAlarm = vi.fn(async () => undefined);
    const state = {
      getWebSockets: () => sockets as unknown as WebSocket[],
      storage: {
        getAlarm: async () => null,
        setAlarm,
      },
    } as unknown as DurableObjectState;
    const object = new CloudflareNotificationDurableObject(state, { DB: {} as D1Database }, policy);

    await object.alarm();

    expect(resolve).toHaveBeenCalledTimes(NOTIFICATION_CONNECTION_POLICY.sessionRevalidationsPerSweep);
    expect(sockets.filter((socket) => (
      (socket.attachment as { lastSessionCheckedAt: number }).lastSessionCheckedAt === now
    ))).toHaveLength(NOTIFICATION_CONNECTION_POLICY.sessionRevalidationsPerSweep);
    expect(sockets.flatMap((socket) => socket.closes)).toHaveLength(0);
    expect(setAlarm).toHaveBeenCalledWith(now + NOTIFICATION_CONNECTION_POLICY.sweepIntervalMs);

    await object.alarm();

    expect(resolve).toHaveBeenCalledTimes(total);
    expect(sockets.every((socket) => (
      (socket.attachment as { lastSessionCheckedAt: number }).lastSessionCheckedAt === now
    ))).toBe(true);
    expect(sockets.flatMap((socket) => socket.closes)).toHaveLength(0);
    expect(setAlarm).toHaveBeenCalledTimes(2);
  });

  it("reserves VPS quota before HTTP 101 with one-use expiring claims", async () => {
    let now = 1;
    const policy = new NotificationConnectionPolicy({ resolve: async () => snapshot() }, { now: () => now });
    const hub = new VpsNotificationWebSocketHub(policy);
    const claims = await Promise.all(Array.from({ length: 12 }, () => hub.prepareConnection("session-1")));
    expect(claims.every(({ accepted }) => accepted)).toBe(true);
    expect(hub.reservedConnectionCount).toBe(12);
    await expect(hub.prepareConnection("session-1")).resolves.toMatchObject({ accepted: false, status: 429 });

    const first = claims[0];
    const second = claims[1];
    if (!first?.accepted || !second?.accepted) return;
    const socket = new FakeSocket();
    expect(hub.attach(socket, first.claim)).toBe(true);
    expect(hub.attach(new FakeSocket(), first.claim)).toBe(false);
    hub.cancelConnection(second.claim);
    await expect(hub.prepareConnection("session-1")).resolves.toMatchObject({ accepted: true });

    const expiring = claims[2];
    if (!expiring?.accepted) return;
    now = 10_001;
    expect(hub.attach(new FakeSocket(), expiring.claim)).toBe(false);
    await hub.stop();
  });
});
