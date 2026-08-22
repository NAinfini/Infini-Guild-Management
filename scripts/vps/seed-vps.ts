import { access, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { FilesystemBlobStore } from "@guild/vps/adapters";
import {
  DEVELOPMENT_MEDIA_DATABASE_STATEMENTS,
  DEVELOPMENT_MEDIA_DATABASE_PREFLIGHT_STATEMENT,
  assertDevelopmentMediaDatabasePreflight,
  seedDevelopmentMediaObjects,
} from "../dev/media-fixtures.mjs";

const DEFAULT_SEED = fileURLToPath(new URL("../dev/seed.sql", import.meta.url));

export async function seedLocalVps(argumentsList: readonly string[]): Promise<Readonly<{
  databasePath: string;
  blobPath: string;
  result: "applied" | "current" | "skipped";
  media: Readonly<{ processed: number; total: number }> | null;
}>> {
  const databasePath = path.resolve(option(argumentsList, "--database"));
  const blobPath = path.resolve(optionalOption(argumentsList, "--blobs") ?? path.join(path.dirname(databasePath), "blobs"));
  const seedPath = path.resolve(optionalOption(argumentsList, "--seed") ?? DEFAULT_SEED);
  await Promise.all([access(databasePath), access(seedPath)]);

  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const ownerExisted = developmentOwnerExists(database);
    let media: Readonly<{ processed: number; total: number }> | null = null;
    let ownerExists = false;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(await readFile(seedPath, "utf8"));
      ownerExists = developmentOwnerExists(database);
      if (ownerExists) {
        assertDevelopmentMediaDatabasePreflight(database.prepare(
          DEVELOPMENT_MEDIA_DATABASE_PREFLIGHT_STATEMENT,
        ).get());
        media = await seedDevelopmentMediaObjects(new FilesystemBlobStore(blobPath));
        for (const statement of DEVELOPMENT_MEDIA_DATABASE_STATEMENTS) database.exec(statement);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return Object.freeze({
      databasePath,
      blobPath,
      result: ownerExisted ? "current" : ownerExists ? "applied" : "skipped",
      media,
    });
  } finally {
    database.close();
  }
}

function developmentOwnerExists(database: DatabaseSync): boolean {
  const row = database.prepare("SELECT count(*) AS count FROM users WHERE id = 'dev-owner'").get() as {
    count: number;
  };
  return row.count === 1;
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
  seedLocalVps(process.argv.slice(2)).then(({ databasePath, result }) => {
    console.info(`VPS development seed ${result}: ${databasePath}`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "VPS development seed failed");
    process.exitCode = 1;
  });
}
