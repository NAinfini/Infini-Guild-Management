import { DatabaseSync } from "node:sqlite";
import { defineSqlExecutorConformance } from "@guild/kernel/testing";
import { SqliteTestExecutor } from "./sqlite-test-executor.js";

defineSqlExecutorConformance("Test SQLite", () => {
  const database = new DatabaseSync(":memory:");
  return {
    executor: new SqliteTestExecutor(database),
    dispose: () => database.close(),
  };
});
