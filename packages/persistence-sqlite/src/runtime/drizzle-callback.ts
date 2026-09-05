import type { AsyncRemoteCallback } from "drizzle-orm/sqlite-proxy";
import {
  type SqlExecutor,
  type SqlMethod,
  type SqlRows,
  type SqlValue,
} from "@guild/kernel";

function toDrizzleRows(method: SqlMethod, rows: SqlRows): unknown[] {
  if (method === "get") return rows as unknown[];
  return (rows ?? []) as unknown[];
}

export function createDrizzleCallback(executor: SqlExecutor): AsyncRemoteCallback {
  return async (sql, params, method) => {
    if (method === "run") throw new TypeError("The application Drizzle database only supports reads");
    const result = await executor.read({
      sql,
      params: params as SqlValue[],
      method,
    });
    return { rows: toDrizzleRows(method, result.rows) };
  };
}
