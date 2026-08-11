import type { DatabaseSync } from "node:sqlite";
import {
  assertSqlBatch,
  assertSqlResultColumns,
  assertSqlStatement,
  decodeSqlRow,
  normalizeSqlParams,
  type SqlBatchStatement,
  type SqlExecutor,
  type SqlResult,
  type SqlRows,
  type SqlStatement,
} from "@guild/kernel";

/** Test-only SQLite bridge for persistence store tests. */
export class SqliteTestExecutor implements SqlExecutor {
  constructor(private readonly database: DatabaseSync) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    assertSqlStatement(statement);
    return this.executeNow(statement);
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    assertSqlBatch(statements);
    if (statements.length === 0) return [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => this.executeNow(statement));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private executeNow(statement: SqlStatement): SqlResult {
    const prepared = this.database.prepare(statement.sql);
    prepared.setReturnArrays(true);
    const params = normalizeSqlParams(statement.params);
    if (statement.method === "run") {
      const result = prepared.run(...params);
      return { rows: [], ...(result.lastInsertRowid === 0 ? {} : { lastInsertRowId: result.lastInsertRowid }) };
    }
    assertSqlResultColumns(statement, prepared.columns().map(({ name }) => name));
    const rows: SqlRows = statement.method === "get"
      ? this.optionalRow(prepared.get(...params))
      : (prepared.all(...params) as unknown as readonly unknown[][]).map(decodeSqlRow);
    return { rows };
  }

  private optionalRow(row: unknown): ReturnType<typeof decodeSqlRow> | undefined {
    return row === undefined ? undefined : decodeSqlRow(row as readonly unknown[]);
  }
}
