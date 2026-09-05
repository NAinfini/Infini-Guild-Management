import type { DrizzleConfig } from "drizzle-orm";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { createDrizzleCallback } from "./runtime/drizzle-callback.js";
import type { SqlExecutor } from "@guild/kernel";

export type AppDatabase<TSchema extends Record<string, unknown> = Record<string, never>> =
  Pick<SqliteRemoteDatabase<TSchema>, "select">;

export function createAppDatabase<TSchema extends Record<string, unknown> = Record<string, never>>(
  executor: SqlExecutor,
  config: DrizzleConfig<TSchema> = {},
): AppDatabase<TSchema> {
  const database = drizzle(createDrizzleCallback(executor), config);
  return { select: database.select.bind(database) };
}
