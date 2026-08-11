import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteErrorLogStore } from "./error-log-store.js";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteErrorLogStore", () => {
  it("writes and filters the stable paginated projection", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec(`CREATE TABLE error_log (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL,
      request_path TEXT, request_method TEXT, request_id TEXT, stack TEXT, created_at TEXT NOT NULL
    ); CREATE INDEX idx_error_log_created ON error_log(created_at, id);
    CREATE INDEX idx_error_log_source_created ON error_log(source, created_at, id);`);
    const store = new SqliteErrorLogStore(new SqliteTestExecutor(database));
    await store.insert({
      id: "error-1", source: "request", level: "error", message: "failed", requestPath: "/api/test",
      requestMethod: "GET", requestId: "request-1", stack: null, createdAt: "2026-08-09T00:00:00.000Z",
    });

    await expect(store.list({ source: "request", page: 1, limit: 5 })).resolves.toEqual({
      data: [{
        id: "error-1", source: "request", level: "error", message: "failed", requestPath: "/api/test",
        requestMethod: "GET", requestId: "request-1", stack: null, context: null,
        createdAt: "2026-08-09T00:00:00.000Z",
      }],
      total: 1, page: 1, limit: 5, total_pages: 1,
    });
  });
});
