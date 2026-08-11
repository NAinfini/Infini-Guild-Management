import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { AuditService, createAuditMutation, type AuditStore } from "./audit";

function context(permissions: readonly string[] = []) {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions: new Set(permissions),
    }),
    now: "2026-08-09T00:00:00.000Z",
  });
}

describe("audit boundary", () => {
  it("captures the verified actor and a bounded JSON detail object", () => {
    const mutation = createAuditMutation(context(), {
      entityType: "announcement",
      entityId: " announcement-1 ",
      action: "create",
      details: { title: "Launch" },
    });

    expect(mutation).toMatchObject({
      requestId: "request-1",
      actorUserId: "user-1",
      entityId: "announcement-1",
      occurredAt: "2026-08-09T00:00:00.000Z",
      details: { title: "Launch" },
    });
  });

  it("does not let audit read and export permissions substitute for each other", async () => {
    const store: AuditStore = {
      list: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, total_pages: 0 }),
      export: vi.fn(),
      recordExport: vi.fn(),
    };
    const service = new AuditService(store);

    await service.list(context(["admin.audit.view"]), { page: 1, limit: 25 });
    expect(() => service.export(context(["admin.audit.view"]), {})).toThrowError(/permission/i);
  });

  it("records the export actor, format, and normalized filters before streaming", async () => {
    const recordExport = vi.fn().mockResolvedValue(undefined);
    const store: AuditStore = {
      list: vi.fn(),
      export: vi.fn(),
      recordExport,
    };
    const service = new AuditService(store);
    const query = {
      entityType: "event" as const,
      startAt: "2026-08-01T00:00:00.000Z",
      endAt: "2026-08-09T00:00:00.000Z",
    };

    await service.recordExport(context(["admin.audit.export"]), "csv", query);

    expect(recordExport).toHaveBeenCalledOnce();
    expect(recordExport.mock.calls[0]?.[0]).toMatchObject({
      requestId: "request-1",
      actorUserId: "user-1",
      entityType: "audit_log_export",
      entityId: "request-1",
      action: "export_filtered_csv",
      details: query,
    });
  });
});
