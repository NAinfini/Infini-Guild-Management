import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { parseMigrationManifest } from "@guild/application";
import { migrateVpsDatabase, type VpsMigration } from "./vps-migration.js";

export const DEFAULT_VPS_MIGRATIONS = fileURLToPath(new URL(
  "../../packages/persistence-sqlite/src/migrations/generated",
  import.meta.url,
));

export async function runVpsMigration(argumentsList: readonly string[]): Promise<Readonly<{
  databasePath: string;
  result: "applied" | "current";
}>> {
  const databasePath = path.resolve(option(argumentsList, "--database"));
  const migrationsPath = path.resolve(optionalOption(argumentsList, "--migrations") ?? DEFAULT_VPS_MIGRATIONS);
  const migrations = await readMigrationDirectory(migrationsPath);
  await mkdir(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    const result = migrateVpsDatabase(database, migrations);
    return Object.freeze({ databasePath, result });
  } finally {
    database.close();
  }
}

export async function readMigrationDirectory(directory: string): Promise<readonly VpsMigration[]> {
  const source = await readFile(path.join(directory, "manifest.json"), "utf8");
  const manifest = parseMigrationManifest(JSON.parse(source) as unknown);
  const sqlFiles = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const expectedFiles = manifest.map(({ file }) => file);
  if (JSON.stringify(sqlFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("Migration directory SQL files do not match manifest order and contents");
  }
  return Object.freeze(await Promise.all(manifest.map(async (entry) => Object.freeze({
    ...entry,
    sql: await readFile(path.join(directory, entry.file), "utf8"),
  }))));
}

function option(argumentsList: readonly string[], name: string): string {
  const value = optionalOption(argumentsList, name);
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

function optionalOption(argumentsList: readonly string[], name: string): string | undefined {
  const index = argumentsList.indexOf(name);
  const value = index >= 0 ? argumentsList[index + 1]?.trim() : undefined;
  return value || undefined;
}

if (import.meta.main) {
  runVpsMigration(process.argv.slice(2)).then(({ databasePath, result }) => {
    console.info(`VPS database ${result}: ${databasePath}`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "VPS migration failed");
    process.exitCode = 1;
  });
}
