import type { AsyncBatchRemoteCallback, AsyncRemoteCallback } from "drizzle-orm/sqlite-proxy";
import {
  assertSqlBatchStatement,
  type SqlExecutor,
  type SqlMethod,
  type SqlResult,
  type SqlRows,
  type SqlValue,
} from "@guild/kernel";

function toDrizzleRows(method: SqlMethod, rows: SqlRows): unknown[] {
  if (method === "get") return rows as unknown[];
  return (rows ?? []) as unknown[];
}

export function createDrizzleCallback(executor: SqlExecutor): AsyncRemoteCallback {
  return async (sql, params, method) => {
    const result = await executor.execute({
      sql,
      params: params as SqlValue[],
      method,
    });
    return { rows: toDrizzleRows(method, result.rows) };
  };
}

export function createDrizzleBatchCallback(executor: SqlExecutor): AsyncBatchRemoteCallback {
  return async (batch) => {
    const statements = batch.map(({ sql, params, method }) => {
      const statement = { sql, params: params as SqlValue[], method };
      assertSqlBatchStatement(statement);
      return statement;
    });
    const results = await executor.batch(statements);
    return results.map((result: SqlResult, index) => ({
      rows: toDrizzleRows(batch[index]!.method, result.rows),
    }));
  };
}
