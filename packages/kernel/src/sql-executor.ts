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

export type SqlReadStatement = Omit<SqlStatement, "method"> & Readonly<{
  method: Exclude<SqlMethod, "run">;
}>;

export type SqlReadBatchStatement = SqlReadStatement & Readonly<{
  columns: readonly string[];
}>;

export type SqlBatchStatement =
  | (Omit<SqlStatement, "method" | "columns"> & Readonly<{ method: "run"; columns?: never }>)
  | SqlReadBatchStatement;

export type SqlResult = Readonly<{
  rows: SqlRows;
  lastInsertRowId?: number | bigint;
}>;

export interface SqlExecutor {
  /** A single query expression, without a terminating semicolon. */
  read(statement: SqlReadStatement): Promise<SqlResult>;
  /** Query expressions evaluated together against one database snapshot. */
  readBatch(statements: readonly SqlReadBatchStatement[]): Promise<readonly SqlResult[]>;
  /** Write lane, including result-producing mutations. */
  execute(statement: SqlStatement): Promise<SqlResult>;
  /** Atomic write lane; reads here observe earlier mutations in the batch. */
  batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]>;
}

/*
 * 词法上的首个 SQL 关键字只用于拒绝绕过 batch() 的事务控制语句，
 * 不用于猜测一条 SQL 是否只读；读写意图由调用方显式选择。
 */
export function firstSqlToken(sql: string): string | undefined {
  let remaining = sql;
  while (true) {
    remaining = remaining.trimStart();
    if (remaining.startsWith(";")) {
      remaining = remaining.slice(1);
      continue;
    }
    if (remaining.startsWith("--")) {
      const newline = remaining.indexOf("\n");
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

/** SQLite's query grammar rejects DML/DDL; this boundary prevents escaping the subquery. */
export function prepareSqlReadStatement(statement: SqlReadStatement): SqlReadStatement {
  assertSqlStatement(statement);
  if ((statement.method as SqlMethod) === "run") throw new TypeError("SQL reads cannot use the run method");
  assertQueryExpression(statement.sql);
  return { ...statement, sql: `SELECT * FROM (${statement.sql}\n)` };
}

export function prepareSqlReadBatch(statements: readonly SqlReadBatchStatement[]): readonly SqlReadBatchStatement[] {
  assertSqlBatch(statements);
  return statements.map((statement) => ({ ...prepareSqlReadStatement(statement), columns: statement.columns }));
}

function assertQueryExpression(sql: string): void {
  const invalid = () => new TypeError("SQL reads require one complete query expression without a semicolon");
  let depth = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (character === "'" || character === '"' || character === "`" || character === "[") {
      const close = character === "[" ? "]" : character;
      let closed = false;
      while (++index < sql.length) {
        if (sql[index] !== close) continue;
        if (close !== "]" && sql[index + 1] === close) { index += 1; continue; }
        closed = true;
        break;
      }
      if (!closed) throw invalid();
    } else if (character === "-" && sql[index + 1] === "-") {
      index += 2;
      // SQLite ends a line comment only at LF; treating CR as an end lets quoted SQL escape.
      while (index < sql.length && sql[index] !== "\n") index += 1;
    } else if (character === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end < 0) throw invalid();
      index = end + 1;
    } else if (character === ";" || character === "\0") {
      throw invalid();
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")" && --depth < 0) {
      throw invalid();
    }
  }
  if (depth !== 0) throw invalid();
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
