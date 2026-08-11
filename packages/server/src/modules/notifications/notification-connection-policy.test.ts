import { describe, expect, it, vi } from "vitest";
import {
  AuthStoreNotificationSessionResolver,
  NOTIFICATION_CONNECTION_POLICY,
  NotificationConnectionPolicy,
  type NotificationConnectionState,
  type NotificationSessionSnapshot,
} from "./notification-connection-policy.js";

function session(userId = "user-1", permissions: readonly string[] = []): NotificationSessionSnapshot {
  return {
    sessionId: `session-${userId}`,
    userId,
    roleId: "member",
    roleLevel: 100,
    permissions,
  };
}

function state(snapshot: NotificationSessionSnapshot, now = 1_000): NotificationConnectionState {
  return { session: snapshot, lastHeartbeatAt: now, lastSessionCheckedAt: now };
}

describe("NotificationConnectionPolicy", () => {
  it("enforces the shared global and per-user ceilings", () => {
    const policy = new NotificationConnectionPolicy({ resolve: vi.fn() });
    const user = session();
    const sameUser = Array.from(
      { length: NOTIFICATION_CONNECTION_POLICY.maxConnectionsPerUser },
      () => state(user),
    );
    expect(policy.admit(user, sameUser)).toMatchObject({
      accepted: false,
      status: 429,
      reason: "too many connections for this user",
    });
    expect(policy.admit(session("user-2"), sameUser)).toMatchObject({ accepted: true });
    expect(policy.admit(session("user-3"), [], NOTIFICATION_CONNECTION_POLICY.maxConnections)).toEqual({
      accepted: false,
      status: 503,
      reason: "too many connections",
    });
  });

  it("acks only valid bounded heartbeats and closes stale or revoked sessions", async () => {
    let valid = true;
    let now = 1_000;
    const resolve = vi.fn(async (sessionId: string) => valid ? session(sessionId.replace("session-", "")) : null);
    const policy = new NotificationConnectionPolicy({ resolve }, { now: () => now });
    const admitted = policy.admit(await policy.resolveSession("session-user-1"), [], 0, now);
    expect(admitted.accepted).toBe(true);
    if (!admitted.accepted) return;

    now = 25_000;
    const beat = policy.handleClientMessage(admitted.state, JSON.stringify({
      type: "heartbeat",
      tab_id: "tab-1",
      seq: 3,
      sent_at: "2026-08-09T00:00:00.000Z",
    }), 1);
    expect(JSON.parse(beat.send ?? "null")).toMatchObject({
      type: "heartbeat_ack",
      tab_id: "tab-1",
      seq: 3,
      connections: 1,
    });
    expect(policy.handleClientMessage(beat.state, "not json", 1).send).toBeUndefined();
    expect(policy.handleClientMessage(beat.state, "x".repeat(4_097), 1).close?.code).toBe(1009);

    now = 25_000 + NOTIFICATION_CONNECTION_POLICY.heartbeatTimeoutMs;
    expect(await policy.sweep([beat.state])).toEqual([{
      close: { code: 4001, reason: "heartbeat timeout" },
    }]);

    valid = false;
    now = 1_000 + NOTIFICATION_CONNECTION_POLICY.sessionRevalidationIntervalMs;
    const freshHeartbeat = { ...beat.state, lastHeartbeatAt: now };
    expect(await policy.sweep([freshHeartbeat])).toEqual([{
      close: { code: 4401, reason: "session revoked" },
    }]);
  });

  it("revalidates a shared session once and applies its current permissions to hints", async () => {
    const updated = session("user-1", ["admin.badges.manage"]);
    const resolve = vi.fn(async () => updated);
    const policy = new NotificationConnectionPolicy({ resolve });
    const due = {
      ...state(session()),
      lastHeartbeatAt: NOTIFICATION_CONNECTION_POLICY.sessionRevalidationIntervalMs,
      lastSessionCheckedAt: 0,
    };
    const decisions = await policy.sweep([due, due], NOTIFICATION_CONNECTION_POLICY.sessionRevalidationIntervalMs);
    expect(resolve).toHaveBeenCalledOnce();
    const refreshed = decisions[0];
    expect(refreshed && "state" in refreshed).toBe(true);
    if (!refreshed || !("state" in refreshed)) return;
    const restricted = policy.parseOutbound({
      type: "entity_changed",
      entity_type: "member_badge",
      entity_id: "badge-1",
      updated_at: "2026-08-09T00:00:00.000Z",
      hint: "badge_assigned",
    });
    expect(policy.canDeliver(state(session()), restricted)).toBe(false);
    expect(policy.canDeliver(refreshed.state, restricted)).toBe(true);
  });

  it("validates active-session facts without renewing the session", async () => {
    const record = {
      id: "user-1",
      tokenDigest: "session-user-1",
      roleId: "member",
      roleLevel: 100,
      permissions: new Set<string>(),
      isActive: true,
      deletedAt: null,
      expiresAt: "2026-09-01T00:00:00.000Z",
      sessionCreatedAt: "2026-08-01T00:00:00.000Z",
    };
    const findSessionAuthorization = vi.fn().mockResolvedValue(record);
    const resolver = new AuthStoreNotificationSessionResolver({ findSessionAuthorization } as never);
    expect(await resolver.resolve("session-user-1", "2026-08-09T00:00:00.000Z")).toMatchObject({
      sessionId: "session-user-1",
      userId: "user-1",
    });
    findSessionAuthorization.mockResolvedValue({ ...record, isActive: false });
    expect(await resolver.resolve("session-user-1", "2026-08-09T00:00:00.000Z")).toBeNull();
  });
});
