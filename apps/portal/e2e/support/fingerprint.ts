import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { persistDirForSlot, type SiteFingerprint } from "./config";

type SqliteRow = Record<string, unknown>;

const CLEANUP_VOLATILE_COLUMNS: Readonly<Record<string, ReadonlySet<string>>> = {
  member_profiles: new Set(["revision_token", "updated_at"]),
  site_config: new Set(["revision_token", "updated_at"]),
  wiki_category_state: new Set(["revision_token", "updated_at"]),
};

export async function readSlotFingerprint(slot: number): Promise<SiteFingerprint> {
  const persistDir = persistDirForSlot(slot);
  const d1 = await findDatabase(
    resolve(persistDir, "v3", "d1", "miniflare-D1DatabaseObject"),
    "app_migrations",
  );
  if (!d1) throw new Error(`E2E slot ${slot} has no migrated local D1 database at ${persistDir}`);

  return {
    ...fingerprintD1(d1),
    ...(await fingerprintR2(resolve(persistDir, "v3", "r2", "miniflare-R2BucketObject"))),
  };
}

function fingerprintD1(path: string): SiteFingerprint {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = (database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    ).all() as Array<{ name: string }>).map(({ name }) => name);
    const result: SiteFingerprint = {};
    for (const table of tables) {
      const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as SqliteRow[];
      result[`table:${table}:rows`] = rows.length;
      result[`table:${table}:sha256`] = hashTableRows(table, rows);
    }
    return result;
  } finally {
    database.close();
  }
}

async function fingerprintR2(directory: string): Promise<SiteFingerprint> {
  const objects: SqliteRow[] = [];
  for (const path of await sqliteFiles(directory)) {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      if (!hasTable(database, "_mf_objects")) continue;
      objects.push(...database.prepare(
        "SELECT key, size, etag, uploaded, checksums, http_metadata, custom_metadata FROM _mf_objects",
      ).all() as SqliteRow[]);
    } finally {
      database.close();
    }
  }
  return {
    "blob:objects:rows": objects.length,
    "blob:objects:bytes": objects.reduce((total, row) => total + Number(row.size ?? 0), 0),
    "blob:objects:sha256": hashRows(objects),
  };
}

async function findDatabase(directory: string, table: string): Promise<string | null> {
  const matches: string[] = [];
  for (const path of await sqliteFiles(directory)) {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      if (hasTable(database, table)) matches.push(path);
    } finally {
      database.close();
    }
  }
  if (matches.length > 1) throw new Error(`Found multiple local databases containing ${table}`);
  return matches[0] ?? null;
}

async function sqliteFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
      .map((entry) => join(directory, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function hasTable(database: DatabaseSync, table: string): boolean {
  return database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) !== undefined;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function hashRows(rows: readonly SqliteRow[]): string {
  const canonical = rows.map((row) => JSON.stringify(
    Object.keys(row).sort().map((key) => [key, normalizeValue(row[key])]),
  )).sort();
  return createHash("sha256").update(canonical.join("\n")).digest("hex");
}

export function hashTableRows(table: string, rows: readonly SqliteRow[]): string {
  const ignored = CLEANUP_VOLATILE_COLUMNS[table];
  if (!ignored) return hashRows(rows);
  return hashRows(rows.map((row) => Object.fromEntries(
    Object.entries(row).filter(([column]) => !ignored.has(column)),
  )));
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return { bytes: Buffer.from(value).toString("base64") };
  if (typeof value === "bigint") return { bigint: value.toString() };
  return value;
}
