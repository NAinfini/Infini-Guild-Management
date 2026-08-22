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

/**
 * Test-only SQLite bridge for persistence store tests.
 *
 * 记录面是正交的：statements 只收单发 execute()，batch 成员只出现在
 * batches 里——这样测试既能钉住“零散读了几条”，也能钉住“批的大小与
 * 内容”，两类断言互不污染。
 */
export class SqliteTestExecutor implements SqlExecutor {
  /** 每次 execute() 的语句，按执行顺序记录。 */
  readonly statements: SqlStatement[] = [];
  /** 每次非空 batch() 的语句组，按执行顺序记录。 */
  readonly batches: SqlBatchStatement[][] = [];
  /** 每次 all 读的行数，用来钉住水合查询的行数上界。 */
  readonly reads: Array<Readonly<{ sql: string; params: SqlStatement["params"]; rowCount: number }>> = [];
  /**
   * 一次性钩子：下一个非空 batch 开启事务前执行（可 async，可重入执行器），
   * 用来在乐观并发测试里模拟竞争者在读取与提交之间插队。
   */
  beforeNextBatch: (() => void | Promise<void>) | undefined;

  constructor(private readonly database: DatabaseSync) {}

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
    if (statement.method === "get") {
      return { rows: this.optionalRow(prepared.get(...params)) };
    }
    const rows: SqlRows = (prepared.all(...params) as unknown as readonly unknown[][]).map(decodeSqlRow);
    this.reads.push({ sql: statement.sql, params: statement.params, rowCount: rows.length });
    return { rows };
  }

  private optionalRow(row: unknown): ReturnType<typeof decodeSqlRow> | undefined {
    return row === undefined ? undefined : decodeSqlRow(row as readonly unknown[]);
  }
}
