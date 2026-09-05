import {
  MAX_SQL_BATCH_STATEMENTS,
  MAX_SQL_PARAMETERS,
  type SqlBatchStatement,
  type SqlExecutor,
  type SqlReadBatchStatement,
  type SqlReadStatement,
  type SqlStatement,
} from "./sql-executor.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

export type SqlExecutorConformanceFixture = Readonly<{
  executor: SqlExecutor;
  dispose(): void | Promise<void>;
}>;

function query(
  statement: Omit<SqlStatement, "method" | "columns"> & Readonly<{ method: "all" | "values" | "get" }>,
  columns: readonly string[],
): SqlReadBatchStatement {
  return { ...statement, columns };
}

export function defineSqlExecutorConformance(
  name: string,
  createFixture: () => SqlExecutorConformanceFixture | Promise<SqlExecutorConformanceFixture>,
): void {
  describe(`${name} SqlExecutor conformance`, () => {
    let fixture: SqlExecutorConformanceFixture;

    beforeAll(async () => {
      fixture = await createFixture();
    });

    afterAll(async () => {
      await fixture.dispose();
    });

    it("accepts an empty atomic batch", async () => {
      await expect(fixture.executor.batch([])).resolves.toEqual([]);
      await expect(fixture.executor.readBatch([])).resolves.toEqual([]);
    });

    it("reads CTEs and preserves SQL punctuation inside literals, identifiers, and comments", async () => {
      const source = "/* ; ) */ WITH q AS (SELECT '; ) ''quoted''' AS \"v; )\") SELECT \"v; )\" FROM q -- ; )";
      await expect(fixture.executor.read({ sql: source, method: "get" }))
        .resolves.toEqual({ rows: ["; ) 'quoted'"] });
      const [result] = await fixture.executor.readBatch([{
        sql: 'SELECT 1 AS [first; )], 2 AS `second``; )`, 3 AS "third""; )"',
        method: "all",
        columns: ["first; )", "second`; )", 'third"; )'],
      }]);
      expect(result?.rows).toEqual([[1, 2, 3]]);
      await expect(fixture.executor.read({ sql: "SELECT 1 WHERE 0", method: "get" }))
        .resolves.toEqual({ rows: undefined });
      await expect(fixture.executor.read({ sql: "SELECT 1 AS value --\r' ; )", method: "get" }))
        .resolves.toEqual({ rows: [1] });
    });

    it("ends leading line comments only at LF for reads", async () => {
      const sql = "-- ignored\rROLLBACK\nSELECT 1 AS value";
      await expect(fixture.executor.read({ sql, method: "get" }))
        .resolves.toEqual({ rows: [1] });
      const [result] = await fixture.executor.readBatch([{ sql, method: "get", columns: ["value"] }]);
      expect(result?.rows).toEqual([1]);
    });

    it("rejects transaction control hidden after CR in line comments before executing", async () => {
      const sql = "-- ignored\rSELECT\nBEGIN IMMEDIATE";
      await fixture.executor.execute({ sql: "CREATE TABLE executor_transaction_guard (id INTEGER PRIMARY KEY)", method: "run" });
      await expect(fixture.executor.execute({ sql, method: "run" }))
        .rejects.toThrow("Use SqlExecutor.batch() for atomic work");
      await expect(fixture.executor.batch([
        { sql: "INSERT INTO executor_transaction_guard VALUES (1)", method: "run" },
        { sql, method: "run" },
      ])).rejects.toThrow("Use SqlExecutor.batch() for atomic work");
      expect((await fixture.executor.read({ sql: "SELECT COUNT(*) FROM executor_transaction_guard", method: "get" })).rows)
        .toEqual([0]);
      await expect(fixture.executor.batch([{ sql: "INSERT INTO executor_transaction_guard VALUES (1)", method: "run" }]))
        .resolves.toHaveLength(1);
    });

    it("rejects writes and attempts to escape the read expression without side effects", async () => {
      await fixture.executor.execute({ sql: "CREATE TABLE executor_read_guard (id INTEGER PRIMARY KEY, value TEXT)", method: "run" });
      await fixture.executor.execute({ sql: "INSERT INTO executor_read_guard VALUES (1, 'kept')", method: "run" });
      const sources = [
        "UPDATE executor_read_guard SET value = 'bad' RETURNING value",
        "INSERT INTO executor_read_guard VALUES (2, 'bad') RETURNING value",
        "DELETE FROM executor_read_guard RETURNING value",
        "WITH q AS (SELECT 1) UPDATE executor_read_guard SET value = 'bad' RETURNING value",
        "WITH q AS (SELECT 1) INSERT INTO executor_read_guard SELECT 2, 'bad' FROM q RETURNING value",
        "CREATE TABLE executor_read_escape (id INTEGER)",
        "DROP TABLE executor_read_guard",
        "PRAGMA user_version = 9",
        "BEGIN DEFERRED",
        "SELECT 1); UPDATE executor_read_guard SET value = 'bad'; SELECT (1",
        "SELECT 1 --\r'\n); UPDATE executor_read_guard SET value = 'bad'; SELECT (1 -- '",
        "SELECT 1); DELETE FROM executor_read_guard; --",
        "SELECT 1; DELETE FROM executor_read_guard",
        "SELECT 1 /* unterminated",
        "SELECT 'unterminated",
        'SELECT "unterminated',
        "SELECT `unterminated",
        "SELECT [unterminated",
        "SELECT (1",
        "SELECT 1)",
      ];
      for (const sql of sources) {
        await expect(fixture.executor.read({ sql, method: "all" }), sql).rejects.toThrow();
        await expect(fixture.executor.readBatch([
          { sql: "SELECT value FROM executor_read_guard", method: "get", columns: ["value"] },
          { sql, method: "all", columns: ["value"] },
        ]), sql).rejects.toThrow();
        const state = await fixture.executor.read({ sql: "SELECT id, value FROM executor_read_guard", method: "all" });
        expect(state.rows, sql).toEqual([[1, "kept"]]);
      }
      await expect(fixture.executor.read({ sql: "SELECT 1", method: "run" } as unknown as SqlReadStatement))
        .rejects.toThrow(/run/);
      await expect(fixture.executor.readBatch([{ sql: "DELETE FROM executor_read_guard", method: "run" }] as unknown as SqlReadBatchStatement[]))
        .rejects.toThrow(/run/);
      await fixture.executor.batch([{ sql: "UPDATE executor_read_guard SET value = 'recovered' WHERE id = 1", method: "run" }]);
      expect((await fixture.executor.read({ sql: "SELECT value FROM executor_read_guard", method: "get" })).rows)
        .toEqual(["recovered"]);
    });

    it("enforces read limits, declared column order, and portable BLOB bindings", async () => {
      const params = Array.from({ length: MAX_SQL_PARAMETERS }, (_, index) => index);
      const columns = params.map((value) => `c${value}`);
      const [boundary] = await fixture.executor.readBatch([{
        sql: `SELECT ${columns.map((column) => `? AS ${column}`).join(", ")}`,
        params,
        method: "get",
        columns,
      }]);
      expect(boundary?.rows).toEqual(params);
      await expect(fixture.executor.readBatch(Array.from({ length: MAX_SQL_BATCH_STATEMENTS }, () => ({
        sql: "SELECT 1 AS value", method: "get", columns: ["value"],
      })))).resolves.toHaveLength(MAX_SQL_BATCH_STATEMENTS);
      await expect(fixture.executor.read({ sql: "SELECT 1", params: [...params, 100], method: "get" }))
        .rejects.toThrow(/at most 100 parameters/);
      await expect(fixture.executor.readBatch(Array.from({ length: MAX_SQL_BATCH_STATEMENTS + 1 }, () => ({
        sql: "SELECT 1 AS value", method: "get", columns: ["value"],
      })))).rejects.toThrow(/at most 50 statements/);
      await expect(fixture.executor.readBatch([{
        sql: "SELECT 1 AS value", method: "get", columns: ["wrong"],
      }])).rejects.toThrow(/columns|column order/);
      const payload = new Uint8Array([8, 9]);
      const [ordered] = await fixture.executor.readBatch([{
        sql: 'SELECT ? AS "2", ? AS "1", ? AS payload',
        params: ["first", 1n, payload], method: "all", columns: ["2", "1", "payload"],
      }]);
      expect(ordered?.rows).toEqual([["first", 1, payload]]);
    });

    it("accepts exactly the portable statement and parameter limits", async () => {
      await fixture.executor.execute({
        sql: "CREATE TABLE executor_batch_boundary (id INTEGER PRIMARY KEY)",
        method: "run",
      });
      const boundaryBatch: SqlBatchStatement[] = Array.from(
        { length: MAX_SQL_BATCH_STATEMENTS },
        (_, index) => ({ method: "run", sql: "INSERT INTO executor_batch_boundary (id) VALUES (?)", params: [index] }),
      );
      await expect(fixture.executor.batch(boundaryBatch)).resolves.toHaveLength(MAX_SQL_BATCH_STATEMENTS);

      const columns = Array.from({ length: MAX_SQL_PARAMETERS }, (_, index) => `c${index}`);
      const params = Array.from({ length: MAX_SQL_PARAMETERS }, (_, index) => index);
      const [result] = await fixture.executor.batch([query({
        method: "get",
        sql: `SELECT ${columns.map((column) => `? AS ${column}`).join(", ")}`,
        params,
      }, columns)]);
      expect(result?.rows).toEqual(params);
    });

    it("rejects an oversized atomic batch before executing it", async () => {
      await expect(fixture.executor.batch(Array.from(
        { length: MAX_SQL_BATCH_STATEMENTS + 1 },
        () => ({ method: "run" as const, sql: "SELECT 1" }),
      ))).rejects.toThrow(`at most ${MAX_SQL_BATCH_STATEMENTS} statements`);
    });

    it("rejects duplicate result aliases and accepts declared unique columns", async () => {
      await expect(fixture.executor.batch([
        query({ sql: "SELECT 1 AS repeated, 2 AS repeated", method: "get" }, ["repeated", "repeated"]),
      ])).rejects.toThrow(/unique/i);

      await expect(fixture.executor.batch([
        query({ sql: "SELECT 1 AS repeated, 2 AS repeated", method: "get" }, ["repeated", "second"]),
      ])).rejects.toThrow(/columns|unique/i);

      const [result] = await fixture.executor.batch([
        query({ sql: "SELECT 1 AS first, 2 AS second", method: "get" }, ["first", "second"]),
      ]);
      expect(result?.rows).toEqual([1, 2]);
    });

    it("preserves declared column order and BLOB values in a batch", async () => {
      await fixture.executor.execute({
        sql: "CREATE TABLE executor_order (id INTEGER PRIMARY KEY, value TEXT NOT NULL, payload BLOB NOT NULL)",
        method: "run",
      });
      const payload = new Uint8Array([4, 5, 6]);
      const [, selected] = await fixture.executor.batch([
        { sql: "INSERT INTO executor_order (id, value, payload) VALUES (?, ?, ?)", params: [1, "first", payload], method: "run" },
        query({ sql: 'SELECT value AS "2", id AS "1", payload FROM executor_order', method: "all" }, ["2", "1", "payload"]),
      ]);

      expect(selected?.rows).toEqual([["first", 1, payload]]);
    });

    it("uses RETURNING rows for the direct mutation outcome with AFTER triggers", async () => {
      await fixture.executor.execute({ sql: "CREATE TABLE executor_target (id INTEGER PRIMARY KEY, value TEXT NOT NULL)", method: "run" });
      await fixture.executor.execute({ sql: "CREATE TABLE executor_trigger_log (target_id INTEGER NOT NULL)", method: "run" });
      await fixture.executor.execute({
        sql: `CREATE TRIGGER executor_target_after_update AFTER UPDATE ON executor_target BEGIN
          INSERT INTO executor_trigger_log (target_id) VALUES (NEW.id);
          INSERT INTO executor_trigger_log (target_id) VALUES (NEW.id);
        END`,
        method: "run",
      });
      await fixture.executor.execute({ sql: "INSERT INTO executor_target (id, value) VALUES (1, 'before')", method: "run" });

      const [mutation] = await fixture.executor.batch([
        query({ sql: "UPDATE executor_target SET value = 'after' WHERE id = 1 RETURNING id", method: "all" }, ["id"]),
      ]);
      expect(mutation?.rows).toEqual([[1]]);

      const triggerCount = await fixture.executor.execute({
        sql: "SELECT COUNT(*) FROM executor_trigger_log",
        method: "get",
      });
      expect(triggerCount.rows).toEqual([2]);
    });

    it("rolls back every statement when a batch fails", async () => {
      await fixture.executor.execute({
        sql: "CREATE TABLE executor_rollback (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE)",
        method: "run",
      });
      await expect(fixture.executor.batch([
        { sql: "INSERT INTO executor_rollback (value) VALUES (?)", params: ["same"], method: "run" },
        { sql: "INSERT INTO executor_rollback (value) VALUES (?)", params: ["same"], method: "run" },
      ])).rejects.toThrow();

      const count = await fixture.executor.execute({ sql: "SELECT COUNT(*) FROM executor_rollback", method: "get" });
      expect(count.rows).toEqual([0]);
    });
  });
}
