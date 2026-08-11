import type { SqlExecutor } from "@guild/kernel";
import { APP_MIGRATION_MANIFEST } from "@guild/persistence-sqlite";

export type ApplicationMigration = Readonly<{
  id: string;
  ordinal: number;
  file: string;
  checksum: string;
}>;

export const APPLICATION_MIGRATIONS = parseMigrationManifest(APP_MIGRATION_MANIFEST);

export function parseMigrationManifest(value: unknown): readonly ApplicationMigration[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("Migration manifest must not be empty");
  return Object.freeze(value.map((candidate, ordinal) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TypeError(`Migration manifest entry ${ordinal} must be an object`);
    }
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.id !== "string" || !/^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(entry.id)) {
      throw new TypeError(`Migration manifest entry ${ordinal} has an invalid id`);
    }
    if (entry.ordinal !== ordinal) {
      throw new TypeError(`Migration manifest has a gap or duplicate at ordinal ${ordinal}`);
    }
    if (entry.file !== `${entry.id}.sql`) {
      throw new TypeError(`Migration manifest entry ${ordinal} must use file ${entry.id}.sql`);
    }
    if (typeof entry.checksum !== "string" || !/^[0-9a-f]{64}$/.test(entry.checksum)) {
      throw new TypeError(`Migration manifest entry ${ordinal} has an invalid checksum`);
    }
    return Object.freeze({
      id: entry.id,
      ordinal,
      file: entry.file,
      checksum: entry.checksum,
    });
  }));
}

export function assertMigrationLedger(
  rows: unknown,
  expected: readonly ApplicationMigration[] = APPLICATION_MIGRATIONS,
): void {
  if (!Array.isArray(rows) || rows.length !== expected.length) throw schemaMismatch(expected);
  for (const [ordinal, migration] of expected.entries()) {
    const row = rows[ordinal];
    if (
      !Array.isArray(row)
      || row.length !== 3
      || row[0] !== migration.id
      || row[1] !== migration.ordinal
      || row[2] !== migration.checksum
    ) {
      throw schemaMismatch(expected);
    }
  }
}

export async function assertApplicationSchema(sql: SqlExecutor): Promise<void> {
  let rows;
  try {
    rows = (await sql.execute({
      method: "all",
      sql: "SELECT id, ordinal, checksum FROM app_migrations ORDER BY ordinal",
    })).rows;
  } catch (cause) {
    throw new Error("Database schema is not initialized; run the selected backend migration command", { cause });
  }
  assertMigrationLedger(rows);
}

function schemaMismatch(expected: readonly ApplicationMigration[]): Error {
  return new Error(`Database schema mismatch; expected ${expected.length} ordered application migrations`);
}
