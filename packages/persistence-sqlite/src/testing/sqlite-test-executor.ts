import type { DatabaseSync } from "node:sqlite";
import {
  assertSqlBatch,
  assertSqlResultColumns,
  assertSqlStatement,
  decodeSqlRow,
  normalizeSqlParams,
  prepareSqlReadBatch,
  prepareSqlReadStatement,
  type SqlBatchStatement,
  type SqlExecutor,
  type SqlReadBatchStatement,
  type SqlReadStatement,
  type SqlResult,
  type SqlRows,
  type SqlStatement,
} from "@guild/kernel";

/**
 * Test-only SQLite bridge for persistence store tests.
 *
 * 记录面是正交的：statements 只收单发 execute()/read()，批成员只出现在
 * batches 里——这样测试既能钉住“零散读了几条”，也能钉住“批的大小与
 * 内容”，两类断言互不污染。
 */
export class SqliteTestExecutor implements SqlExecutor {
  /** 每次 execute()/read() 的源语句，按执行顺序记录。 */
  readonly statements: SqlStatement[] = [];
  /** 每次非空 batch()/readBatch() 的源语句组，按执行顺序记录。 */
  readonly batches: SqlBatchStatement[][] = [];
  /** 每次 all 读的行数，用来钉住水合查询的行数上界。 */
  readonly reads: Array<Readonly<{ sql: string; params: SqlStatement["params"]; rowCount: number }>> = [];
  /**
   * 一次性钩子：下一个非空 batch 开启事务前执行（可 async，可重入执行器），
   * 用来在乐观并发测试里模拟竞争者在读取与提交之间插队。
   */
  beforeNextBatch: (() => void | Promise<void>) | undefined;

  constructor(private readonly database: DatabaseSync) {}

  async read(statement: SqlReadStatement): Promise<SqlResult> {
    const prepared = prepareSqlReadStatement(statement);
    this.statements.push(statement);
    return this.executeNow(prepared, statement);
  }

  async readBatch(statements: readonly SqlReadBatchStatement[]): Promise<readonly SqlResult[]> {
    const prepared = prepareSqlReadBatch(statements);
    if (prepared.length === 0) return [];
    this.batches.push([...statements]);
    return this.executeBatch(prepared, "BEGIN DEFERRED", statements);
  }

  async execute(statement: SqlStatement): Promise<SqlResult> {
    assertSqlStatement(statement);
    this.statements.push(statement);
    return this.executeNow(statement);
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    assertSqlBatch(statements);
    if (statements.length === 0) return [];
    const before = this.beforeNextBatch;
    this.beforeNextBatch = undefined;
    await before?.();
    this.batches.push([...statements]);
    return this.executeBatch(statements, "BEGIN IMMEDIATE", statements);
  }

  private executeBatch(
    statements: readonly SqlBatchStatement[],
    begin: "BEGIN DEFERRED" | "BEGIN IMMEDIATE",
    sources: readonly SqlBatchStatement[],
  ): readonly SqlResult[] {
    this.database.exec(begin);
    try {
      const results = statements.map((statement, index) => this.executeNow(statement, sources[index]!));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private executeNow(statement: SqlStatement, source: SqlStatement = statement): SqlResult {
    const prepared = this.database.prepare(statement.sql);
    prepared.setReturnArrays(true);
    const params = normalizeSqlParams(statement.params);
    if (statement.method === "run") {
      const result = prepared.run(...params);
      return { rows: [], ...(result.lastInsertRowid === 0 ? {} : { lastInsertRowId: result.lastInsertRowid }) };
    }
    assertSqlResultColumns(statement, prepared.columns().map(({ name }) => name));
    if (statement.method === "get") {
      return { rows: this.optionalRow(prepared.get(...params)) };
    }
    const rows: SqlRows = (prepared.all(...params) as unknown as readonly unknown[][]).map(decodeSqlRow);
    this.reads.push({ sql: source.sql, params: source.params, rowCount: rows.length });
    return { rows };
  }

  private optionalRow(row: unknown): ReturnType<typeof decodeSqlRow> | undefined {
    return row === undefined ? undefined : decodeSqlRow(row as readonly unknown[]);
  }
}
