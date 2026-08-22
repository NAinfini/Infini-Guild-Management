import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  APPLICATION_MIGRATIONS,
  assertMigrationLedger,
  parseMigrationManifest,
  type ApplicationMigration,
} from "@guild/application";
import { canonicalMigrationPayload } from "@guild/persistence-sqlite";

export type VpsMigration = ApplicationMigration & Readonly<{ sql: string }>;
export type VpsMigrationResult = "applied" | "current";

export function migrateVpsDatabase(
  database: DatabaseSync,
  migrations: readonly VpsMigration[],
): VpsMigrationResult {
  const expected = validateVpsMigrations(migrations);
  database.exec("PRAGMA foreign_keys = ON");

  const tables = database.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND substr(name, 1, 4) <> '_cf_'
    ORDER BY name`).all() as Array<{ name: string }>;
  const hasLedger = tables.some(({ name }) => name === "app_migrations");
  if (!hasLedger && tables.length > 0) {
    throw new Error("Refusing to apply application migrations to a non-empty unknown database");
  }

  const applied = hasLedger ? readLedgerRows(database) : [];
  if (applied.length > expected.length) throw new Error("Database migration ledger is ahead of this release");
  assertMigrationLedger(applied, expected.slice(0, applied.length));
  if (applied.length === expected.length) {
    assertCurrentVpsSchema(database, expected, migrations);
    return "current";
  }

  for (let ordinal = applied.length; ordinal < migrations.length; ordinal += 1) {
    applyMigration(database, migrations[ordinal]!, expected.slice(0, ordinal + 1));
  }
  assertCurrentVpsSchema(database, expected, migrations);
  return "applied";
}

export function assertCurrentVpsDatabase(
  database: DatabaseSync,
  migrations: readonly VpsMigration[],
): void {
  const expected = validateVpsMigrations(migrations);
  database.exec("PRAGMA foreign_keys = ON");
  assertCurrentVpsSchema(database, expected, migrations);
}

export function assertCurrentVpsSchema(
  database: DatabaseSync,
  expected: readonly ApplicationMigration[] = APPLICATION_MIGRATIONS,
  migrations?: readonly VpsMigration[],
): void {
  assertMigrationLedger(readLedgerRows(database), expected);
  assertDatabaseIntegrity(database);
  if (migrations) assertCanonicalSchema(database, migrations);
}

function applyMigration(
  database: DatabaseSync,
  migration: VpsMigration,
  expectedPrefix: readonly ApplicationMigration[],
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(migration.sql.replaceAll("--> statement-breakpoint", ""));
    assertMigrationLedger(readLedgerRows(database), expectedPrefix);
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error(`Application migration ${migration.id} produced foreign-key violations`);
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function validateMigrationSql(migration: VpsMigration, expected: ApplicationMigration): void {
  if (!migration.sql.trim()) throw new TypeError(`Application migration ${expected.id} SQL is empty`);
  let payload: string;
  try {
    payload = canonicalMigrationPayload(migration.sql);
  } catch (cause) {
    throw new TypeError(`Application migration ${expected.id} must contain exactly one ledger marker`, { cause });
  }
  const checksum = createHash("sha256").update(payload).digest("hex");
  if (checksum !== expected.checksum) {
    throw new Error(`Application migration ${expected.id} checksum mismatch`);
  }
}

function validateVpsMigrations(migrations: readonly VpsMigration[]): readonly ApplicationMigration[] {
  const expected = parseMigrationManifest(migrations.map(({ id, ordinal, file, checksum }) => ({
    id,
    ordinal,
    file,
    checksum,
  })));
  migrations.forEach((migration, ordinal) => validateMigrationSql(migration, expected[ordinal]!));
  return expected;
}

function readLedgerRows(database: DatabaseSync): unknown[][] {
  return (database.prepare(
    "SELECT id, ordinal, checksum FROM app_migrations ORDER BY ordinal",
  ).all() as Array<{ id: unknown; ordinal: unknown; checksum: unknown }>).map(
    ({ id, ordinal, checksum }) => [id, ordinal, checksum],
  );
}

function assertDatabaseIntegrity(database: DatabaseSync): void {
  const integrity = database.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: unknown }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    throw new Error("VPS database integrity check failed");
  }
  if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
    throw new Error("VPS database contains foreign-key violations");
  }
}

function assertCanonicalSchema(database: DatabaseSync, migrations: readonly VpsMigration[]): void {
  const expectedDatabase = new DatabaseSync(":memory:");
  try {
    expectedDatabase.exec("PRAGMA foreign_keys = ON");
    for (const migration of migrations) {
      expectedDatabase.exec(migration.sql.replaceAll("--> statement-breakpoint", ""));
    }
    const actual = schemaObjects(database);
    const expectedObjects = schemaObjects(expectedDatabase);
    for (const [name, expected] of expectedObjects) {
      const value = actual.get(name);
      if (!value || value.type !== expected.type || value.table !== expected.table || value.sql !== expected.sql) {
        throw new Error(`VPS canonical schema object mismatch: ${name}`);
      }
    }
    for (const name of actual.keys()) {
      if (!expectedObjects.has(name)) throw new Error(`VPS canonical schema contains unexpected object: ${name}`);
    }
  } finally {
    expectedDatabase.close();
  }
}

function schemaObjects(database: DatabaseSync): Map<string, Readonly<{
  type: string;
  table: string;
  sql: string;
}>> {
  const rows = database.prepare(`SELECT type, name, tbl_name AS table_name, sql
    FROM sqlite_schema
    WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
      AND substr(name, 1, 4) <> '_cf_'
    ORDER BY type, name`).all() as Array<{
      type: string;
      name: string;
      table_name: string;
      sql: string;
    }>;
  return new Map(rows.map((row) => [row.name, {
    type: row.type,
    table: row.table_name,
    sql: row.sql,
  }]));
}
