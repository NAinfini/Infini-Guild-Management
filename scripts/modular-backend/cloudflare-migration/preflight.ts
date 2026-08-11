import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalMigrationPayload } from "@guild/persistence-sqlite";

export type TargetMigrationSource = Readonly<{
  id: string;
  ordinal: number;
  file: string;
  checksum: string;
  sql: string;
}>;

type TargetMigration = Omit<TargetMigrationSource, "sql">;

export type TargetInitPlan = Readonly<{
  initializationMethod: "d1-migrations-apply";
  migrations: readonly TargetMigration[];
  verificationSql: readonly string[];
}>;

export function buildTargetInitPlan(sources: readonly TargetMigrationSource[]): TargetInitPlan {
  const migrations = validateSources(sources);
  return Object.freeze({
    initializationMethod: "d1-migrations-apply",
    migrations,
    verificationSql: Object.freeze([
      "SELECT id, ordinal, checksum FROM app_migrations ORDER BY ordinal, id;",
      "SELECT name FROM d1_migrations ORDER BY id;",
      "PRAGMA foreign_key_check;",
    ]),
  });
}

export type TargetInspection = Readonly<{
  version: 1;
  userTables: readonly string[];
  appMigrations: readonly Readonly<{ id: string; ordinal: number; checksum: string }>[];
  d1Migrations: readonly Readonly<{ name: string }>[];
  foreignKeyViolations: readonly unknown[];
}>;

export type TargetPreflight = Readonly<{
  ready: boolean;
  state: "empty" | "initialized" | "rejected";
  reasons: readonly string[];
  initPlan: TargetInitPlan;
}>;

export function assessTargetPreflight(
  sources: readonly TargetMigrationSource[],
  input: unknown,
): TargetPreflight {
  const plan = buildTargetInitPlan(sources);
  const expectedTables = migrationTableNames(sources);
  if (!isRecord(input)) throw new TypeError("Target inspection must be an object");
  assertExactKeys(input, ["version", "userTables", "appMigrations", "d1Migrations", "foreignKeyViolations"], "target inspection");
  if (input.version !== 1 || !Array.isArray(input.userTables) || input.userTables.some((name) => typeof name !== "string") || !Array.isArray(input.appMigrations) || !Array.isArray(input.d1Migrations) || !Array.isArray(input.foreignKeyViolations)) throw new TypeError("Target inspection fields are invalid");
  const tables = [...input.userTables as string[]].sort();
  const nonLedgerTables = tables.filter((name) => name !== "d1_migrations");
  if (nonLedgerTables.length === 0) {
    const reasons = input.appMigrations.length === 0 && input.d1Migrations.length === 0 && input.foreignKeyViolations.length === 0
      ? []
      : ["Empty target has unexpected migration rows or foreign-key findings"];
    return Object.freeze({ ready: reasons.length === 0, state: reasons.length === 0 ? "empty" : "rejected", reasons: Object.freeze(reasons), initPlan: plan });
  }
  const reasons: string[] = [];
  const unknown = tables.filter((name) => name !== "d1_migrations" && !expectedTables.has(name));
  const missing = [...expectedTables].filter((name) => !tables.includes(name));
  if (unknown.length > 0) reasons.push(`Unknown target tables: ${unknown.join(", ")}`);
  if (missing.length > 0) reasons.push(`Missing target tables: ${missing.join(", ")}`);
  if (!matchesAppLedger(input.appMigrations, plan.migrations)) {
    reasons.push("app_migrations does not exactly match the generated migration manifest");
  }
  if (!matchesD1Ledger(input.d1Migrations, plan.migrations)) {
    reasons.push("d1_migrations does not exactly match the generated migration manifest");
  }
  if (input.foreignKeyViolations.length > 0) reasons.push("PRAGMA foreign_key_check reported violations");
  return Object.freeze({ ready: reasons.length === 0, state: reasons.length === 0 ? "initialized" : "rejected", reasons: Object.freeze(reasons), initPlan: plan });
}

function validateSources(sources: readonly TargetMigrationSource[]): readonly TargetMigration[] {
  if (sources.length === 0) throw new TypeError("Target migration set must not be empty");
  return Object.freeze(sources.map((source, ordinal) => {
    if (source.ordinal !== ordinal || source.file !== `${source.id}.sql` || !/^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(source.id) || !/^[0-9a-f]{64}$/.test(source.checksum)) {
      throw new TypeError(`Target migration ${ordinal} differs from the generated manifest`);
    }
    const checksum = createHash("sha256").update(canonicalMigrationPayload(source.sql)).digest("hex");
    const ledger = source.sql.match(/INSERT INTO app_migrations \(id, ordinal, checksum\) VALUES \('([^']+)', (\d+), '([0-9a-f]{64})'\);\s*$/);
    if (checksum !== source.checksum || ledger?.[1] !== source.id || Number(ledger?.[2]) !== ordinal || ledger?.[3] !== source.checksum) {
      throw new TypeError(`Target migration ${source.file} checksum or ledger differs from the generated manifest`);
    }
    return Object.freeze({ id: source.id, ordinal, file: source.file, checksum: source.checksum });
  }));
}

function migrationTableNames(sources: readonly TargetMigrationSource[]): Set<string> {
  validateSources(sources);
  const database = new DatabaseSync(":memory:");
  try {
    for (const source of sources) database.exec(source.sql.replaceAll("--> statement-breakpoint", ""));
    return new Set((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((row) => row.name));
  } finally {
    database.close();
  }
}

function matchesAppLedger(input: unknown[], migrations: readonly TargetMigration[]): boolean {
  return input.length === migrations.length && migrations.every((migration, index) => {
    const row = input[index];
    return isRecord(row)
      && row.id === migration.id
      && row.ordinal === migration.ordinal
      && row.checksum === migration.checksum;
  });
}

function matchesD1Ledger(input: unknown[], migrations: readonly TargetMigration[]): boolean {
  return input.length === migrations.length && migrations.every((migration, index) => {
    const row = input[index];
    return isRecord(row) && row.name === migration.file;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} fields differ from contract`); }
