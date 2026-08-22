import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { describe, expect, it, vi } from "vitest";
import type {
  AdminOperationsRuntimePort,
  AdminOperationsStore,
} from "./model.js";
import { AdminOperationsService } from "./admin-operations-service.js";

const NOW = "2026-08-12T12:00:00.000Z";

function context() {
  return createRequestContext({
    requestId: "request-1",
    now: NOW,
    authorization: createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "administrator",
      roleLevel: 1_000,
      permissions: ["admin.status.view"],
    }),
  });
}

describe("AdminOperationsService", () => {
  it("projects a persisted running job without an active lease as interrupted", async () => {
    const store: AdminOperationsStore = {
      read: vi.fn().mockResolvedValue({
        statuses: [
          {
            name: "media-gc",
            status: "running",
            startedAt: "2026-08-12T11:55:00.000Z",
            finishedAt: null,
            durationMs: null,
            processed: null,
            batches: null,
            hasMore: null,
            backlog: null,
            errorSummary: null,
          },
          {
            name: "session-cleanup",
            status: "lease-held",
            startedAt: "2026-08-12T11:59:30.000Z",
            finishedAt: "2026-08-12T11:59:31.000Z",
            durationMs: 1_000,
            processed: 0,
            batches: 0,
            hasMore: true,
            backlog: {
              status: "unknown",
              pendingCount: null,
              countPrecision: "unknown",
              oldestPendingAt: null,
              reason: "lease-held",
            },
            errorSummary: "stale competing attempt",
          },
        ],
        leases: [{
          name: "session-cleanup",
          acquiredAt: "2026-08-12T11:59:00.000Z",
          expiresAt: "2026-08-12T12:01:00.000Z",
        }],
        usage: {
          mediaByState: [],
          auditLogCount: 0,
          auditArchiveCount: 0,
          auditArchiveBytes: 0,
        },
      }),
    };
    const runtime: AdminOperationsRuntimePort = {
      readRealtime: vi.fn().mockResolvedValue({
        state: "available",
        runtimeSource: "vps-notification-hub",
        observedAt: NOW,
        connectionCount: 0,
      }),
    };
    const service = new AdminOperationsService(store, runtime);

    const value = await service.read(context());

    expect(value.scheduledJobs.find(({ name }) => name === "media-gc")).toMatchObject({
      status: "interrupted",
      lease: { state: "none" },
    });
    expect(value.scheduledJobs.find(({ name }) => name === "session-cleanup")).toMatchObject({
      status: "running",
      startedAt: "2026-08-12T11:59:00.000Z",
      finishedAt: null,
      durationMs: null,
      processed: null,
      backlog: null,
      errorSummary: null,
      lease: { state: "held" },
    });
  });
});
