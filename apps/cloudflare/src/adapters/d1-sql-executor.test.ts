import { Miniflare } from "miniflare";
import { describe, expect, it, vi } from "vitest";
import { defineSqlExecutorConformance } from "@guild/kernel/testing";
import { D1SqlExecutor } from "./d1-sql-executor.js";

defineSqlExecutorConformance("D1", async () => {
  const miniflare = new Miniflare({
    port: 0,
    workers: [{
      config: {
        name: "sql-executor-conformance",
        type: "worker",
        compatibilityDate: "2026-07-28",
        manifest: {
          mainModule: "script-0.mjs",
          modules: {
            "script-0.mjs": { type: "esm", contents: "export default {}" },
          },
        },
        env: { DB: { type: "d1", id: "sql-executor-conformance" } },
      },
    }],
  });
  return {
    executor: new D1SqlExecutor(await miniflare.getD1Database("DB")),
    dispose: () => miniflare.dispose(),
  };
});

function meta(changes = 0, lastRowId = 0): D1Meta {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

describe("D1SqlExecutor", () => {
  it("decodes array rows and normalizes portable bindings", async () => {
    const bind = vi.fn();
    const raw = vi.fn().mockResolvedValue([
      ["first", "second", "payload"],
      [7, "row", new Uint8Array([1, 2]).buffer],
    ]);
    bind.mockReturnValue({ raw });
    const prepare = vi.fn().mockReturnValue({ bind });
    const database = { prepare } as unknown as D1Database;
    const executor = new D1SqlExecutor(database);

    const result = await executor.execute({
      sql: "SELECT ?1, ?2",
      params: [9n, new Uint8Array([3, 4])],
      method: "get",
    });

    expect(bind.mock.calls[0]![0]).toBe(9);
    expect(bind.mock.calls[0]![1]).toBeInstanceOf(ArrayBuffer);
    expect(result.rows).toEqual([7, "row", new Uint8Array([1, 2])]);
  });

  it("submits an ordered batch once and decodes object rows by column order", async () => {
    const prepare = vi.fn((sql: string) => ({
      sql,
      bind() {
        return this;
      },
    }));
    const batch = vi.fn().mockResolvedValue([
      { success: true, meta: meta(1, 4), results: [] },
      { success: true, meta: meta(), results: [{ first: "a", second: 2 }] },
    ]);
    const executor = new D1SqlExecutor({ prepare, batch } as unknown as D1Database);

    const results = await executor.batch([
      { sql: "INSERT INTO t(value) VALUES (?)", params: ["a"], method: "run" },
      {
        sql: "SELECT value AS first, id AS second FROM t",
        method: "all",
        columns: ["first", "second"],
      },
    ]);

    expect(batch).toHaveBeenCalledOnce();
    expect(results).toEqual([
      { rows: [], lastInsertRowId: 4 },
      { rows: [["a", 2]] },
    ]);
  });

  it("rejects statements beyond the shared D1 parameter boundary", async () => {
    const prepare = vi.fn();
    const executor = new D1SqlExecutor({ prepare } as unknown as D1Database);
    await expect(executor.execute({
      sql: "SELECT 1",
      params: Array.from({ length: 101 }, () => 1),
      method: "all",
    })).rejects.toThrow("at most 100 parameters");
    expect(prepare).not.toHaveBeenCalled();
  });
});
