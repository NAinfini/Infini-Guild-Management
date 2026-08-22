import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAppDatabase } from "@guild/persistence-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";
import { defineSqlExecutorConformance } from "@guild/kernel/testing";
import { NodeSqlExecutor, type NodeSqlExecutorOptions } from "./node-sql-executor.js";

/* 读池按文件路径开多条连接，:memory: 无法在连接间共享，测试一律走临时文件。 */
function tempDatabase(): Readonly<{ path: string; cleanup(): void }> {
  const directory = mkdtempSync(path.join(tmpdir(), "guild-sql-"));
  return {
    path: path.join(directory, "test.sqlite"),
    cleanup: () => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

defineSqlExecutorConformance("Node", () => {
  const database = tempDatabase();
  const executor = new NodeSqlExecutor(database.path, { readers: 2 });
  return {
    executor,
    dispose: async () => {
      await executor.close();
      database.cleanup();
    },
  };
});

describe("NodeSqlExecutor", () => {
  let executor: NodeSqlExecutor | undefined;
  let cleanup: (() => void) | undefined;

  afterEach(async () => {
    await executor?.close();
    executor = undefined;
    cleanup?.();
    cleanup = undefined;
  });

  function open(databasePath: string, options: NodeSqlExecutorOptions = {}): NodeSqlExecutor {
    executor = new NodeSqlExecutor(databasePath, { readers: 2, ...options });
    return executor;
  }

  async function fixture(options: NodeSqlExecutorOptions = {}): Promise<NodeSqlExecutor> {
    const database = tempDatabase();
    cleanup = database.cleanup;
    const opened = open(database.path, options);
    await opened.execute({
      sql: "CREATE TABLE rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE, payload BLOB)",
      method: "run",
    });
    return opened;
  }

  it("rolls back the entire BEGIN IMMEDIATE batch on failure", async () => {
    const sql = await fixture();
    await expect(sql.batch([
      { sql: "INSERT INTO rows(value) VALUES (?)", params: ["same"], method: "run" },
      { sql: "INSERT INTO rows(value) VALUES (?)", params: ["same"], method: "run" },
    ])).rejects.toThrow(/UNIQUE/);

    const result = await sql.execute({ sql: "SELECT COUNT(*) FROM rows", method: "get" });
    expect(result.rows).toEqual([0]);

    /* 回滚后写通道必须没有悬挂事务：下一个 BEGIN IMMEDIATE 批次要能开得起来。 */
    await sql.batch([
      { sql: "INSERT INTO rows(value) VALUES (?)", params: ["fresh"], method: "run" },
    ]);
    const recovered = await sql.execute({ sql: "SELECT COUNT(*) FROM rows", method: "get" });
    expect(recovered.rows).toEqual([1]);
  });

  it("preserves column order and decodes BLOB rows as Uint8Array across lanes", async () => {
    const sql = await fixture();
    await sql.execute({
      sql: "INSERT INTO rows(value, payload) VALUES (?, ?)",
      params: ["first", new Uint8Array([4, 5, 6])],
      method: "run",
    });
    const result = await sql.execute({
      sql: "SELECT value, id, payload FROM rows",
      method: "all",
    });
    expect(result.rows).toEqual([["first", 1, new Uint8Array([4, 5, 6])]]);
  });

  it("serves concurrent reads and writes with a consistent committed view", async () => {
    const sql = await fixture();
    await Promise.all(Array.from({ length: 20 }, (_, index) => sql.execute({
      sql: "INSERT INTO rows(value) VALUES (?)",
      params: [`value-${index}`],
      method: "run",
    })));
    const reads = await Promise.all(Array.from({ length: 10 }, () => sql.execute({
      sql: "SELECT COUNT(*) FROM rows",
      method: "get",
    })));
    for (const read of reads) expect(read.rows).toEqual([20]);
  });

  it("accepts 100 bindings and rejects 101 before preparing SQL", async () => {
    const sql = await fixture();
    const oneHundred = Array.from({ length: 100 }, (_, index) => index);
    const result = await sql.execute({
      sql: `SELECT ${oneHundred.map(() => "?").join(",")}`,
      params: oneHundred,
      method: "get",
    });
    expect(result.rows).toHaveLength(100);

    await expect(sql.execute({
      sql: "SELECT 1",
      params: [...oneHundred, 100],
      method: "get",
    })).rejects.toThrow("at most 100 parameters");
  });

  it("rejects transaction control hidden behind leading SQL comments", async () => {
    const sql = await fixture();
    await expect(sql.execute({
      sql: "/* transport */ -- request\n BEGIN IMMEDIATE",
      method: "run",
    })).rejects.toThrow("Use SqlExecutor.batch()");
    await expect(sql.execute({
      sql: "-- request\r\nROLLBACK",
      method: "run",
    })).rejects.toThrow("Use SqlExecutor.batch()");
    await expect(sql.execute({
      sql: "; ; /* request */ ; BEGIN IMMEDIATE",
      method: "run",
    })).rejects.toThrow("Use SqlExecutor.batch()");
  });

  it("rejects new work once the pending queue is full", async () => {
    const sql = await fixture({ maxPending: 1 });
    const inFlight = sql.execute({ sql: "SELECT 1", method: "get" });
    await expect(sql.execute({ sql: "SELECT 1", method: "get" }))
      .rejects.toThrow("SQLite operation queue is full");
    await inFlight;
  });

  it("opens read-only for verification tooling and refuses writes", async () => {
    const database = tempDatabase();
    cleanup = database.cleanup;
    const writable = new NodeSqlExecutor(database.path, { readers: 1 });
    await writable.execute({
      sql: "CREATE TABLE rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
      method: "run",
    });
    await writable.execute({
      sql: "INSERT INTO rows(value) VALUES (?)",
      params: ["kept"],
      method: "run",
    });
    await writable.close();

    const readOnly = open(database.path, { readOnly: true, readers: 1 });
    const rows = await readOnly.execute({ sql: "SELECT value FROM rows", method: "all" });
    expect(rows.rows).toEqual([["kept"]]);
    await expect(readOnly.execute({
      sql: "INSERT INTO rows(value) VALUES (?)",
      params: ["blocked"],
      method: "run",
    })).rejects.toThrow(/readonly/i);
  });

  it("refuses work after close and keeps close idempotent", async () => {
    const sql = await fixture();
    await sql.close();
    await expect(sql.execute({ sql: "SELECT 1", method: "get" }))
      .rejects.toThrow("SQLite executor is closed");
    await expect(sql.close()).resolves.toBeUndefined();
  });

  it("backs the shared Drizzle sqlite-proxy callback and atomic batch", async () => {
    const sql = await fixture();
    const rows = sqliteTable("rows", {
      id: integer("id").primaryKey(),
      value: text("value").notNull(),
    });
    const db = createAppDatabase(sql, { schema: { rows } });

    await db.batch([
      db.insert(rows).values({ id: 1, value: "one" }),
      db.insert(rows).values({ id: 2, value: "two" }),
    ]);

    await expect(db.select().from(rows).orderBy(rows.id)).resolves.toEqual([
      { id: 1, value: "one" },
      { id: 2, value: "two" },
    ]);
  });
});
