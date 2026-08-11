export const MAX_SQL_PARAMETERS = 100;
export const MAX_SQL_BATCH_STATEMENTS = 50;

export type SqlValue = null | string | number | bigint | Uint8Array;
export type SqlMethod = "run" | "all" | "values" | "get";
export type SqlRow = readonly SqlValue[];
export type SqlRows = readonly SqlRow[] | SqlRow | undefined;

export type SqlStatement = Readonly<{
  sql: string;
  params?: readonly SqlValue[];
  method: SqlMethod;
  columns?: readonly string[];
}>;

export type SqlBatchStatement =
  | (Omit<SqlStatement, "method" | "columns"> & Readonly<{ method: "run"; columns?: never }>)
  | (Omit<SqlStatement, "method" | "columns"> & Readonly<{
    method: Exclude<SqlMethod, "run">;
    columns: readonly string[];
  }>);

export type SqlResult = Readonly<{
  rows: SqlRows;
  lastInsertRowId?: number | bigint;
}>;

export interface SqlExecutor {
  execute(statement: SqlStatement): Promise<SqlResult>;
  batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]>;
}

function firstSqlToken(sql: string): string | undefined {
  let remaining = sql;
  while (true) {
    remaining = remaining.trimStart();
    if (remaining.startsWith(";")) {
      remaining = remaining.slice(1);
      continue;
    }
    if (remaining.startsWith("--")) {
      const newline = remaining.search(/[\r\n]/);
      if (newline < 0) return undefined;
      remaining = remaining.slice(newline + 1);
      continue;
    }
    if (remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/", 2);
      if (end < 0) return undefined;
      remaining = remaining.slice(end + 2);
      continue;
    }
    return /^[A-Za-z]+/.exec(remaining)?.[0]?.toUpperCase();
  }
}

function assertUniqueColumns(columns: readonly string[]): void {
  if (columns.length === 0 || columns.some((column) => !column)) {
    throw new TypeError("SQL result columns must be non-empty names");
  }
  if (new Set(columns).size !== columns.length) {
    throw new TypeError("SQL result columns must be unique");
  }
}

export function assertSqlStatement(statement: SqlStatement): void {
  if (!statement.sql.trim()) throw new TypeError("SQL statement is required");
  if ((statement.params?.length ?? 0) > MAX_SQL_PARAMETERS) {
    throw new RangeError(`SQL statements support at most ${MAX_SQL_PARAMETERS} parameters`);
  }
  if (["BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE"].includes(firstSqlToken(statement.sql) ?? "")) {
    throw new TypeError("Use SqlExecutor.batch() for atomic work");
  }
  if (statement.columns !== undefined) {
    if (statement.method === "run") throw new TypeError("Run statements cannot declare result columns");
    assertUniqueColumns(statement.columns);
  }
}

export function assertSqlBatchStatement(statement: SqlStatement): asserts statement is SqlBatchStatement {
  assertSqlStatement(statement);
  if (statement.method !== "run" && statement.columns === undefined) {
    throw new TypeError("SQL batch queries must declare result columns");
  }
}

export function assertSqlBatch(statements: readonly SqlBatchStatement[]): void {
  if (statements.length > MAX_SQL_BATCH_STATEMENTS) {
    throw new RangeError(`SQL batches support at most ${MAX_SQL_BATCH_STATEMENTS} statements`);
  }
  statements.forEach(assertSqlBatchStatement);
}

export function assertSqlResultColumns(statement: SqlStatement, columns: readonly string[]): void {
  if (statement.columns === undefined) return;
  assertUniqueColumns(columns);
  if (columns.length !== statement.columns.length || columns.some((column, index) => column !== statement.columns?.[index])) {
    throw new TypeError("SQLite result columns do not match the declared column order");
  }
}

export function normalizeSqlParams(params: readonly SqlValue[] | undefined): SqlValue[] {
  return (params ?? []).map((value) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("SQL numbers must be finite");
    }
    if (typeof value === "bigint") {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new RangeError("SQL bigint is outside the portable safe-integer range");
      return number;
    }
    return value;
  });
}

export function decodeSqlValue(value: unknown): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("SQLite returned a non-finite number");
    return value;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value as number[]);
  }
  throw new TypeError(`SQLite returned an unsupported value of type ${typeof value}`);
}

export function decodeSqlRow(row: readonly unknown[]): SqlRow {
  return row.map(decodeSqlValue);
}
