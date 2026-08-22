import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { APPLICATION_MIGRATIONS } from "@guild/application";
import { afterEach, describe, expect, it } from "vitest";
import { readMigrationDirectory } from "./migrate-vps.js";
import { migrateVpsDatabase, type VpsMigration } from "./vps-migration.js";

const coreEntry = APPLICATION_MIGRATIONS[0]!;
const coreMigration: VpsMigration = Object.freeze({
  ...coreEntry,
  sql: readFileSync(fileURLToPath(new URL(
    "../../packages/persistence-sqlite/src/migrations/generated/0000_core.sql",
    import.meta.url,
  )), "utf8"),
});
const databases: DatabaseSync[] = [];

afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("VPS application migrations", () => {
  it("loads the shared directory in manifest order", async () => {
    const migrations = await readMigrationDirectory(fileURLToPath(new URL(
      "../../packages/persistence-sqlite/src/migrations/generated/",
      import.meta.url,
    )));
    expect(migrations.map(({ id, ordinal, file, checksum }) => ({ id, ordinal, file, checksum })))
      .toEqual(APPLICATION_MIGRATIONS);
    expect(migrations[0]!.sql).toBe(coreMigration.sql);
  });

  it("applies 0000 to an empty database and is idempotent", () => {
    const database = memoryDatabase();
    expect(migrateVpsDatabase(database, [coreMigration])).toBe("applied");
    const seededRoles = database.prepare("SELECT count(*) AS count FROM roles").get();
    expect(database.prepare("SELECT id, ordinal, checksum FROM app_migrations").all()).toEqual([{
      id: coreEntry.id,
      ordinal: coreEntry.ordinal,
      checksum: coreEntry.checksum,
    }]);
    expect(migrateVpsDatabase(database, [coreMigration])).toBe("current");
    expect(database.prepare("SELECT count(*) AS count FROM roles").get()).toEqual(seededRoles);
  });

  it("applies a temporary 0001 fixture after the existing complete prefix", () => {
    const database = memoryDatabase();
    const next = fixtureMigration(
      "0001_fixture",
      1,
      "CREATE TABLE migration_fixture (value TEXT NOT NULL);\nINSERT INTO migration_fixture VALUES ('ok');",
    );
    expect(migrateVpsDatabase(database, [coreMigration])).toBe("applied");
    expect(migrateVpsDatabase(database, [coreMigration, next])).toBe("applied");
    expect(database.prepare("SELECT value FROM migration_fixture").get()).toEqual({ value: "ok" });
    expect(migrateVpsDatabase(database, [coreMigration, next])).toBe("current");
  });

  it("rejects manifest gaps and SQL or ledger checksum mismatches before further mutation", () => {
    const gapDatabase = memoryDatabase();
    const gap = fixtureMigration("0002_gap", 2, "CREATE TABLE gap_marker (id INTEGER PRIMARY KEY);");
    expect(() => migrateVpsDatabase(gapDatabase, [coreMigration, gap])).toThrow(/gap|ordinal/i);
    expect(gapDatabase.prepare("SELECT name FROM sqlite_master WHERE name = 'app_migrations'").get())
      .toBeUndefined();

    const sqlMismatchDatabase = memoryDatabase();
    expect(() => migrateVpsDatabase(sqlMismatchDatabase, [{
      ...coreMigration,
      checksum: "0".repeat(64),
    }])).toThrow(/checksum mismatch/i);
    expect(sqlMismatchDatabase.prepare("SELECT name FROM sqlite_master WHERE name = 'app_migrations'").get())
      .toBeUndefined();

    const ledgerMismatchDatabase = memoryDatabase();
    migrateVpsDatabase(ledgerMismatchDatabase, [coreMigration]);
    ledgerMismatchDatabase.exec("DROP TRIGGER app_migrations_immutable_update");
    ledgerMismatchDatabase.prepare("UPDATE app_migrations SET checksum = ? WHERE ordinal = 0")
      .run("0".repeat(64));
    expect(() => migrateVpsDatabase(ledgerMismatchDatabase, [coreMigration])).toThrow(/schema mismatch/i);
  });

  it("refuses an unknown non-empty database", () => {
    const database = memoryDatabase();
    database.exec("CREATE TABLE existing_data (id INTEGER PRIMARY KEY)");
    expect(() => migrateVpsDatabase(database, [coreMigration])).toThrow(/non-empty unknown database/i);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'existing_data'").get())
      .toBeTruthy();
  });

  it("rejects a current ledger when canonical schema objects or foreign keys are damaged", () => {
    const missingObject = memoryDatabase();
    migrateVpsDatabase(missingObject, [coreMigration]);
    missingObject.exec("DROP INDEX idx_announcements_public");
    expect(() => migrateVpsDatabase(missingObject, [coreMigration])).toThrow(/canonical schema/i);

    const brokenForeignKey = memoryDatabase();
    migrateVpsDatabase(brokenForeignKey, [coreMigration]);
    brokenForeignKey.exec("PRAGMA foreign_keys = OFF");
    brokenForeignKey.prepare(
      "INSERT INTO member_profiles (user_id, revision_token) VALUES ('missing-user', 'missing-user-revision')",
    ).run();
    expect(() => migrateVpsDatabase(brokenForeignKey, [coreMigration])).toThrow(/foreign-key/i);
  });

  it("rejects unexpected legacy schema objects while ignoring runtime-owned internals", () => {
    const database = memoryDatabase();
    migrateVpsDatabase(database, [coreMigration]);
    database.exec("CREATE TABLE legacy_users (id TEXT PRIMARY KEY)");
    expect(() => migrateVpsDatabase(database, [coreMigration])).toThrow(/unexpected object: legacy_users/i);

    database.exec("DROP TABLE legacy_users; CREATE TABLE _cf_runtime_metadata (value TEXT)");
    expect(migrateVpsDatabase(database, [coreMigration])).toBe("current");
  });

  it("rolls back every object when a migration fails", () => {
    const database = memoryDatabase();
    const broken = fixtureMigration(
      "0000_broken",
      0,
      "CREATE TABLE partial (id INTEGER PRIMARY KEY);\nINSERT INTO missing_table VALUES (1);",
    );
    expect(() => migrateVpsDatabase(database, [broken])).toThrow();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'partial'").get()).toBeUndefined();
  });
});

function fixtureMigration(id: string, ordinal: number, bodySql: string): VpsMigration {
  const body = `${bodySql.trimEnd()}\n--> statement-breakpoint\n`;
  const checksum = createHash("sha256").update(body).digest("hex");
  return Object.freeze({
    id,
    ordinal,
    file: `${id}.sql`,
    checksum,
    sql: `${body}-- app-migration-ledger\nINSERT INTO app_migrations (id, ordinal, checksum) VALUES ('${id}', ${ordinal}, '${checksum}');\n`,
  });
}

function memoryDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  return database;
}
