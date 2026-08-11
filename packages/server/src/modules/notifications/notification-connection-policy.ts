import {
  heartbeatMessageSchema,
  pushMessageSchema,
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
  constructor(private readonly store: Pick<AuthStore, "findSessionAuthorization">) {}

  async resolve(sessionId: string, now: string): Promise<NotificationSessionSnapshot | null> {
    const record = await this.store.findSessionAuthorization(sessionId);
    const nowMs = timestamp(now);
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
    const resolved = new Map<string, Promise<NotificationSessionSnapshot | null>>();
    return Promise.all(states.map(async (state): Promise<NotificationSweepDecision> => {
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
      let check = resolved.get(state.session.sessionId);
      if (!check) {
        check = this.resolveSession(state.session.sessionId, nowMs);
        resolved.set(state.session.sessionId, check);
      }
      let session: NotificationSessionSnapshot | null;
      try {
        session = await check;
      } catch {
        return {
          close: {
            code: NOTIFICATION_CONNECTION_POLICY.closeCodes.internalError,
            reason: "session revalidation failed",
          },
        };
      }
      if (!session || session.userId !== state.session.userId) {
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
          session,
          lastSessionCheckedAt: nowMs,
        }),
      };
    }));
  }

  parseOutbound(message: unknown): PushMessage {
    return pushMessageSchema.parse(message);
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
