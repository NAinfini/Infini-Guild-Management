import {
  heartbeatMessageSchema,
  notificationAuthorizationRefreshSchema,
  pushMessageSchema,
  type NotificationAuthorizationRefresh,
  type PushMessage,
} from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { createAuthorizationContext } from "@guild/kernel";
import type { AuthStore } from "../auth/public.js";
import { canReceiveNotification } from "./notification-service.js";

const SESSION_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const textEncoder = new TextEncoder();

export const NOTIFICATION_CONNECTION_POLICY = Object.freeze({
  heartbeatTimeoutMs: 90_000,
  sweepIntervalMs: 60_000,
  sessionRevalidationIntervalMs: 5 * 60_000,
  // Five one-minute rounds cover the 1,500-connection ceiling. Production
  // session resolvers hydrate each round through one JSON-batched SQL query.
  sessionRevalidationsPerSweep: 300,
  sessionRevalidationConcurrency: 6,
  maxConnections: LIMITS.websocket.maxConnections,
  maxConnectionsPerUser: LIMITS.websocket.connectionsPerAccount,
  maxClientMessageBytes: 4_096,
  closeCodes: Object.freeze({
    heartbeatTimeout: 4001,
    unauthorized: 4401,
    unsupportedData: 1003,
    messageTooLarge: 1009,
    internalError: 1011,
  }),
} as const);

export const INTERNAL_NOTIFICATION_SESSION_HEADER = "X-Internal-Notification-Session";

export type NotificationSessionSnapshot = Readonly<{
  sessionId: string;
  userId: string;
  roleId: string;
  roleLevel: number;
  permissions: readonly string[];
}>;

export type NotificationConnectionState = Readonly<{
  session: NotificationSessionSnapshot;
  lastHeartbeatAt: number;
  lastSessionCheckedAt: number;
}>;

export interface NotificationSessionResolver {
  resolve(sessionId: string, now: string): Promise<NotificationSessionSnapshot | null>;
  resolveMany?(
    sessionIds: readonly string[],
    now: string,
  ): Promise<ReadonlyMap<string, NotificationSessionSnapshot | null>>;
}

export type NotificationAdmission =
  | Readonly<{ accepted: true; state: NotificationConnectionState }>
  | Readonly<{
      accepted: false;
      status: 401 | 429 | 503;
      reason: "session revoked" | "too many connections" | "too many connections for this user";
    }>;

export type NotificationClientMessageDecision = Readonly<{
  state: NotificationConnectionState;
  send?: string;
  close?: Readonly<{ code: number; reason: string }>;
}>;

export type NotificationSweepDecision =
  | Readonly<{ state: NotificationConnectionState }>
  | Readonly<{ close: Readonly<{ code: number; reason: string }> }>;

type SessionRevalidationResult =
  | Readonly<{ resolved: true; session: NotificationSessionSnapshot | null }>
  | Readonly<{ resolved: false }>;

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function isSessionSnapshot(value: unknown): value is NotificationSessionSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === "string"
    && record.sessionId.length > 0
    && record.sessionId.length <= 256
    && typeof record.userId === "string"
    && record.userId.length > 0
    && record.userId.length <= 200
    && typeof record.roleId === "string"
    && record.roleId.length > 0
    && record.roleId.length <= 200
    && typeof record.roleLevel === "number"
    && Number.isSafeInteger(record.roleLevel)
    && record.roleLevel >= 0
    && Array.isArray(record.permissions)
    && record.permissions.length <= 256
    && record.permissions.every((permission) => typeof permission === "string" && permission.length > 0 && permission.length <= 200);
}

export function restoreNotificationConnectionState(value: unknown): NotificationConnectionState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !isSessionSnapshot(record.session)
    || typeof record.lastHeartbeatAt !== "number"
    || !Number.isSafeInteger(record.lastHeartbeatAt)
    || record.lastHeartbeatAt < 0
    || typeof record.lastSessionCheckedAt !== "number"
    || !Number.isSafeInteger(record.lastSessionCheckedAt)
    || record.lastSessionCheckedAt < 0
  ) {
    return null;
  }
  return {
    session: record.session,
    lastHeartbeatAt: record.lastHeartbeatAt,
    lastSessionCheckedAt: record.lastSessionCheckedAt,
  };
}

/** Revalidates hashed session ids without renewing them or fabricating an HTTP actor. */
export class AuthStoreNotificationSessionResolver implements NotificationSessionResolver {
  constructor(private readonly store: Pick<AuthStore, "findSessionAuthorization" | "findSessionAuthorizations">) {}

  async resolve(sessionId: string, now: string): Promise<NotificationSessionSnapshot | null> {
    return sessionSnapshot(await this.store.findSessionAuthorization(sessionId), timestamp(now));
  }

  async resolveMany(
    sessionIds: readonly string[],
    now: string,
  ): Promise<ReadonlyMap<string, NotificationSessionSnapshot | null>> {
    const nowMs = timestamp(now);
    const records = this.store.findSessionAuthorizations
      ? await this.store.findSessionAuthorizations(sessionIds)
      : new Map(await Promise.all(sessionIds.map(async (sessionId) => [
          sessionId,
          await this.store.findSessionAuthorization(sessionId),
        ] as const)));
    return new Map(sessionIds.map((sessionId) => [
      sessionId,
      sessionSnapshot(records.get(sessionId) ?? null, nowMs),
    ]));
  }
}

function sessionSnapshot(
  record: Awaited<ReturnType<AuthStore["findSessionAuthorization"]>>,
  nowMs: number,
): NotificationSessionSnapshot | null {
  if (
    !record
    || !record.isActive
    || record.deletedAt !== null
    || timestamp(record.expiresAt) <= nowMs
    || nowMs - timestamp(record.sessionCreatedAt) > SESSION_ABSOLUTE_TTL_MS
  ) {
    return null;
  }
  return Object.freeze({
    sessionId: record.tokenDigest,
    userId: record.id,
    roleId: record.roleId,
    roleLevel: record.roleLevel,
    permissions: Object.freeze([...record.permissions]),
  });
}

export class NotificationConnectionPolicy {
  private readonly now: () => number;

  constructor(
    private readonly sessions: NotificationSessionResolver,
    options: Readonly<{ now?: () => number }> = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  nowMs(): number {
    return this.now();
  }

  async resolveSession(sessionIdInput: string, nowMs = this.now()): Promise<NotificationSessionSnapshot | null> {
    const sessionId = sessionIdInput.trim();
    if (!sessionId || sessionId.length > 256 || !Number.isSafeInteger(nowMs) || nowMs < 0) return null;
    const session = await this.sessions.resolve(sessionId, new Date(nowMs).toISOString());
    return isSessionSnapshot(session) && session.sessionId === sessionId ? session : null;
  }

  admit(
    session: NotificationSessionSnapshot | null,
    active: readonly NotificationConnectionState[],
    totalConnections = active.length,
    nowMs = this.now(),
  ): NotificationAdmission {
    if (!session) return { accepted: false, status: 401, reason: "session revoked" };
    if (!Number.isSafeInteger(totalConnections) || totalConnections < active.length) {
      throw new TypeError("WebSocket connection count is invalid");
    }
    if (totalConnections >= NOTIFICATION_CONNECTION_POLICY.maxConnections) {
      return { accepted: false, status: 503, reason: "too many connections" };
    }
    const userConnections = active.reduce(
      (count, connection) => count + (connection.session.userId === session.userId ? 1 : 0),
      0,
    );
    if (userConnections >= NOTIFICATION_CONNECTION_POLICY.maxConnectionsPerUser) {
      return { accepted: false, status: 429, reason: "too many connections for this user" };
    }
    return {
      accepted: true,
      state: Object.freeze({
        session,
        lastHeartbeatAt: nowMs,
        lastSessionCheckedAt: nowMs,
      }),
    };
  }

  handleClientMessage(
    state: NotificationConnectionState,
    message: string | null,
    connections: number,
    nowMs = this.now(),
  ): NotificationClientMessageDecision {
    if (message === null) {
      return {
        state,
        close: { code: NOTIFICATION_CONNECTION_POLICY.closeCodes.unsupportedData, reason: "text messages required" },
      };
    }
    if (textEncoder.encode(message).byteLength > NOTIFICATION_CONNECTION_POLICY.maxClientMessageBytes) {
      return {
        state,
        close: { code: NOTIFICATION_CONNECTION_POLICY.closeCodes.messageTooLarge, reason: "message too large" },
      };
    }
    let input: unknown;
    try {
      input = JSON.parse(message) as unknown;
    } catch {
      return { state };
    }
    const heartbeat = heartbeatMessageSchema.safeParse(input);
    if (!heartbeat.success) return { state };
    if (!Number.isSafeInteger(connections) || connections < 1) {
      throw new TypeError("WebSocket connection count must be a positive safe integer");
    }
    const next = Object.freeze({ ...state, lastHeartbeatAt: nowMs });
    return {
      state: next,
      send: JSON.stringify({
        type: "heartbeat_ack",
        tab_id: heartbeat.data.tab_id,
        seq: heartbeat.data.seq,
        server_at: new Date(nowMs).toISOString(),
        connections,
      }),
    };
  }

  async sweep(
    states: readonly NotificationConnectionState[],
    nowMs = this.now(),
  ): Promise<readonly NotificationSweepDecision[]> {
    const candidates = new Map<string, number>();
    for (const state of states) {
      if (nowMs - state.lastHeartbeatAt >= NOTIFICATION_CONNECTION_POLICY.heartbeatTimeoutMs) continue;
      if (nowMs - state.lastSessionCheckedAt < NOTIFICATION_CONNECTION_POLICY.sessionRevalidationIntervalMs) continue;
      const current = candidates.get(state.session.sessionId);
      if (current === undefined || state.lastSessionCheckedAt < current) {
        candidates.set(state.session.sessionId, state.lastSessionCheckedAt);
      }
    }

    const sessions = [...candidates.entries()]
      .sort(([leftId, leftCheckedAt], [rightId, rightCheckedAt]) => (
        leftCheckedAt - rightCheckedAt || leftId.localeCompare(rightId)
      ))
      .slice(0, NOTIFICATION_CONNECTION_POLICY.sessionRevalidationsPerSweep)
      .map(([sessionId]) => sessionId);
    const results = await this.revalidateSessions(sessions, nowMs);

    return states.map((state): NotificationSweepDecision => {
      if (nowMs - state.lastHeartbeatAt >= NOTIFICATION_CONNECTION_POLICY.heartbeatTimeoutMs) {
        return {
          close: {
            code: NOTIFICATION_CONNECTION_POLICY.closeCodes.heartbeatTimeout,
            reason: "heartbeat timeout",
          },
        };
      }
      if (nowMs - state.lastSessionCheckedAt < NOTIFICATION_CONNECTION_POLICY.sessionRevalidationIntervalMs) {
        return { state };
      }
      const result = results.get(state.session.sessionId);
      if (!result) return { state };
      if (!result.resolved) {
        return {
          close: {
            code: NOTIFICATION_CONNECTION_POLICY.closeCodes.internalError,
            reason: "session revalidation failed",
          },
        };
      }
      if (!result.session || result.session.userId !== state.session.userId) {
        return {
          close: {
            code: NOTIFICATION_CONNECTION_POLICY.closeCodes.unauthorized,
            reason: "session revoked",
          },
        };
      }
      return {
        state: Object.freeze({
          ...state,
          session: result.session,
          lastSessionCheckedAt: nowMs,
        }),
      };
    });
  }

  async refreshAuthorization(
    states: readonly NotificationConnectionState[],
    nowMs = this.now(),
  ): Promise<readonly NotificationSweepDecision[]> {
    const sessionIds = [...new Set(states.map((state) => state.session.sessionId))];
    const results = await this.revalidateSessions(sessionIds, nowMs);
    return states.map((state): NotificationSweepDecision => {
      const result = results.get(state.session.sessionId);
      if (!result?.resolved) {
        return {
          close: {
            code: NOTIFICATION_CONNECTION_POLICY.closeCodes.internalError,
            reason: "session revalidation failed",
          },
        };
      }
      if (!result.session || result.session.userId !== state.session.userId) {
        return {
          close: {
            code: NOTIFICATION_CONNECTION_POLICY.closeCodes.unauthorized,
            reason: "session revoked",
          },
        };
      }
      return {
        state: Object.freeze({
          ...state,
          session: result.session,
          lastSessionCheckedAt: nowMs,
        }),
      };
    });
  }

  private async revalidateSessions(
    sessionIds: readonly string[],
    nowMs: number,
  ): Promise<ReadonlyMap<string, SessionRevalidationResult>> {
    const results = new Map<string, SessionRevalidationResult>();
    if (sessionIds.length === 0) return results;
    if (this.sessions.resolveMany) {
      try {
        const resolved = await this.sessions.resolveMany(sessionIds, new Date(nowMs).toISOString());
        for (const sessionId of sessionIds) {
          results.set(sessionId, { resolved: true, session: resolved.get(sessionId) ?? null });
        }
      } catch {
        for (const sessionId of sessionIds) results.set(sessionId, { resolved: false });
      }
      return results;
    }
    const concurrency = NOTIFICATION_CONNECTION_POLICY.sessionRevalidationConcurrency;
    for (let start = 0; start < sessionIds.length; start += concurrency) {
      const batch = await Promise.all(sessionIds.slice(start, start + concurrency).map(async (sessionId) => {
        try {
          return [sessionId, {
            resolved: true,
            session: await this.resolveSession(sessionId, nowMs),
          }] as const;
        } catch {
          return [sessionId, { resolved: false }] as const;
        }
      }));
      for (const [sessionId, result] of batch) results.set(sessionId, result);
    }
    return results;
  }

  parseOutbound(message: unknown): PushMessage {
    return pushMessageSchema.parse(message);
  }

  parseAuthorizationRefresh(message: unknown): NotificationAuthorizationRefresh | null {
    if (
      typeof message !== "object"
      || message === null
      || Array.isArray(message)
      || (message as { type?: unknown }).type !== "authorization_refresh"
    ) {
      return null;
    }
    return notificationAuthorizationRefreshSchema.parse(message);
  }

  matchesAuthorizationRefresh(
    state: NotificationConnectionState,
    refresh: NotificationAuthorizationRefresh,
  ): boolean {
    return refresh.session_ids?.includes(state.session.sessionId) === true
      || refresh.user_ids?.includes(state.session.userId) === true
      || refresh.role_ids?.includes(state.session.roleId) === true;
  }

  canDeliver(state: NotificationConnectionState, message: PushMessage): boolean {
    return canReceiveNotification(createAuthorizationContext({
      userId: state.session.userId,
      sessionId: state.session.sessionId,
      roleId: state.session.roleId,
      roleLevel: state.session.roleLevel,
      permissions: state.session.permissions,
    }), message);
  }
}
