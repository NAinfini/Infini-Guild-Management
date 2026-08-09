import { describe, expect, it, vi } from "vitest";
import { toErrorLogResponse, writeSystemTestErrorLog } from "../ErrorLogService";

describe("ErrorLogService JSON object boundary", () => {
  it("serializes context once on the atomic system-test write path", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => {
          const statement = { sql, params };
          statements.push(statement);
          return statement;
        },
      }),
      batch: vi.fn(async (batch: unknown[]) => batch.map(() => ({ meta: { changes: 1 } }))),
    };

    await writeSystemTestErrorLog(DB as never, "run-1", {
      source: "request",
      message: "boom",
      context: { attempt: 2, nested: { retryable: false } },
    });

    expect(statements[0]?.params[8]).toBe('{"attempt":2,"nested":{"retryable":false}}');
    expect(DB.batch).toHaveBeenCalledTimes(1);
  });

  it("strictly parses stored context for the API response", () => {
    const baseRow = {
      id: "error-1",
      source: "request",
      level: "error",
      message: "boom",
      requestPath: null,
      requestMethod: null,
      requestId: null,
      stack: null,
      context: '{"request":{"id":"req-1"}}',
      createdAt: "2026-05-22T00:00:00.000Z",
    };

    expect(toErrorLogResponse(baseRow as never).context).toEqual({ request: { id: "req-1" } });
    expect(() => toErrorLogResponse({ ...baseRow, context: "[]" } as never)).toThrow();
    expect(() => toErrorLogResponse({ ...baseRow, context: "not-json" } as never)).toThrow();
  });
});
