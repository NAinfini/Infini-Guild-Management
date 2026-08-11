import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { applyPrivateVpsMigration } from "./private-vps-migration.js";

export async function runPrivateVpsMigration(argumentsList: readonly string[]): Promise<Readonly<{
  databasePath: string;
  migrationPath: string;
}>> {
  const databasePath = path.resolve(option(argumentsList, "--database"));
  const migrationPath = path.resolve(option(argumentsList, "--migration"));
  await access(databasePath);
  const database = new DatabaseSync(databasePath);
  try {
    applyPrivateVpsMigration(database, await readFile(migrationPath, "utf8"));
    return Object.freeze({ databasePath, migrationPath });
  } finally {
    database.close();
  }
}

function option(argumentsList: readonly string[], name: string): string {
  const index = argumentsList.indexOf(name);
  const value = index >= 0 ? argumentsList[index + 1]?.trim() : undefined;
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

if (import.meta.main) {
  runPrivateVpsMigration(process.argv.slice(2)).then(({ databasePath, migrationPath }) => {
    console.info(`Applied private migration ${migrationPath} to ${databasePath}`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Private VPS migration failed");
    process.exitCode = 1;
  });
}
