import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  writeAuditLog: vi.fn(),
  writeAuditLogDurable: vi.fn(),
}));

vi.mock("../middleware/rbac", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("../services/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
  writeAuditLogDurable: mocks.writeAuditLogDurable,
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
});

describe("admin system test audit route", () => {
  it("requires admin status view permission", async () => {
    const { adminRoutes } = await import("./admin");
    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));

    const result = await adminRoutes.request("/status/system-test-audit", {
      method: "POST",
      body: JSON.stringify({ total: 0, passed: 0, failed: 0, errors: [] }),
      headers: { "Content-Type": "application/json" },
    }, env);

    expect(result.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "admin.status.view", { freshPermissions: false });
    expect(mocks.writeAuditLogDurable).not.toHaveBeenCalled();
  });

  it("rejects invalid summaries without writing audit", async () => {
    const { adminRoutes } = await import("./admin");
    mocks.requirePermission.mockResolvedValueOnce({ id: "admin-1" });

    const result = await adminRoutes.request("/status/system-test-audit", {
      method: "POST",
      body: JSON.stringify({ total: -1, passed: 0, failed: 0, errors: [] }),
      headers: { "Content-Type": "application/json" },
    }, env);
    const body = await result.json();

    expect(result.status).toBe(400);
    expect(body).toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "Invalid system test summary",
    });
    expect(mocks.writeAuditLogDurable).not.toHaveBeenCalled();
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
      },
    }, env);
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.writeAuditLogDurable).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLogDurable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entityType: "system_test",
      action: "run",
      actorId: "admin-1",
      entityId: "admin-console-api",
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
    }));
  });
});
