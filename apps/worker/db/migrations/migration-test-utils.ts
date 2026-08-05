import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const migrationDirectory = "apps/worker/db/migrations";

export const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => /^\d{4}_[a-z0-9_-]+\.sql$/i.test(file))
  .sort((left, right) => left.localeCompare(right));

export const migrationSql = migrationFiles.map((file) => ({
  file,
  sql: readFileSync(join(migrationDirectory, file), "utf8"),
}));

export const finalSchemaSql = migrationSql.map(({ sql }) => sql).join("\n");

export function applyMigration(db: DatabaseSync, sql: string): void {
  db.exec("BEGIN;");
  try {
    db.exec(sql);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function applyMigrations(db: DatabaseSync): void {
  for (const migration of migrationSql) applyMigration(db, migration.sql);
}

export function createMigratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  applyMigrations(db);
  return db;
}

export function schemaObjectSql(
  db: DatabaseSync,
  type: "table" | "index",
  name: string,
): string {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = ? AND name = ?",
  ).get(type, name) as { sql?: string | null } | undefined;
  return row?.sql ?? "";
}
