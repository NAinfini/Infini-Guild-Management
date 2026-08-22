import type {
  AdminOperationsRealtimeRead,
  AdminOperationsRuntimePort,
} from "@guild/server/modules/admin-operations";

export type CloudflareAdminOperationsTarget = Readonly<{
  fetch(input: string, init: RequestInit): Promise<Response>;
}>;

export class CloudflareAdminOperationsRuntime implements AdminOperationsRuntimePort {
  constructor(
    private readonly target: CloudflareAdminOperationsTarget,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readRealtime(): Promise<AdminOperationsRealtimeRead> {
    try {
      const response = await this.target.fetch("https://notifications.internal/status", { method: "GET" });
      if (!response.ok) throw new Error(`Notification status returned HTTP ${response.status}`);
      const value = await response.json() as unknown;
      if (!isRecord(value)) throw new TypeError("Notification status response is invalid");
      const observedAt = value.observed_at;
      const connectionCount = value.connection_count;
      if (typeof observedAt !== "string" || !isIso(observedAt) || !isCount(connectionCount)) {
        throw new TypeError("Notification status response is invalid");
      }
      return {
        state: "available",
        runtimeSource: "cloudflare-notifications-do",
        observedAt,
        connectionCount,
      };
    } catch {
      return {
        state: "unavailable",
        runtimeSource: "cloudflare-notifications-do",
        observedAt: nowIso(this.now()),
        connectionCount: null,
      };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function nowIso(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new TypeError("Realtime status clock returned an invalid date");
  return value.toISOString();
}
