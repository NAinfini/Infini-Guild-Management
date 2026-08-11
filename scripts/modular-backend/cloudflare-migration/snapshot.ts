import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { LEGACY_COLUMNS, LEGACY_SCHEMA, SOURCE_SCHEMA_SHA256, parseLegacySnapshot, type LegacySnapshot, type LegacyTable } from "./migration.js";

export const SNAPSHOT_PAGE_SIZE = 100;
const WRANGLER_CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../../../node_modules/wrangler/bin/wrangler.js");

type Scalar = null | string | number;
type SnapshotPlanTable = Readonly<{
  name: LegacyTable;
  columns: readonly string[];
  cursorColumns: readonly string[];
  countBeforeSql: string;
  firstPageSql: string;
  nextPageSql: string;
  countAfterSql: string;
}>;

export type SnapshotPlan = Readonly<{
  version: 1;
  schema: typeof LEGACY_SCHEMA;
  schemaFingerprint: typeof SOURCE_SCHEMA_SHA256;
  pageSize: typeof SNAPSHOT_PAGE_SIZE;
  tables: readonly SnapshotPlanTable[];
}>;

export function buildSnapshotPlan(schemaSql: string): SnapshotPlan {
  const fingerprint = sha256(schemaSql);
  if (fingerprint !== SOURCE_SCHEMA_SHA256) throw new TypeError(`Source schema SHA-256 ${fingerprint} is not the confirmed production fingerprint`);
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(schemaSql);
    const actualTables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    assertSameSet(actualTables, Object.keys(LEGACY_COLUMNS), "source schema tables");
    const tables = (Object.keys(LEGACY_COLUMNS) as LegacyTable[]).sort().map((name) => {
      const info = database.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as { name: string; notnull: number; pk: number }[];
      const columns = info.map((column) => column.name);
      if (!sameStrings(columns, LEGACY_COLUMNS[name])) throw new TypeError(`Source schema columns for ${name} differ from the confirmed contract`);
      const primaryKey = info.filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk).map((column) => column.name);
      const cursorColumns = primaryKey.length > 0 ? primaryKey : uniqueCursor(database, name, info);
      if (cursorColumns.length === 0) throw new TypeError(`Source table ${name} has no stable unique pagination key`);
      const select = columns.map(quoteIdentifier).join(", ");
      const order = cursorColumns.map(quoteIdentifier).join(", ");
      return Object.freeze({
        name,
        columns: Object.freeze(columns),
        cursorColumns: Object.freeze(cursorColumns),
        countBeforeSql: `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(name)};`,
        firstPageSql: `SELECT ${select} FROM ${quoteIdentifier(name)} ORDER BY ${order} LIMIT ${SNAPSHOT_PAGE_SIZE};`,
        nextPageSql: `SELECT ${select} FROM ${quoteIdentifier(name)} WHERE ${cursorPredicate(cursorColumns)} ORDER BY ${order} LIMIT ${SNAPSHOT_PAGE_SIZE};`,
        countAfterSql: `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(name)};`,
      });
    });
    return Object.freeze({ version: 1, schema: LEGACY_SCHEMA, schemaFingerprint: SOURCE_SCHEMA_SHA256, pageSize: SNAPSHOT_PAGE_SIZE, tables: Object.freeze(tables) });
  } finally {
    database.close();
  }
}

function uniqueCursor(database: DatabaseSync, table: string, info: readonly { name: string; notnull: number }[]): string[] {
  const nullable = new Map(info.map((column) => [column.name, column.notnull === 0]));
  const indexes = database.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all() as { name: string; unique: number; partial: number }[];
  for (const index of indexes.filter((entry) => entry.unique === 1 && entry.partial === 0).sort((left, right) => left.name.localeCompare(right.name))) {
    const columns = (database.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`).all() as { seqno: number; name: string }[])
      .sort((left, right) => left.seqno - right.seqno).map((entry) => entry.name);
    if (columns.length > 0 && columns.every((column) => nullable.get(column) === false)) return columns;
  }
  return [];
}

function cursorPredicate(columns: readonly string[]): string {
  return columns.map((column, index) => {
    const equalPrefix = columns.slice(0, index).map((prefix, prefixIndex) => `${quoteIdentifier(prefix)} = ?${prefixIndex + 1}`);
    return `(${[...equalPrefix, `${quoteIdentifier(column)} > ?${index + 1}`].join(" AND ")})`;
  }).join(" OR ");
}

export function assembleSnapshot(schemaSql: string, captureInput: unknown): LegacySnapshot {
  const plan = buildSnapshotPlan(schemaSql);
  if (!isRecord(captureInput)) throw new TypeError("Snapshot capture must be an object");
  assertExactKeys(captureInput, ["version", "schemaFingerprint", "pageSize", "tables"], "snapshot capture");
  if (captureInput.version !== 1 || captureInput.schemaFingerprint !== SOURCE_SCHEMA_SHA256 || captureInput.pageSize !== SNAPSHOT_PAGE_SIZE || !isRecord(captureInput.tables)) throw new TypeError("Snapshot capture header does not match the confirmed plan");
  assertSameSet(Object.keys(captureInput.tables), plan.tables.map((table) => table.name), "snapshot capture tables");
  const tables: Record<string, { columns: readonly string[]; rows: readonly Record<string, Scalar>[] }> = {};
  for (const table of plan.tables) {
    const captured = captureInput.tables[table.name];
    if (!isRecord(captured)) throw new TypeError(`Snapshot capture ${table.name} must be an object`);
    assertExactKeys(captured, ["columns", "cursorColumns", "beforeCount", "afterCount", "pages"], `snapshot capture ${table.name}`);
    if (!Array.isArray(captured.columns) || !sameStrings(captured.columns, table.columns) || !Array.isArray(captured.cursorColumns) || !sameStrings(captured.cursorColumns, table.cursorColumns)) throw new TypeError(`Snapshot capture ${table.name} columns/cursor differ from plan`);
    if (!Number.isSafeInteger(captured.beforeCount) || !Number.isSafeInteger(captured.afterCount) || Number(captured.beforeCount) < 0 || captured.beforeCount !== captured.afterCount) throw new TypeError(`Snapshot capture ${table.name} changed between before/after counts`);
    if (!Array.isArray(captured.pages)) throw new TypeError(`Snapshot capture ${table.name} pages must be an array`);
    const rows: Record<string, Scalar>[] = [];
    for (const [pageIndex, page] of captured.pages.entries()) {
      if (!Array.isArray(page) || page.length < 1 || page.length > SNAPSHOT_PAGE_SIZE) throw new TypeError(`Snapshot capture ${table.name} page ${pageIndex} must contain 1..${SNAPSHOT_PAGE_SIZE} rows`);
      for (const [rowIndex, raw] of page.entries()) {
        if (!isRecord(raw)) throw new TypeError(`Snapshot capture ${table.name} page ${pageIndex} row ${rowIndex} must be an object`);
        assertExactKeys(raw, table.columns, `snapshot capture ${table.name} row`);
        const row: Record<string, Scalar> = {};
        for (const column of table.columns) {
          const value = raw[column];
          if (value !== null && typeof value !== "string" && typeof value !== "number") throw new TypeError(`Snapshot capture ${table.name}.${column} is not a D1 scalar`);
          row[column] = value as Scalar;
        }
        const previous = rows.at(-1);
        if (previous && compareCursor(previous, row, table.cursorColumns) >= 0) throw new TypeError(`Snapshot capture ${table.name} is not strictly ordered by its unique cursor`);
        rows.push(Object.freeze(row));
      }
    }
    if (rows.length !== captured.beforeCount) throw new TypeError(`Snapshot capture ${table.name} row count ${rows.length} differs from stable count ${captured.beforeCount}`);
    if (rows.length === 0 && captured.pages.length !== 0) throw new TypeError(`Snapshot capture ${table.name} must use zero pages for an empty table`);
    tables[table.name] = { columns: table.columns, rows };
  }
  return parseLegacySnapshot({ version: 1, schema: LEGACY_SCHEMA, schemaFingerprint: SOURCE_SCHEMA_SHA256, tables });
}

function compareCursor(left: Record<string, Scalar>, right: Record<string, Scalar>, columns: readonly string[]): number {
  for (const column of columns) {
    const a = left[column]; const b = right[column];
    if (a === null || b === null || a === undefined || b === undefined) throw new TypeError(`Pagination cursor ${column} cannot be null/missing`);
    if (typeof a !== typeof b) throw new TypeError(`Pagination cursor ${column} changed scalar type`);
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const flags = parseFlags(args);
  const schemaPath = requiredFlag(flags, "schema");
  const outputPath = privateOutput(requiredFlag(flags, "out"));
  const schemaSql = await readFile(schemaPath, "utf8");
  if (command === "plan") {
    await writeJsonAtomic(outputPath, buildSnapshotPlan(schemaSql));
    process.stdout.write(`Snapshot plan written to ${outputPath}; no rows were read or printed.\n`);
    return;
  }
  if (command === "assemble") {
    const capturePath = requiredFlag(flags, "capture");
    const capture = JSON.parse(await readFile(capturePath, "utf8")) as unknown;
    const snapshot = assembleSnapshot(schemaSql, capture);
    await writeJsonAtomic(outputPath, snapshot);
    const rowCount = Object.values(snapshot.tables).reduce((sum, table) => sum + table.rows.length, 0);
    process.stdout.write(`Verified snapshot written to ${outputPath}: ${rowCount} rows; row contents were not printed.\n`);
    return;
  }
  if (command === "collect") {
    const database = requiredFlag(flags, "database");
    const config = requiredFlag(flags, "config");
    const snapshot = await collectRemoteSnapshot(schemaSql, { database, config });
    await writeJsonAtomic(outputPath, snapshot);
    const rowCount = Object.values(snapshot.tables).reduce((sum, table) => sum + table.rows.length, 0);
    process.stdout.write(`Verified read-only snapshot written to ${outputPath}: ${rowCount} rows; row contents were not printed.\n`);
    return;
  }
  throw new TypeError("Usage: snapshot.ts plan|assemble|collect --schema <source-schema.sql> --out <private-migrations/...json>; collect also requires --database and --config");
}

export async function collectRemoteSnapshot(
  schemaSql: string,
  input: Readonly<{ database: string; config: string; execute?: (sql: string) => Promise<readonly Record<string, unknown>[]> }>,
): Promise<LegacySnapshot> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.database)) throw new TypeError("D1 database identifier contains unsafe characters");
  const plan = buildSnapshotPlan(schemaSql);
  const execute = input.execute ?? ((sql: string) => executeWranglerSelect(input.database, input.config, sql));
  const countsBefore = new Map<LegacyTable, number>();
  const countsAfter = new Map<LegacyTable, number>();
  const pages = new Map<LegacyTable, Record<string, unknown>[][]>();

  for (const table of plan.tables) countsBefore.set(table.name, parseCount(await execute(table.countBeforeSql), table.name));
  for (const table of plan.tables) {
    const tablePages: Record<string, unknown>[][] = [];
    let query = table.firstPageSql;
    let observed = 0;
    while (true) {
      const page = [...await execute(query)];
      if (page.length > SNAPSHOT_PAGE_SIZE) throw new TypeError(`Remote D1 returned an oversized page for ${table.name}`);
      if (page.length === 0) break;
      tablePages.push(page);
      observed += page.length;
      if (observed > (countsBefore.get(table.name) ?? 0)) throw new TypeError(`Remote D1 ${table.name} exceeded its before count while paging`);
      if (page.length < SNAPSHOT_PAGE_SIZE) break;
      const last = page.at(-1)!;
      query = bindCursor(table.nextPageSql, table.cursorColumns.map((column) => scalarCursor(last[column], `${table.name}.${column}`)));
    }
    pages.set(table.name, tablePages);
  }
  for (const table of plan.tables) countsAfter.set(table.name, parseCount(await execute(table.countAfterSql), table.name));

  const captureTables: Record<string, unknown> = {};
  for (const table of plan.tables) captureTables[table.name] = {
    columns: table.columns,
    cursorColumns: table.cursorColumns,
    beforeCount: countsBefore.get(table.name),
    afterCount: countsAfter.get(table.name),
    pages: pages.get(table.name),
  };
  return assembleSnapshot(schemaSql, { version: 1, schemaFingerprint: SOURCE_SCHEMA_SHA256, pageSize: SNAPSHOT_PAGE_SIZE, tables: captureTables });
}

async function executeWranglerSelect(database: string, config: string, sql: string): Promise<readonly Record<string, unknown>[]> {
  if (!/^SELECT\b[\s\S]*;$/i.test(sql) || sql.slice(0, -1).includes(";")) throw new TypeError("Snapshot collector refused a non-single-SELECT query");
  const args = [WRANGLER_CLI, "d1", "execute", database, "--remote", "--json", "--config", resolve(config), "--command", sql];
  const output = await new Promise<string>((resolveOutput, rejectOutput) => {
    const child = spawn(process.execPath, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.resume();
    child.once("error", () => rejectOutput(new Error("Failed to start the read-only Wrangler D1 query")));
    child.once("close", (code) => {
      if (size > 16 * 1024 * 1024) rejectOutput(new Error("Wrangler D1 JSON response exceeded the 16MiB collector bound"));
      else if (code !== 0) rejectOutput(new Error(`Read-only Wrangler D1 query failed with exit code ${code ?? "unknown"}`));
      else resolveOutput(Buffer.concat(stdout).toString("utf8"));
    });
  });
  let parsed: unknown;
  try { parsed = JSON.parse(output); }
  catch { throw new TypeError("Wrangler D1 --json returned invalid JSON; row output was withheld"); }
  const envelope = Array.isArray(parsed) ? parsed : [parsed];
  if (envelope.length !== 1 || !isRecord(envelope[0]) || envelope[0].success !== true || !Array.isArray(envelope[0].results)) throw new TypeError("Wrangler D1 response envelope is invalid; row output was withheld");
  if (envelope[0].results.some((row) => !isRecord(row))) throw new TypeError("Wrangler D1 results contain a non-object row");
  return envelope[0].results as Record<string, unknown>[];
}

function parseCount(rows: readonly Record<string, unknown>[], table: string): number {
  if (rows.length !== 1 || !Number.isSafeInteger(rows[0]?.row_count) || Number(rows[0]!.row_count) < 0) throw new TypeError(`Remote D1 count response for ${table} is invalid`);
  return Number(rows[0]!.row_count);
}

function scalarCursor(value: unknown, label: string): string | number {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "number" && !Number.isFinite(value))) throw new TypeError(`Remote D1 cursor ${label} is not a finite string/number`);
  return value;
}

function bindCursor(template: string, values: readonly (string | number)[]): string {
  let sql = template;
  for (let index = values.length - 1; index >= 0; index -= 1) sql = sql.replaceAll(`?${index + 1}`, sqlLiteral(values[index]!));
  return sql;
}

function sqlLiteral(value: string | number): string {
  if (typeof value === "number") return String(value);
  if (value.includes("\0")) throw new TypeError("D1 cursor string contains NUL");
  return `'${value.replaceAll("'", "''")}'`;
}

function parseFlags(args: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]; const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) throw new TypeError(`Invalid CLI flag near ${flag ?? "end"}`);
    if (result.has(flag.slice(2))) throw new TypeError(`Duplicate CLI flag ${flag}`);
    result.set(flag.slice(2), value);
  }
  return result;
}

function requiredFlag(flags: Map<string, string>, name: string): string { const value = flags.get(name); if (!value) throw new TypeError(`Missing --${name}`); return value; }

function privateOutput(path: string): string {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const output = resolve(path);
  const parts = relative(root, output).split(sep);
  if (parts[0] === ".." || !parts.includes("private-migrations")) throw new TypeError("Migration outputs must stay under the repository private-migrations directory");
  return output;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function quoteIdentifier(value: string): string { if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw new TypeError(`Invalid SQL identifier ${value}`); return `"${value}"`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function sameStrings(left: readonly unknown[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function assertSameSet(left: readonly string[], right: readonly string[], label: string): void { if (left.length !== right.length || [...left].sort().some((value, index) => value !== [...right].sort()[index])) throw new TypeError(`${label} differ from confirmed schema`); }
function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void { assertSameSet(Object.keys(value), [...keys], `${label} fields`); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
