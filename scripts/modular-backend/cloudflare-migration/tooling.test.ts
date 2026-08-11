import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrationBatches, finalizeMigration } from "./apply.js";
import { SOURCE_SCHEMA_SHA256 } from "./migration.js";
import { assessTargetPreflight, type TargetMigrationSource } from "./preflight.js";
import { SNAPSHOT_PAGE_SIZE, assembleSnapshot, buildSnapshotPlan, collectRemoteSnapshot } from "./snapshot.js";

const SOURCE_SCHEMA = await readFile(resolve("private-migrations/cloudflare-bluegreen/source-schema.sql"), "utf8");
const MIGRATION_MANIFEST = JSON.parse(await readFile(resolve("packages/persistence-sqlite/src/migrations/generated/manifest.json"), "utf8")) as Array<Omit<TargetMigrationSource, "sql">>;
const TARGET_MIGRATIONS = await Promise.all(MIGRATION_MANIFEST.map(async (entry) => Object.freeze({
  ...entry,
  sql: await readFile(resolve("packages/persistence-sqlite/src/migrations/generated", entry.file), "utf8"),
})));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("D1 snapshot, preflight, and bounded apply tooling", () => {
  it("derives exact <=100-row keyset plans from the confirmed schema and assembles only stable captures", () => {
    const plan = buildSnapshotPlan(SOURCE_SCHEMA);
    expect(plan.schemaFingerprint).toBe(SOURCE_SCHEMA_SHA256);
    expect(plan.pageSize).toBe(SNAPSHOT_PAGE_SIZE);
    expect(plan.tables).toHaveLength(52);
    expect(plan.tables.find((table) => table.name === "member_badge_assignments")?.cursorColumns).toEqual(["badge_id", "user_id"]);
    const tables = Object.fromEntries(plan.tables.map((table) => [table.name, {
      columns: table.columns,
      cursorColumns: table.cursorColumns,
      beforeCount: 0,
      afterCount: 0,
      pages: [],
    }]));
    const snapshot = assembleSnapshot(SOURCE_SCHEMA, { version: 1, schemaFingerprint: SOURCE_SCHEMA_SHA256, pageSize: 100, tables });
    expect(Object.keys(snapshot.tables)).toHaveLength(52);
    expect(() => assembleSnapshot(SOURCE_SCHEMA, {
      version: 1, schemaFingerprint: SOURCE_SCHEMA_SHA256, pageSize: 100,
      tables: { ...tables, users: { ...(tables as any).users, beforeCount: 1 } },
    })).toThrow(/changed between before\/after counts/);
  });

  it("runs a read-only global before/page/after collection without exposing row output", async () => {
    const queries: string[] = [];
    const snapshot = await collectRemoteSnapshot(SOURCE_SCHEMA, {
      database: "source-readonly-id",
      config: "unused.jsonc",
      execute: async (sql) => {
        queries.push(sql);
        return sql.includes("COUNT(*)") ? [{ row_count: 0 }] : [];
      },
    });
    expect(Object.values(snapshot.tables).every((table) => table.rows.length === 0)).toBe(true);
    expect(queries).toHaveLength(52 * 3);
    expect(queries.every((sql) => /^SELECT\b/.test(sql))).toBe(true);
  });

  it("accepts only empty or checksum-matched target databases", () => {
    expect(assessTargetPreflight(TARGET_MIGRATIONS, { version: 1, userTables: [], appMigrations: [], d1Migrations: [], foreignKeyViolations: [] })).toMatchObject({ ready: true, state: "empty" });
    const database = new DatabaseSync(":memory:");
    for (const migration of TARGET_MIGRATIONS) database.exec(migration.sql.replaceAll("--> statement-breakpoint", ""));
    const userTables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    const appMigrations = database.prepare("SELECT id, ordinal, checksum FROM app_migrations").all();
    database.close();
    const d1Migrations = TARGET_MIGRATIONS.map(({ file }) => ({ name: file }));
    expect(assessTargetPreflight(TARGET_MIGRATIONS, { version: 1, userTables: [...userTables, "d1_migrations"], appMigrations, d1Migrations, foreignKeyViolations: [] })).toMatchObject({ ready: true, state: "initialized" });
    expect(assessTargetPreflight(TARGET_MIGRATIONS, { version: 1, userTables: [...userTables, "d1_migrations"], appMigrations: [{ id: "0000_core", ordinal: 0, checksum: "0".repeat(64) }, appMigrations[1]], d1Migrations, foreignKeyViolations: [] })).toMatchObject({ ready: false, state: "rejected" });
  });

  it("verifies immutable bundle SHA and resumes target-only apply after durable checkpoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "infini-d1-apply-"));
    temporaryDirectories.push(root);
    const sourceDigest = "a".repeat(64);
    const { payloadSha256, batchSha } = await writeBundleFixture(root, "phase-1", sourceDigest);
    const config = join(root, "target.jsonc");
    await writeFile(config, "{\"d1_databases\":[{\"database_id\":\"target-db\"}]}");
    const applied: string[] = [];
    let remoteMarker: { phase: string; batch: number; sourceDigest: string; payloadSha256: string } | null = null;
    const input = {
      bundleDirectory: root,
      targetDatabase: "target-db",
      targetConfig: config,
      execute: async (path: string) => {
        applied.push(path);
        remoteMarker = { phase: "phase-1", batch: 1, sourceDigest, payloadSha256 };
      },
      readMarker: async () => remoteMarker,
      now: () => "2026-08-10T00:00:00.000Z",
    };
    await expect(applyMigrationBatches({ ...input, persistState: async () => { throw new Error("simulated crash after remote commit"); } })).rejects.toThrow(/simulated crash/);
    await applyMigrationBatches(input);
    expect(applied).toHaveLength(1);
    expect(JSON.parse(await readFile(join(root, "checkpoint-state.json"), "utf8"))).toMatchObject({ applied: [{ batch: 1, sha256: batchSha }] });

    const phase2Root = await mkdtemp(join(tmpdir(), "infini-d1-finalize-"));
    temporaryDirectories.push(phase2Root);
    const phase2Digest = "b".repeat(64);
    const reconciliation = `${JSON.stringify({ version: 1, manifestSha256: "c".repeat(64), summary: { expected: 0, verified: 0, findings: 0 }, objects: [], findings: [] }, null, 2)}\n`;
    const phase2 = await writeBundleFixture(phase2Root, "phase-2", phase2Digest, { r2ManifestSha256: "c".repeat(64), reconciliationSha256: hash(reconciliation) });
    const reconciliationPath = join(phase2Root, "reconciliation.json");
    await writeFile(reconciliationPath, reconciliation);
    const markers = new Map([
      ["phase-1:1", remoteMarker!],
      ["phase-2:1", { phase: "phase-2", batch: 1, sourceDigest: phase2Digest, payloadSha256: phase2.payloadSha256 }],
    ]);
    const target = await verifiedTargetDatabase([...markers.values()]);
    const queryTarget = async (sql: string) => target.prepare(sql).all() as Record<string, unknown>[];
    let markerTableExists = true;
    let dropped = false;
    await expect(finalizeMigration({
      phase1BundleDirectory: root,
      phase2BundleDirectory: phase2Root,
      reconciliationPath,
      targetDatabase: "target-db",
      targetConfig: config,
      readMarker: async (phase, batch) => markers.get(`${phase}:${batch}`) ?? null,
      queryTarget: async (sql) => sql.includes("AS active_site_owners")
        ? [{ users: 1, active_site_owners: 0, built_in_roles: 4, users_without_roles: 0, orphan_credentials: 0, orphan_variants: 0, orphan_links: 0, assets_without_variants: 0, assets_bad_variant_count: 0 }]
        : queryTarget(sql),
      checkpointTableExists: async () => markerTableExists,
      dropCheckpointTable: async () => { dropped = true; },
    })).rejects.toThrow(/core row\/mapping invariants failed/);
    expect(dropped).toBe(false);

    await expect(finalizeMigration({
      phase1BundleDirectory: root,
      phase2BundleDirectory: phase2Root,
      reconciliationPath,
      targetDatabase: "target-db",
      targetConfig: config,
      readMarker: async (phase, batch) => markers.get(`${phase}:${batch}`) ?? null,
      queryTarget,
      checkpointTableExists: async () => markerTableExists,
      dropCheckpointTable: async () => { markerTableExists = false; },
    })).resolves.toMatchObject({ phase1Batches: 1, phase2Batches: 1, finalized: true });
    target.close();
  });
});

function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

async function verifiedTargetDatabase(markers: readonly Readonly<{
  phase: string; batch: number; sourceDigest: string; payloadSha256: string;
}>[]): Promise<DatabaseSync> {
  const database = new DatabaseSync(":memory:");
  const manifest = JSON.parse(await readFile(resolve("packages/persistence-sqlite/src/migrations/generated/manifest.json"), "utf8")) as Array<{ file: string }>;
  for (const migration of manifest) {
    database.exec((await readFile(resolve("packages/persistence-sqlite/src/migrations/generated", migration.file), "utf8")).replaceAll("--> statement-breakpoint", ""));
  }
  database.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const insertD1 = database.prepare("INSERT INTO d1_migrations (name) VALUES (?)");
  manifest.forEach(({ file }) => insertD1.run(file));
  database.prepare("INSERT INTO users (id, username, role_id, revision_token) VALUES (?, ?, 'site_owner', ?)")
    .run("verified-owner", "Verified Owner", "123e4567-e89b-42d3-a456-426614174000");
  database.exec("CREATE TABLE bluegreen_import_checkpoints (phase TEXT NOT NULL, batch INTEGER NOT NULL, source_digest TEXT NOT NULL, payload_sha256 TEXT NOT NULL, PRIMARY KEY (phase, batch))");
  const insertMarker = database.prepare("INSERT INTO bluegreen_import_checkpoints (phase, batch, source_digest, payload_sha256) VALUES (?, ?, ?, ?)");
  markers.forEach((marker) => insertMarker.run(marker.phase, marker.batch, marker.sourceDigest, marker.payloadSha256));
  return database;
}

async function writeBundleFixture(
  root: string,
  phase: "phase-1" | "phase-2",
  sourceDigest: string,
  inputs?: Readonly<{ r2ManifestSha256: string; reconciliationSha256: string }>,
): Promise<Readonly<{ payloadSha256: string; batchSha: string }>> {
  const payload = "-- test:row:insert\nSELECT 1;\n";
  const payloadSha256 = hash(payload);
  const sql = `-- infini-guild ${phase} 0001\nCREATE TABLE IF NOT EXISTS "bluegreen_import_checkpoints" (phase TEXT NOT NULL, batch INTEGER NOT NULL, source_digest TEXT NOT NULL, payload_sha256 TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), PRIMARY KEY (phase, batch));\n-- migration-payload-start\n${payload}-- migration-payload-end\nINSERT INTO "bluegreen_import_checkpoints" ("phase", "batch", "source_digest", "payload_sha256") VALUES ('${phase}', 1, '${sourceDigest}', '${payloadSha256}');\n`;
  const batchSha = hash(sql);
  const checkpoints = `${JSON.stringify({ version: 1, phase, sourceDigest, checkpoints: [{ batch: 1, fileName: "batch-0001.sql", sha256: batchSha, payloadSha256, afterStatement: "test:row:insert", applied: false }] }, null, 2)}\n`;
  await writeFile(join(root, "batch-0001.sql"), sql);
  await writeFile(join(root, "checkpoints.json"), checkpoints);
  await writeFile(join(root, "bundle-manifest.json"), `${JSON.stringify({ version: 1, phase, sourceDigest, checkpointsSha256: hash(checkpoints), ...(inputs ? { inputs } : {}) }, null, 2)}\n`);
  return { payloadSha256, batchSha };
}
