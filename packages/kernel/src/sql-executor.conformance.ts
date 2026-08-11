import {
  MAX_SQL_BATCH_STATEMENTS,
  MAX_SQL_PARAMETERS,
  type SqlBatchStatement,
  type SqlExecutor,
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
): SqlBatchStatement {
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
