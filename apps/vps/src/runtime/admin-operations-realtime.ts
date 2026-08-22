import type {
  AdminOperationsRealtimeRead,
  AdminOperationsRuntimePort,
} from "@guild/server/modules/admin-operations";

export class VpsAdminOperationsRuntime implements AdminOperationsRuntimePort {
  constructor(
    private readonly connectionCount: () => number | null,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async readRealtime(): Promise<AdminOperationsRealtimeRead> {
    const observedAt = this.nowIso();
    try {
      const connectionCount = this.connectionCount();
      if (connectionCount === null) return this.unavailable(observedAt);
      if (!Number.isSafeInteger(connectionCount) || connectionCount < 0) {
        throw new TypeError("VPS notification connection count is invalid");
      }
      return {
        state: "available",
        runtimeSource: "vps-notification-hub",
        observedAt,
        connectionCount,
      };
    } catch {
      return this.unavailable(observedAt);
    }
  }

  private unavailable(observedAt: string): AdminOperationsRealtimeRead {
    return {
      state: "unavailable",
      runtimeSource: "vps-notification-hub",
      observedAt,
      connectionCount: null,
    };
  }
}
