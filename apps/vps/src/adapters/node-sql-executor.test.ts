import { DatabaseSync } from "node:sqlite";
import { createAppDatabase } from "@guild/persistence-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";
import { defineSqlExecutorConformance } from "@guild/kernel/testing";
import { NodeSqlExecutor } from "./node-sql-executor.js";

defineSqlExecutorConformance("Node", () => {
  const database = new DatabaseSync(":memory:");
  return {
    executor: new NodeSqlExecutor(database),
    dispose: () => database.close(),
  };
});

describe("NodeSqlExecutor", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  function fixture(): NodeSqlExecutor {
    database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE, payload BLOB)");
    return new NodeSqlExecutor(database);
  }

  it("rolls back the entire BEGIN IMMEDIATE batch on failure", async () => {
    const executor = fixture();
    await expect(executor.batch([
      { sql: "INSERT INTO rows(value) VALUES (?)", params: ["same"], method: "run" },
      { sql: "INSERT INTO rows(value) VALUES (?)", params: ["same"], method: "run" },
    ])).rejects.toThrow(/UNIQUE/);

    const result = await executor.execute({ sql: "SELECT COUNT(*) FROM rows", method: "get" });
    expect(result.rows).toEqual([0]);
    expect(database?.isTransaction).toBe(false);
  });

  it("preserves column order and decodes BLOB rows as Uint8Array", async () => {
    const executor = fixture();
    await executor.execute({
      sql: "INSERT INTO rows(value, payload) VALUES (?, ?)",
      params: ["first", new Uint8Array([4, 5, 6])],
      method: "run",
    });
    const result = await executor.execute({
      sql: "SELECT value, id, payload FROM rows",
      method: "all",
    });
    expect(result.rows).toEqual([["first", 1, new Uint8Array([4, 5, 6])]]);
  });

  it("accepts 100 bindings and rejects 101 before preparing SQL", async () => {
    const executor = fixture();
    const oneHundred = Array.from({ length: 100 }, (_, index) => index);
    const result = await executor.execute({
      sql: `SELECT ${oneHundred.map(() => "?").join(",")}`,
      params: oneHundred,
      method: "get",
    });
    expect(result.rows).toHaveLength(100);

    await expect(executor.execute({
      sql: "SELECT 1",
      params: [...oneHundred, 100],
      method: "get",
    })).rejects.toThrow("at most 100 parameters");
  });

  it("rejects transaction control hidden behind leading SQL comments", async () => {
    const executor = fixture();
    await expect(executor.execute({
      sql: "/* transport */ -- request\n BEGIN IMMEDIATE",
      method: "run",
    })).rejects.toThrow("Use SqlExecutor.batch()");
    await expect(executor.execute({
      sql: "-- request\r\nROLLBACK",
      method: "run",
    })).rejects.toThrow("Use SqlExecutor.batch()");
    await expect(executor.execute({
      sql: "; ; /* request */ ; BEGIN IMMEDIATE",
      method: "run",
    })).rejects.toThrow("Use SqlExecutor.batch()");
    expect(database?.isTransaction).toBe(false);
  });

  it("backs the shared Drizzle sqlite-proxy callback and atomic batch", async () => {
    const executor = fixture();
    const rows = sqliteTable("rows", {
      id: integer("id").primaryKey(),
      value: text("value").notNull(),
    });
    const db = createAppDatabase(executor, { schema: { rows } });

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
