import { describe, expect, it, vi } from "vitest";
import { writeAuditLog, writeAuditLogDurable } from "../audit";

const dbMock = vi.hoisted(() => ({
  values: vi.fn().mockResolvedValue(undefined),
  insert: vi.fn(() => ({ values: dbMock.values })),
}));

function createContext(headers: Record<string, string> = {}) {
  dbMock.insert.mockClear();
  dbMock.values.mockClear();
  return {
    c: {
      env: { DB: {} },
      req: { header: (key: string) => headers[key] },
      get: vi.fn(),
      executionCtx: { waitUntil: vi.fn() },
    },
  };
}

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => dbMock),
}));

describe("audit log system-test filtering", () => {
  it("suppresses per-endpoint audit writes from Admin Console system tests", async () => {
    const { c } = createContext({
      "X-System-Test": "admin-console-api",
      "X-System-Test-Audit": "suppress",
    });

    await writeAuditLog(c as never, {
      entityType: "event",
      action: "create",
      actorId: "admin-1",
      entityId: "event-1",
    });

    expect(c.executionCtx.waitUntil).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("still writes the durable full system test summary audit entry", async () => {
    const { c } = createContext({
      "X-System-Test": "admin-console-api",
      "X-System-Test-Audit": "summary",
    });

    await writeAuditLogDurable(c as never, {
      entityType: "system_test",
      action: "run",
      actorId: "admin-1",
      entityId: "admin-console-api",
      diffTitle: "Full system test",
    });

    expect(c.executionCtx.waitUntil).not.toHaveBeenCalled();
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(dbMock.values).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "system_test",
      action: "run",
      entityId: "admin-console-api",
    }));
  });
});
