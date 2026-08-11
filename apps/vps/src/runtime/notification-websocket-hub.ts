import type {
  AuthorizationContext,
  NotificationMessage,
  NotificationPublisher,
} from "@guild/kernel";
import {
  NOTIFICATION_CONNECTION_POLICY,
  NotificationConnectionPolicy,
  type NotificationAdmission,
  type NotificationConnectionState,
} from "@guild/server";

const CONNECTION_CLAIM_TTL_MS = 10_000;

export type VpsNotificationSocket = Readonly<{
  send(payload: string): void;
  close(code: number, reason: string): void;
}>;

export type VpsNotificationHubOptions = Readonly<{
  onError?: (error: unknown) => void | Promise<void>;
}>;

export type VpsNotificationConnectionClaim = Readonly<{ id: string }>;

export type VpsNotificationConnectionPreparation =
  | Readonly<{ accepted: true; claim: VpsNotificationConnectionClaim }>
  | Exclude<NotificationAdmission, Readonly<{ accepted: true; state: NotificationConnectionState }>>;

export function prepareAuthenticatedVpsNotificationConnection(
  hub: VpsNotificationWebSocketHub,
  authorization: AuthorizationContext,
): Promise<VpsNotificationConnectionPreparation> {
  return hub.prepareConnection(authorization.requireAuthenticated().sessionId);
}

export async function connectAuthenticatedVpsNotificationSocket(
  hub: VpsNotificationWebSocketHub,
  socket: VpsNotificationSocket,
  authorization: AuthorizationContext,
): Promise<NotificationAdmission> {
  return hub.connect(socket, authorization.requireAuthenticated().sessionId);
}

export class VpsNotificationWebSocketHub implements NotificationPublisher {
  private readonly connections = new Map<VpsNotificationSocket, NotificationConnectionState>();
  private readonly pendingClaims = new Map<string, Readonly<{
    state: NotificationConnectionState;
    expiresAt: number;
  }>>();
  private readonly onError: (error: unknown) => void | Promise<void>;
  private admissionTail: Promise<void> = Promise.resolve();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private sweepPromise: Promise<void> | null = null;
  private accepting = true;

  constructor(
    private readonly policy: NotificationConnectionPolicy,
    options: VpsNotificationHubOptions = {},
  ) {
    this.onError = options.onError ?? ((error) => console.error("Notification WebSocket hub failed", error));
  }

  start(): void {
    if (this.sweepTimer !== null) return;
    if (!this.accepting) throw new Error("Notification WebSocket hub has stopped");
    this.sweepTimer = setInterval(() => {
      void this.sweep().catch((error: unknown) => this.report(error));
    }, NOTIFICATION_CONNECTION_POLICY.sweepIntervalMs);
    (this.sweepTimer as { unref?: () => void }).unref?.();
  }

  async connect(socket: VpsNotificationSocket, sessionId: string): Promise<NotificationAdmission> {
    if (this.connections.has(socket)) throw new TypeError("WebSocket is already connected");
    const prepared = await this.prepareConnection(sessionId);
    if (!prepared.accepted) return prepared;
    if (!this.attach(socket, prepared.claim)) {
      throw new Error("Notification WebSocket connection claim expired before attachment");
    }
    const state = this.connections.get(socket);
    if (!state) throw new Error("Notification WebSocket attachment failed");
    return { accepted: true, state };
  }

  async prepareConnection(sessionId: string): Promise<VpsNotificationConnectionPreparation> {
    const session = await this.policy.resolveSession(sessionId);
    return this.withAdmissionLock(() => {
      if (!this.accepting) throw new Error("Notification WebSocket hub is stopping");
      this.pruneExpiredClaims();
      const active = [
        ...this.connections.values(),
        ...[...this.pendingClaims.values()].map(({ state }) => state),
      ];
      const admission = this.policy.admit(session, active);
      if (!admission.accepted) return admission;
      const claim = Object.freeze({ id: crypto.randomUUID() });
      this.pendingClaims.set(claim.id, {
        state: admission.state,
        expiresAt: this.policy.nowMs() + CONNECTION_CLAIM_TTL_MS,
      });
      return { accepted: true, claim };
    });
  }

  attach(socket: VpsNotificationSocket, claim: VpsNotificationConnectionClaim): boolean {
    if (!this.accepting || this.connections.has(socket)) return false;
    const pending = this.pendingClaims.get(claim.id);
    if (!pending) return false;
    this.pendingClaims.delete(claim.id);
    if (pending.expiresAt <= this.policy.nowMs()) return false;
    this.connections.set(socket, pending.state);
    return true;
  }

  cancelConnection(claim: VpsNotificationConnectionClaim): void {
    this.pendingClaims.delete(claim.id);
  }

  receive(socket: VpsNotificationSocket, data: string | Uint8Array | ArrayBuffer): void {
    const connection = this.connections.get(socket);
    if (!connection) return;
    const decision = this.policy.handleClientMessage(
      connection,
      typeof data === "string" ? data : null,
      this.connections.size,
    );
    if (decision.close) {
      this.close(socket, decision.close.code, decision.close.reason);
      return;
    }
    this.connections.set(socket, decision.state);
    if (decision.send) this.send(socket, decision.send);
  }

  disconnect(socket: VpsNotificationSocket): void {
    this.connections.delete(socket);
  }

  async publish(input: NotificationMessage): Promise<void> {
    const message = this.policy.parseOutbound(input);
    const payload = JSON.stringify(message);
    for (const [socket, connection] of [...this.connections]) {
      if (this.policy.canDeliver(connection, message)) this.send(socket, payload);
    }
  }

  sweep(): Promise<void> {
    if (this.sweepPromise) return this.sweepPromise;
    const entries = [...this.connections.entries()];
    const operation = this.policy.sweep(entries.map(([, connection]) => connection))
      .then((decisions) => {
        decisions.forEach((decision, index) => {
          const entry = entries[index];
          if (!entry) return;
          const [socket, original] = entry;
          if (this.connections.get(socket) !== original) return;
          if ("close" in decision) {
            this.close(socket, decision.close.code, decision.close.reason);
          } else {
            this.connections.set(socket, decision.state);
          }
        });
      });
    this.sweepPromise = operation.finally(() => {
      this.sweepPromise = null;
    });
    return this.sweepPromise;
  }

  async stop(): Promise<void> {
    this.accepting = false;
    this.pendingClaims.clear();
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    await this.admissionTail;
    if (this.sweepPromise) await this.sweepPromise;
    for (const socket of [...this.connections.keys()]) this.close(socket, 1001, "server shutting down");
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  get reservedConnectionCount(): number {
    this.pruneExpiredClaims();
    return this.connections.size + this.pendingClaims.size;
  }

  private async withAdmissionLock<T>(operation: () => T): Promise<T> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.admissionTail;
    this.admissionTail = previous.then(() => turn, () => turn);
    await previous;
    try {
      return operation();
    } finally {
      release();
    }
  }

  private send(socket: VpsNotificationSocket, payload: string): void {
    try {
      socket.send(payload);
    } catch {
      this.close(socket, NOTIFICATION_CONNECTION_POLICY.closeCodes.internalError, "websocket send failed");
    }
  }

  private pruneExpiredClaims(): void {
    const now = this.policy.nowMs();
    for (const [id, claim] of this.pendingClaims) {
      if (claim.expiresAt <= now) this.pendingClaims.delete(id);
    }
  }

  private close(socket: VpsNotificationSocket, code: number, reason: string): void {
    this.connections.delete(socket);
    try {
      socket.close(code, reason);
    } catch {
      // The socket is already unusable; removing it is the required cleanup.
    }
  }

  private async report(error: unknown): Promise<void> {
    try {
      await this.onError(error);
    } catch (reportError) {
      console.error("Notification WebSocket error reporter failed", reportError, { originalError: error });
    }
  }
}
