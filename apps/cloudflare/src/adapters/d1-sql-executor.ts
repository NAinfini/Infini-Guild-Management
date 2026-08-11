import {
  assertSqlBatch,
  assertSqlResultColumns,
  assertSqlStatement,
  decodeSqlRow,
  normalizeSqlParams,
  type SqlExecutor,
  type SqlBatchStatement,
  type SqlMethod,
  type SqlResult,
  type SqlRow,
  type SqlRows,
  type SqlStatement,
  type SqlValue,
} from "@guild/kernel";

function toD1Binding(value: SqlValue): unknown {
  return value instanceof Uint8Array ? new Uint8Array(value).buffer : value;
}

function preparedStatement(database: D1Database, statement: SqlStatement): D1PreparedStatement {
  assertSqlStatement(statement);
  return database.prepare(statement.sql).bind(...normalizeSqlParams(statement.params).map(toD1Binding));
}

function rowsForMethod(method: SqlMethod, rows: readonly SqlRow[]): SqlRows {
  if (method === "run") return [];
  if (method === "get") return rows[0];
  return rows;
}

function resultRows(results: readonly unknown[], columns: readonly string[]): SqlRow[] {
  return results.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError("D1 returned a row with an invalid shape");
    }
    const record = row as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== columns.length || keys.some((key) => !columns.includes(key))) {
      throw new TypeError("D1 result columns do not match the declared columns");
    }
    return decodeSqlRow(columns.map((column) => record[column]));
  });
}

function fromD1Result(statement: SqlStatement, result: D1Result<unknown>): SqlResult {
  return {
    rows: statement.method === "run"
      ? []
      : rowsForMethod(statement.method, resultRows(result.results, statement.columns!)),
    ...(result.meta.last_row_id === 0 ? {} : { lastInsertRowId: result.meta.last_row_id }),
  };
}

export class D1SqlExecutor implements SqlExecutor {
  constructor(private readonly database: D1Database) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    const prepared = preparedStatement(this.database, statement);
    if (statement.method === "run") {
      return fromD1Result(statement, await prepared.run<unknown>());
    }

    const [columns, ...rawRows] = await prepared.raw<unknown[]>({ columnNames: true });
    assertSqlResultColumns(statement, columns);
    const rows = rawRows.map(decodeSqlRow);
    return {
      rows: rowsForMethod(statement.method, rows),
    };
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    if (statements.length === 0) return [];
    assertSqlBatch(statements);
    const prepared = statements.map((statement) => preparedStatement(this.database, statement));
    const results = await this.database.batch<unknown>(prepared);
    if (results.length !== statements.length) {
      throw new Error("D1 returned a different number of batch results than requested");
    }
    return results.map((result, index) => fromD1Result(statements[index]!, result));
  }
}
