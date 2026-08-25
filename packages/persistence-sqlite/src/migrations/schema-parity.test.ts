import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { getTableName, type SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { appSchema } from "../schema/app-schema.js";

const manifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("./generated/manifest.json", import.meta.url)),
  "utf8",
)) as Array<{ id: string; ordinal: number; file: string }>;
const drizzleJournal = JSON.parse(readFileSync(
  fileURLToPath(new URL("./generated/meta/_journal.json", import.meta.url)),
  "utf8",
)) as { entries: Array<{ idx: number; tag: string }> };
const baselineSnapshot = JSON.parse(readFileSync(
  fileURLToPath(new URL("./generated/meta/0000_snapshot.json", import.meta.url)),
  "utf8",
)) as DrizzleSnapshot;
const latestMigration = manifest.at(-1)!;
const latestSnapshot = JSON.parse(readFileSync(
  fileURLToPath(new URL(
    `./generated/meta/${String(latestMigration.ordinal).padStart(4, "0")}_snapshot.json`,
    import.meta.url,
  )),
  "utf8",
)) as DrizzleSnapshot;
const migration = manifest.map(({ file }) => readFileSync(
  fileURLToPath(new URL(`./generated/${file}`, import.meta.url)),
  "utf8",
)).join("\n").replaceAll("--> statement-breakpoint", "");
const dialect = new SQLiteSyncDialect();

describe("Drizzle schema and core migration parity", () => {
  it("keeps the generation journal and latest snapshot aligned with the migration manifest", () => {
    expect(drizzleJournal.entries.map(({ idx, tag }) => ({ idx, tag }))).toEqual(
      manifest.map(({ id, ordinal }) => ({ idx: ordinal, tag: id })),
    );
    expect(latestSnapshot.prevId).toBe(baselineSnapshot.id);

    const configs = Object.values(appSchema).map((table) => getTableConfig(table));
    expect(Object.keys(latestSnapshot.tables).sort()).toEqual(configs.map(({ name }) => name).sort());
    for (const config of configs) {
      const snapshot = latestSnapshot.tables[config.name];
      expect(snapshot, `${config.name} snapshot`).toBeDefined();
      expect(Object.keys(snapshot!.columns).sort(), `${config.name} snapshot fields`)
        .toEqual(config.columns.map(({ name }) => name).sort());
      expect(Object.keys(snapshot!.indexes).sort(), `${config.name} snapshot indexes`)
        .toEqual([
          ...config.indexes.map(({ config: index }) => index.name),
          ...config.columns.flatMap((column) => column.isUnique && column.uniqueName ? [column.uniqueName] : []),
        ].sort());
      expect(Object.keys(snapshot!.checkConstraints).sort(), `${config.name} snapshot checks`)
        .toEqual(config.checks.map(({ name }) => name).sort());
    }
  });

  it("matches every table field, foreign key, check, and index", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(migration);
      const configs = Object.values(appSchema).map((table) => getTableConfig(table));
      const expectedTableNames = configs.map(({ name }) => name).sort();
      const actualTableNames = values(
        database,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      expect(configs).toHaveLength(66);
      expect(new Set(expectedTableNames).size).toBe(66);
      expect(actualTableNames).toEqual(expectedTableNames);

      for (const config of configs) {
        const primaryColumns = config.primaryKeys[0]?.columns ?? config.columns.filter(({ primary }) => primary);
        const primaryOrder = new Map(primaryColumns.map(({ name }, index) => [name, index + 1]));
        const actualColumns = pragma<ColumnRow>(database, "table_xinfo", config.name)
          .filter(({ hidden }) => hidden === 0)
          .map((column) => ({
            name: column.name,
            type: column.type.toLowerCase(),
            notNull: column.notnull === 1,
            default: normalizeDefault(column.dflt_value),
            primaryKeyOrder: column.pk,
          }));
        const expectedColumns = config.columns.map((column) => ({
          name: column.name,
          type: column.getSQLType().toLowerCase(),
          notNull: column.notNull,
          default: renderDefault(column.default),
          primaryKeyOrder: primaryOrder.get(column.name) ?? 0,
        }));
        expect(actualColumns, `${config.name} fields`).toEqual(expectedColumns);

        const actualForeignKeys = groupForeignKeys(pragma<ForeignKeyRow>(database, "foreign_key_list", config.name));
        const expectedForeignKeys = config.foreignKeys.map((foreignKey) => {
          const reference = foreignKey.reference();
          return {
            columns: reference.columns.map(({ name }) => name),
            foreignTable: getTableName(reference.foreignTable),
            foreignColumns: reference.foreignColumns.map(({ name }) => name),
            onUpdate: (foreignKey.onUpdate ?? "no action").toLowerCase(),
            onDelete: (foreignKey.onDelete ?? "no action").toLowerCase(),
          };
        }).sort(compareJson);
        expect(actualForeignKeys, `${config.name} foreign keys`).toEqual(expectedForeignKeys);

        const tableSql = String((database.prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        ).get(config.name) as { sql: string }).sql);
        if (config.name === "scheduled_job_leases") expect(tableSql).toMatch(/WITHOUT ROWID$/i);
        const actualCheckNames = [
          ...tableSql.matchAll(/CONSTRAINT\s+(?:["`]([^"`]+)["`]|([A-Za-z_][A-Za-z0-9_]*))\s+CHECK/gi),
        ]
          .map((match) => (match[1] ?? match[2])!)
          .sort();
        expect(actualCheckNames, `${config.name} checks`).toEqual(config.checks.map(({ name }) => name).sort());
        const normalizedTableSql = normalizeSql(tableSql);
        const normalizedCheckSql = withoutTableQualifiers(normalizedTableSql);
        for (const check of config.checks) {
          const expectedCheck = withoutTableQualifiers(normalizeSql(
            `CONSTRAINT ${check.name} CHECK(${dialect.sqlToQuery(check.value).sql})`,
          ));
          expect(normalizedCheckSql, `${config.name}.${check.name}`).toContain(expectedCheck);
        }

        const actualIndexes = database.prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name",
        ).all(config.name) as Array<{ name: string; sql: string }>;
        const columnUniqueIndexes = config.columns.flatMap((column) =>
          column.isUnique && column.uniqueName
            ? [{
                name: column.uniqueName,
                sql: `CREATE UNIQUE INDEX ${column.uniqueName} ON ${config.name} (${column.name})`,
              }]
            : []
        );
        const expectedIndexNames = [
          ...config.indexes.map(({ config: index }) => index.name),
          ...columnUniqueIndexes.map(({ name }) => name),
        ].sort();
        expect(actualIndexes.map(({ name }) => name), `${config.name} indexes`)
          .toEqual(expectedIndexNames);
        const actualByName = new Map(actualIndexes.map((index) => [index.name, index.sql]));
        for (const { config: index } of config.indexes) {
          expect(normalizeIndexSql(actualByName.get(index.name)!), `${config.name}.${index.name}`)
            .toBe(normalizeIndexSql(renderIndex(config.name, index)));
        }
        for (const index of columnUniqueIndexes) {
          expect(normalizeIndexSql(actualByName.get(index.name)!), `${config.name}.${index.name}`)
            .toBe(normalizeIndexSql(index.sql));
        }

        const actualUniqueColumns = pragma<IndexListRow>(database, "index_list", config.name)
          .filter(({ unique, origin }) => unique === 1 && origin === "u")
          .map(({ name }) => pragma<IndexInfoRow>(database, "index_info", name)
            .sort((left, right) => left.seqno - right.seqno)
            .map((row) => row.name))
          .sort(compareJson);
        const expectedUniqueColumns = config.uniqueConstraints
          .map(({ columns }) => columns.map(({ name }) => name))
          .sort(compareJson);
        expect(actualUniqueColumns, `${config.name} unique constraints`).toEqual(expectedUniqueColumns);
      }
    } finally {
      database.close();
    }
  });
});

function renderIndex(
  tableName: string,
  index: ReturnType<typeof getTableConfig>["indexes"][number]["config"],
): string {
  const columns = index.columns.map((column) => {
    if (typeof column === "object" && column !== null && "name" in column) {
      return String(column.name);
    }
    return dialect.sqlToQuery(column as SQL).sql;
  });
  const where = index.where ? ` WHERE ${dialect.sqlToQuery(index.where).sql}` : "";
  return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${index.name} ON ${tableName} (${columns.join(", ")})${where}`;
}

function renderDefault(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === "object" && value !== null) {
    return normalizeDefault(dialect.sqlToQuery(value as SQL).sql);
  }
  return normalizeDefault(String(value));
}

function normalizeDefault(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/g, " ").replace(/^\((.*)\)$/, "$1");
  if (normalized.startsWith("'") && normalized.endsWith("'")) {
    return normalized.slice(1, -1).replaceAll("''", "'");
  }
  return normalized;
}

function groupForeignKeys(rows: readonly ForeignKeyRow[]) {
  const groups = new Map<number, ForeignKeyRow[]>();
  for (const row of rows) groups.set(row.id, [...(groups.get(row.id) ?? []), row]);
  return [...groups.values()].map((group) => {
    const ordered = group.sort((left, right) => left.seq - right.seq);
    return {
      columns: ordered.map(({ from }) => from),
      foreignTable: ordered[0]!.table,
      foreignColumns: ordered.map(({ to }) => to),
      onUpdate: ordered[0]!.on_update.toLowerCase(),
      onDelete: ordered[0]!.on_delete.toLowerCase(),
    };
  }).sort(compareJson);
}

function pragma<T>(database: DatabaseSync, name: string, target: string): T[] {
  const quoted = target.replaceAll('"', '""');
  return database.prepare(`PRAGMA ${name}("${quoted}")`).all() as T[];
}

function values(database: DatabaseSync, sql: string): string[] {
  return database.prepare(sql).all().map((row) => String(Object.values(row)[0]));
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/["`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .replace(/;$/, "")
    .trim()
    .toLowerCase();
}

function normalizeIndexSql(sql: string): string {
  return withoutTableQualifiers(normalizeSql(sql));
}

function withoutTableQualifiers(sql: string): string {
  return sql.replace(/\b[a-z_][a-z0-9_]*\./g, "");
}

function compareJson(left: unknown, right: unknown): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

interface ColumnRow {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
  readonly hidden: number;
}

interface ForeignKeyRow {
  readonly id: number;
  readonly seq: number;
  readonly table: string;
  readonly from: string;
  readonly to: string;
  readonly on_update: string;
  readonly on_delete: string;
}

interface IndexListRow {
  readonly name: string;
  readonly origin: string;
  readonly unique: number;
}

interface IndexInfoRow {
  readonly seqno: number;
  readonly name: string;
}

interface DrizzleSnapshot {
  readonly id: string;
  readonly prevId: string;
  readonly tables: Readonly<Record<string, Readonly<{
    columns: Readonly<Record<string, unknown>>;
    indexes: Readonly<Record<string, unknown>>;
    checkConstraints: Readonly<Record<string, unknown>>;
  }>>>;
}
