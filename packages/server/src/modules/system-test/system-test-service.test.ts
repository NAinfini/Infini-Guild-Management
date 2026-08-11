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

    await expect(service.cleanupExpired(NOW, 51)).rejects.toThrow(/between 1 and 50/);
    await expect(service.cleanupExpired(NOW, 50)).resolves.toEqual({ processed: 0, completed: 0, failed: 0 });
    expect(listExpiredRunIds).toHaveBeenCalledWith(NOW, 50);
  });
});
