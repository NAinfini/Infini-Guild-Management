import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  writeAuditLog: vi.fn(),
  writeAuditLogDurable: vi.fn(),
  getSystemTestRunId: vi.fn(),
  isRunOwnedBy: vi.fn(),
  createRun: vi.fn(),
  finalizeRun: vi.fn(),
}));

vi.mock("../middleware/rbac", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("../services/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
  writeAuditLogDurable: mocks.writeAuditLogDurable,
}));

vi.mock("../services/SystemTestService", () => ({
  getSystemTestRunId: mocks.getSystemTestRunId,
  SystemTestService: class {
    isRunOwnedBy = mocks.isRunOwnedBy;
    createRun = mocks.createRun;
    finalizeRun = mocks.finalizeRun;
  },
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

const env = {
  DB: {},
  MEDIA: {},
  SIGNING_SECRET: "test-secret",
};

beforeEach(() => {
  mocks.requirePermission.mockReset();
  mocks.writeAuditLog.mockReset();
  mocks.writeAuditLogDurable.mockReset();
  mocks.getSystemTestRunId.mockReset();
  mocks.isRunOwnedBy.mockReset();
  mocks.createRun.mockReset();
  mocks.finalizeRun.mockReset();
  mocks.getSystemTestRunId.mockReturnValue("run-summary");
  mocks.isRunOwnedBy.mockResolvedValue(true);
});

describe("admin system test audit route", () => {
  it("returns a private cleanup run UID and a separate public fixture UID", async () => {
    const { adminRoutes } = await import("./admin");
    mocks.requirePermission.mockResolvedValueOnce({ id: "admin-1" });
    mocks.createRun.mockResolvedValueOnce("private-run-id");

    const result = await adminRoutes.request("/status/system-test-runs", {
      method: "POST",
    }, env);
    const body = await result.json() as { run_id: string; fixture_id: string };

    expect(result.status).toBe(201);
    expect(body.run_id).toBe("private-run-id");
    expect(body.fixture_id).toEqual(expect.any(String));
    expect(body.fixture_id).not.toBe(body.run_id);
  });

  it("requires admin status view permission", async () => {
    const { adminRoutes } = await import("./admin");
    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));

    const result = await adminRoutes.request("/status/system-test-audit", {
      method: "POST",
      body: JSON.stringify({ total: 0, passed: 0, failed: 0, errors: [] }),
      headers: { "Content-Type": "application/json", "X-System-Test-Run-Id": "run-invalid" },
    }, env);

    expect(result.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "admin.status.view", { freshPermissions: false });
    expect(mocks.writeAuditLogDurable).not.toHaveBeenCalled();
    expect(mocks.finalizeRun).not.toHaveBeenCalled();
  });

  it("rejects invalid summaries without writing audit", async () => {
    const { adminRoutes } = await import("./admin");
    mocks.requirePermission.mockResolvedValueOnce({ id: "admin-1" });

    const result = await adminRoutes.request("/status/system-test-audit", {
      method: "POST",
      body: JSON.stringify({ total: -1, passed: 0, failed: 0, errors: [] }),
      headers: { "Content-Type": "application/json", "X-System-Test-Run-Id": "run-invalid" },
    }, env);
    const body = await result.json();

    expect(result.status).toBe(400);
    expect(body).toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "Invalid system test summary",
    });
    expect(mocks.writeAuditLogDurable).not.toHaveBeenCalled();
    expect(mocks.finalizeRun).not.toHaveBeenCalled();
  });

  it("writes one durable full-run summary with endpoint errors", async () => {
    const { adminRoutes } = await import("./admin");
    mocks.requirePermission.mockResolvedValueOnce({ id: "admin-1" });

    const result = await adminRoutes.request("/status/system-test-audit", {
      method: "POST",
      body: JSON.stringify({
        total: 2,
        passed: 1,
        failed: 1,
        errors: [{
          category: "System",
          label: "Admin Status",
          method: "GET",
          path: "/api/admin/status",
          status: 500,
          error: "500 Internal Server Error",
        }],
      }),
      headers: {
        "Content-Type": "application/json",
        "X-System-Test": "admin-console-api",
        "X-System-Test-Audit": "summary",
        "X-System-Test-Run-Id": "run-summary",
      },
    }, env);
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.writeAuditLogDurable).not.toHaveBeenCalled();
    expect(mocks.finalizeRun).toHaveBeenCalledWith("run-summary", "admin-1", {
      diffTitle: "Full system test: 1/2 passed",
      detailText: JSON.stringify({
        total: 2,
        passed: 1,
        failed: 1,
        errors: [{
          category: "System",
          label: "Admin Status",
          method: "GET",
          path: "/api/admin/status",
          status: 500,
          error: "500 Internal Server Error",
        }],
      }),
    });
  });

  it("finalizes a category run only after exact cleanup completed", async () => {
    const { adminRoutes } = await import("./admin");
    mocks.requirePermission.mockResolvedValueOnce({ id: "admin-1" });

    const result = await adminRoutes.request("/status/system-test-runs/run-category/finalize", {
      method: "POST",
    }, env);

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(mocks.finalizeRun).toHaveBeenCalledWith("run-category", "admin-1");
  });
});
