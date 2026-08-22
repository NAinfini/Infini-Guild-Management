import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { APPLICATION_MIGRATIONS } from "@guild/application";

const migrationDirectory = new URL(
  "../../packages/persistence-sqlite/src/migrations/generated/",
  import.meta.url,
);

export const APPLICATION_MIGRATION_SQL = APPLICATION_MIGRATIONS
  .map(({ file }) => readFileSync(fileURLToPath(new URL(file, migrationDirectory)), "utf8"))
  .join("\n");

export const APPLICATION_MIGRATION_STATEMENTS = APPLICATION_MIGRATION_SQL
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

export function migratedApplicationSchemaSql(names: readonly string[]): string {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(APPLICATION_MIGRATION_SQL.replaceAll("--> statement-breakpoint", ""));
    const select = database.prepare("SELECT sql FROM sqlite_schema WHERE name = ? AND sql IS NOT NULL");
    return names.map((name) => {
      const row = select.get(name) as { sql?: unknown } | undefined;
      if (typeof row?.sql !== "string") throw new Error(`Missing migrated schema object: ${name}`);
      return `${row.sql};`;
    }).join("\n");
  } finally {
    database.close();
  }
}
