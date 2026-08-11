import type { DatabaseSync, StatementResultingChanges, StatementSync } from "node:sqlite";
import {
  assertSqlBatch,
  assertSqlResultColumns,
  assertSqlStatement,
  decodeSqlRow,
  normalizeSqlParams,
  type SqlExecutor,
  type SqlBatchStatement,
  type SqlResult,
  type SqlRows,
  type SqlStatement,
} from "@guild/kernel";

export type NodeSqlExecutorOptions = Readonly<{
  maxPending?: number;
}>;

class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private readonly maxPending: number) {}

  run<T>(operation: () => T): Promise<T> {
    if (this.pending >= this.maxPending) {
      return Promise.reject(new Error("SQLite operation queue is full"));
    }
    this.pending += 1;
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.pending -= 1;
    });
  }
}

function runResult(result: StatementResultingChanges): SqlResult {
  return {
    rows: [],
    ...(result.lastInsertRowid === 0 ? {} : { lastInsertRowId: result.lastInsertRowid }),
  };
}

function prepare(database: DatabaseSync, statement: SqlStatement): StatementSync {
  assertSqlStatement(statement);
  const prepared = database.prepare(statement.sql);
  prepared.setReturnArrays(true);
  return prepared;
}

export class NodeSqlExecutor implements SqlExecutor {
  private readonly queue: SerialQueue;

  constructor(
    private readonly database: DatabaseSync,
    options: NodeSqlExecutorOptions = {},
  ) {
    const maxPending = options.maxPending ?? 1_024;
    if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
      throw new TypeError("maxPending must be a positive safe integer");
    }
    this.queue = new SerialQueue(maxPending);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
  }

  execute(statement: SqlStatement): Promise<SqlResult> {
    return this.queue.run(() => this.executeNow(statement));
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    assertSqlBatch(statements);
    if (statements.length === 0) return [];
    return this.queue.run(() => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => this.executeNow(statement));
        this.database.exec("COMMIT");
        return results;
      } catch (error) {
        try {
          if (this.database.isTransaction) this.database.exec("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "SQLite batch and rollback both failed");
        }
        throw error;
      }
    });
  }

  private executeNow(statement: SqlStatement): SqlResult {
    const params = normalizeSqlParams(statement.params);
    const prepared = prepare(this.database, statement);
    if (statement.method === "run") return runResult(prepared.run(...params));

    assertSqlResultColumns(statement, prepared.columns().map(({ name }) => name));

    const rows: SqlRows = statement.method === "get"
      ? this.decodeOptionalRow(prepared.get(...params))
      : (prepared.all(...params) as unknown as readonly unknown[][]).map(decodeSqlRow);
    return { rows };
  }

  private decodeOptionalRow(row: unknown): ReturnType<typeof decodeSqlRow> | undefined {
    return row === undefined ? undefined : decodeSqlRow(row as readonly unknown[]);
  }
}
