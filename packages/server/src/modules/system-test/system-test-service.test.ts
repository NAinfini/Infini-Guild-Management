import type { BlobStore } from "@guild/kernel";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { describe, expect, it, vi } from "vitest";
import {
  SystemTestService,
  type SystemTestArtifactCleaner,
  type SystemTestStore,
} from "./system-test-service.js";

const NOW = "2026-08-09T12:00:00.000Z";

function context(permissions: readonly string[]) {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId: "admin-1",
      sessionId: "session-1",
      roleId: "admin",
      roleLevel: 900,
      permissions,
    }),
    now: NOW,
  });
}

describe("SystemTestService", () => {
  it("requires status permission before creating a run", async () => {
    const createRun = vi.fn();
    const service = new SystemTestService(
      { createRun } as unknown as SystemTestStore,
      {} as SystemTestArtifactCleaner,
      {} as BlobStore,
    );

    await expect(service.createRun(context([]))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createRun).not.toHaveBeenCalled();
  });

  it("exposes a bounded expired-run cleanup entrypoint", async () => {
    const listExpiredRunIds = vi.fn().mockResolvedValue([]);
    const service = new SystemTestService(
      { listExpiredRunIds } as unknown as SystemTestStore,
      {} as SystemTestArtifactCleaner,
      {} as BlobStore,
    );

    await expect(service.cleanupExpired(NOW, 2)).rejects.toThrow(/between 1 and 1/);
    await expect(service.cleanupExpired(NOW, 1)).resolves.toEqual({ processed: 0, completed: 0, failed: 0 });
    expect(listExpiredRunIds).toHaveBeenCalledWith(NOW, 1);
  });

  it("removes the expired run registry after its artifacts are reclaimed", async () => {
    let status = "running" as "running" | "completed";
    const finalizeRun = vi.fn().mockResolvedValue(true);
    const store = {
      listExpiredRunIds: vi.fn().mockResolvedValue(["run-1"]),
      getRun: vi.fn().mockImplementation(async () => ({
        id: "run-1",
        actorUserId: "admin-1",
        status,
        cleanupAttempts: status === "completed" ? 1 : 0,
      })),
      expireRequests: vi.fn().mockResolvedValue(undefined),
      claimCleanup: vi.fn().mockResolvedValue(true),
      listArtifacts: vi.fn().mockResolvedValue([]),
      completeCleanup: vi.fn().mockImplementation(async () => {
        status = "completed";
        return true;
      }),
      failCleanup: vi.fn().mockResolvedValue(undefined),
      finalizeRun,
    } as unknown as SystemTestStore;
    const artifacts = {
      listBeforeImages: vi.fn().mockResolvedValue([]),
    } as unknown as SystemTestArtifactCleaner;
    const service = new SystemTestService(store, artifacts, {} as BlobStore);

    await expect(service.cleanupExpired(NOW, 1)).resolves.toEqual({
      processed: 1,
      completed: 1,
      failed: 0,
    });
    expect(finalizeRun).toHaveBeenCalledWith({
      runId: "run-1",
      actorUserId: "admin-1",
      audit: null,
    });
  });

  it("records only bounded system-test totals, not endpoint paths or error messages", async () => {
    const finalizeRun = vi.fn().mockResolvedValue(true);
    const service = new SystemTestService(
      {
        getRun: vi.fn().mockResolvedValue({
          id: "run-1",
          actorUserId: "admin-1",
          status: "completed",
          cleanupAttempts: 1,
        }),
        finalizeRun,
      } as unknown as SystemTestStore,
      {} as SystemTestArtifactCleaner,
      {} as BlobStore,
    );

    await service.finalizeRun(context(["admin.status.view"]), "run-1", {
      total: 2,
      passed: 1,
      failed: 1,
      errors: [{
        category: "Authentication",
        label: "Register",
        method: "POST",
        path: "/api/auth/register/secret-code",
        status: 500,
        error: "internal stack detail",
      }],
    });

    const audit = finalizeRun.mock.calls[0]?.[0]?.audit;
    expect(audit?.payload.context).toEqual([
      { field: "total", value: { type: "number", value: 2 } },
      { field: "passed", value: { type: "number", value: 1 } },
      { field: "failed", value: { type: "number", value: 1 } },
    ]);
    expect(JSON.stringify(audit)).not.toContain("secret-code");
    expect(JSON.stringify(audit)).not.toContain("internal stack detail");
  });
});
