import { describe, expect, it, vi } from "vitest";
import {
  buildAuditLogInsertStatement,
  buildAuditLogStatements,
  writeAuditLog,
  writeAuditLogDurable,
} from "../audit";

const dbMock = vi.hoisted(() => ({
  values: vi.fn().mockResolvedValue(undefined),
  insert: vi.fn(() => ({ values: dbMock.values })),
  batch: vi.fn(),
  bind: vi.fn((..._bindings: unknown[]) => ({})),
  prepare: vi.fn(() => ({ bind: dbMock.bind })),
}));

function createContext(headers: Record<string, string> = {}) {
  dbMock.insert.mockClear();
  dbMock.values.mockClear();
  dbMock.batch.mockReset().mockResolvedValue([
    { meta: { changes: 1 } },
    { meta: { changes: 1 } },
  ]);
  dbMock.prepare.mockClear();
  dbMock.bind.mockClear();
  return {
    c: {
      env: { DB: dbMock },
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
  it("builds a complete raw insert from the shared audit value boundary", () => {
    const { c } = createContext();

    const result = buildAuditLogInsertStatement(c.env.DB as never, {
      entityType: "storage_transaction",
      action: "intake",
      actorId: "admin-1",
      entityId: "batch-1",
      diffTitle: "Batch intake (1)",
      detail: { batch_id: "batch-1" },
    }, { id: "audit-1", createdAt: "2026-05-22T00:00:00.000Z" });

    expect(result.id).toBe("audit-1");
    expect(dbMock.prepare).toHaveBeenCalledWith(expect.stringMatching(
      /detail_text, created_at[\s\S]*VALUES \(\?, \?, \?, \?, \?, \?, \?, \?\)/,
    ));
    expect(dbMock.bind).toHaveBeenCalledWith(
      "audit-1",
      "storage_transaction",
      "intake",
      "admin-1",
      "batch-1",
      "Batch intake (1)",
      '{"batch_id":"batch-1"}',
      "2026-05-22T00:00:00.000Z",
    );
  });

  it("builds a guarded durable statement without executing it", () => {
    const { c } = createContext();

    const statements = buildAuditLogStatements(c as never, {
      entityType: "class_catalog",
      action: "update",
      actorId: "admin-1",
      entityId: "warden",
      detail: { changed: true },
    }, {
      sql: "EXISTS (SELECT 1 FROM class_catalog WHERE id = ?)",
      bindings: ["warden"],
    });

    expect(statements).toHaveLength(1);
    expect(dbMock.batch).not.toHaveBeenCalled();
    expect(dbMock.prepare).toHaveBeenCalledWith(expect.stringMatching(
      /INSERT INTO audit_log[\s\S]*WHERE EXISTS \(SELECT 1 FROM class_catalog WHERE id = \?\)/,
    ));
    expect(dbMock.bind.mock.calls[0]?.[6]).toBe('{"changed":true}');
  });

  it("does not let client-controlled system-test headers suppress audit writes", async () => {
    const { c } = createContext({
      "X-System-Test": "admin-console-api",
      "X-System-Test-Audit": "suppress",
    });

    await writeAuditLog(c as never, {
      entityType: "event",
      action: "create",
      actorId: "admin-1",
      entityId: "event-1",
      detail: { count: 2 },
    });

    expect(c.executionCtx.waitUntil).toHaveBeenCalledTimes(1);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(dbMock.values).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "event",
      action: "create",
      actorId: "admin-1",
      entityId: "event-1",
      detailText: '{"count":2}',
    }));
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

  it("atomically registers durable audit rows for a validated system-test run", async () => {
    const { c } = createContext();
    c.get.mockImplementation((key: string) => key === "systemTestRunId" ? "run-1" : undefined);

    await writeAuditLogDurable(c as never, {
      entityType: "role", action: "create", actorId: "admin-1", entityId: "role-1",
    });

    expect(dbMock.batch).toHaveBeenCalledTimes(1);
    expect(c.executionCtx.waitUntil).not.toHaveBeenCalled();
  });

  it("does not strand a business artifact when temporary system-test audit registration fails", async () => {
    const { c } = createContext();
    c.get.mockImplementation((key: string) => key === "systemTestRunId" ? "run-1" : undefined);
    dbMock.batch.mockResolvedValueOnce([
      { meta: { changes: 0 } },
      { meta: { changes: 0 } },
    ]);

    await expect(writeAuditLogDurable(c as never, {
      entityType: "role", action: "create", actorId: "admin-1", entityId: "role-1",
    })).resolves.toBeUndefined();
  });
});
