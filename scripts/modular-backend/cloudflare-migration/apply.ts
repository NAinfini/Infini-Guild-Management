import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalMigrationPayload } from "@guild/persistence-sqlite";
import { IMPORT_CHECKPOINT_TABLE, MAX_BATCH_BYTES, MAX_BATCH_STATEMENTS, MAX_STATEMENT_BYTES } from "./migration.js";

const SOURCE_DATABASES = new Set(["fanghuazhaoyun-db", "6481104b-c2f3-4387-9458-dcafd9221e7a"]);
const WRANGLER_CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../../../node_modules/wrangler/bin/wrangler.js");
const GENERATED_MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/persistence-sqlite/src/migrations/generated");

type Checkpoint = Readonly<{ batch: number; fileName: string; sha256: string; payloadSha256: string; afterStatement: string; applied: false }>;
type CheckpointDocument = Readonly<{ version: 1; phase: "phase-1" | "phase-2"; sourceDigest: string; checkpoints: readonly Checkpoint[] }>;
type BundleManifest = Readonly<{
  version: 1;
  phase: "phase-1" | "phase-2";
  sourceDigest: string;
  checkpointsSha256: string;
  inputs?: Readonly<{ r2ManifestSha256: string; reconciliationSha256: string }>;
}>;
type State = Readonly<{ version: 1; phase: "phase-1" | "phase-2"; sourceDigest: string; applied: readonly Readonly<{ batch: number; sha256: string; appliedAt: string }>[] }>;
type RemoteMarker = Readonly<{ phase: string; batch: number; sourceDigest: string; payloadSha256: string }>;
type LoadedBundle = Readonly<{ directory: string; checkpoints: CheckpointDocument; manifest: BundleManifest }>;
type R2Object = Readonly<{
  mediaId: string; variant: "full" | "view"; targetKey: string; byteSize: number;
  contentType: "image/webp" | "audio/ogg"; sha256: string; width: number | null; height: number | null;
}>;
type TargetQuery = (sql: string) => Promise<readonly Record<string, unknown>[]>;

export async function applyMigrationBatches(input: Readonly<{
  bundleDirectory: string;
  targetDatabase: string;
  targetConfig: string;
  execute?: (batchPath: string) => Promise<void>;
  readMarker?: (phase: string, batch: number) => Promise<RemoteMarker | null>;
  persistState?: (path: string, state: State) => Promise<void>;
  now?: () => string;
}>): Promise<State> {
  await assertTargetOnly(input.targetDatabase, input.targetConfig);
  const bundle = await loadBundle(input.bundleDirectory);
  const { directory, checkpoints } = bundle;

  const statePath = join(directory, "checkpoint-state.json");
  let state = await readState(statePath, checkpoints);
  const execute = input.execute ?? ((batchPath: string) => executeWranglerFile(input.targetDatabase, input.targetConfig, batchPath));
  const readMarker = input.readMarker ?? ((phase: string, batch: number) => readRemoteMarker(input.targetDatabase, input.targetConfig, phase, batch));
  const persistState = input.persistState ?? writeStateAtomic;
  const now = input.now ?? (() => new Date().toISOString());
  for (let index = 0; index < checkpoints.checkpoints.length; index += 1) {
    const checkpoint = checkpoints.checkpoints[index]!;
    let marker = await readMarker(checkpoints.phase, checkpoint.batch);
    if (state.applied[index]) {
      if (marker === null) throw new Error(`Local checkpoint ${checkpoint.batch} has no matching remote D1 marker`);
      assertRemoteMarker(marker, checkpoints, checkpoint);
      continue;
    }
    if (marker === null) {
      await execute(join(directory, checkpoint.fileName));
      marker = await readMarker(checkpoints.phase, checkpoint.batch);
      if (marker === null) throw new Error(`Remote D1 did not commit checkpoint marker for batch ${checkpoint.batch}`);
    }
    assertRemoteMarker(marker, checkpoints, checkpoint);
    state = Object.freeze({
      ...state,
      applied: Object.freeze([...state.applied, Object.freeze({ batch: checkpoint.batch, sha256: checkpoint.sha256, appliedAt: now() })]),
    });
    await persistState(statePath, state);
  }
  return state;
}

export async function finalizeMigration(input: Readonly<{
  phase1BundleDirectory: string;
  phase2BundleDirectory: string;
  reconciliationPath: string;
  targetDatabase: string;
  targetConfig: string;
  readMarker?: (phase: string, batch: number) => Promise<RemoteMarker | null>;
  queryTarget?: TargetQuery;
  checkpointTableExists?: () => Promise<boolean>;
  dropCheckpointTable?: () => Promise<void>;
}>): Promise<Readonly<{ phase1Batches: number; phase2Batches: number; finalized: true }>> {
  await assertTargetOnly(input.targetDatabase, input.targetConfig);
  const [phase1, phase2, reconciliationBytes] = await Promise.all([
    loadBundle(input.phase1BundleDirectory),
    loadBundle(input.phase2BundleDirectory),
    readFile(input.reconciliationPath),
  ]);
  if (phase1.checkpoints.phase !== "phase-1" || phase2.checkpoints.phase !== "phase-2" || !phase2.manifest.inputs) throw new TypeError("Finalize requires one immutable phase-1 bundle and one phase-2 bundle");
  if (sha256(reconciliationBytes) !== phase2.manifest.inputs.reconciliationSha256) throw new TypeError("R2 reconciliation bytes differ from the phase-2 bundle input");
  const reconciledObjects = assertSuccessfulReconciliation(
    JSON.parse(reconciliationBytes.toString("utf8")) as unknown,
    phase2.manifest.inputs.r2ManifestSha256,
  );

  const readMarker = input.readMarker ?? ((phase: string, batch: number) => readRemoteMarker(input.targetDatabase, input.targetConfig, phase, batch));
  for (const bundle of [phase1, phase2]) {
    for (const checkpoint of bundle.checkpoints.checkpoints) {
      const marker = await readMarker(bundle.checkpoints.phase, checkpoint.batch);
      if (marker === null) throw new Error(`Cannot finalize: remote D1 lacks ${bundle.checkpoints.phase} batch ${checkpoint.batch}`);
      assertRemoteMarker(marker, bundle.checkpoints, checkpoint);
    }
  }

  const queryTarget = input.queryTarget
    ?? ((sql: string) => executeWranglerSelect(input.targetDatabase, input.targetConfig, sql));
  await verifyRemoteTarget(queryTarget, phase1, phase2, reconciledObjects);

  const checkpointTableExists = input.checkpointTableExists ?? (() => remoteCheckpointTableExists(input.targetDatabase, input.targetConfig));
  if (!await checkpointTableExists()) throw new Error("Cannot finalize: remote import checkpoint table is missing");
  const dropCheckpointTable = input.dropCheckpointTable ?? (() => dropRemoteCheckpointTable(input.targetDatabase, input.targetConfig));
  await dropCheckpointTable();
  if (await checkpointTableExists()) throw new Error("Finalize failed: remote import checkpoint table still exists");
  return Object.freeze({ phase1Batches: phase1.checkpoints.checkpoints.length, phase2Batches: phase2.checkpoints.checkpoints.length, finalized: true });
}

function assertRemoteMarker(marker: RemoteMarker, checkpoints: CheckpointDocument, checkpoint: Checkpoint): void {
  if (marker.phase !== checkpoints.phase || marker.batch !== checkpoint.batch || marker.sourceDigest !== checkpoints.sourceDigest || marker.payloadSha256 !== checkpoint.payloadSha256) {
    throw new TypeError(`Remote D1 checkpoint marker ${checkpoint.batch} differs from the immutable bundle`);
  }
}

function assertSuccessfulReconciliation(input: unknown, expectedManifestSha256: string): readonly R2Object[] {
  const report = parseRecord(input, "R2 reconciliation report");
  assertExactKeys(report, ["version", "manifestSha256", "summary", "objects", "findings"], "R2 reconciliation report");
  const summary = parseRecord(report.summary, "R2 reconciliation summary");
  assertExactKeys(summary, ["expected", "verified", "findings"], "R2 reconciliation summary");
  if (report.version !== 1 || report.manifestSha256 !== expectedManifestSha256 || !Array.isArray(report.objects) || !Array.isArray(report.findings) || report.findings.length !== 0 || !Number.isSafeInteger(summary.expected) || summary.expected !== report.objects.length || summary.verified !== summary.expected || summary.findings !== 0) throw new TypeError("R2 reconciliation is not a complete successful copy for the phase-2 manifest");
  const targetKeys = new Set<string>();
  const objects = report.objects.map((raw, index) => {
    const object = parseRecord(raw, `R2 reconciliation object ${index}`);
    assertExactKeys(object, ["mediaId", "variant", "sourceKey", "targetKey", "byteSize", "contentType", "sha256", "width", "height"], `R2 reconciliation object ${index}`);
    const image = object.contentType === "image/webp";
    if (
      typeof object.mediaId !== "string"
      || (object.variant !== "full" && object.variant !== "view")
      || typeof object.targetKey !== "string"
      || !Number.isSafeInteger(object.byteSize)
      || Number(object.byteSize) < 1
      || (!image && object.contentType !== "audio/ogg")
      || typeof object.sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(object.sha256)
      || (image
        ? !Number.isSafeInteger(object.width) || Number(object.width) < 1 || !Number.isSafeInteger(object.height) || Number(object.height) < 1
        : object.width !== null || object.height !== null)
      || targetKeys.has(object.targetKey)
    ) throw new TypeError(`R2 reconciliation object ${index} is invalid`);
    targetKeys.add(object.targetKey);
    return Object.freeze({
      mediaId: object.mediaId,
      variant: object.variant,
      targetKey: object.targetKey,
      byteSize: Number(object.byteSize),
      contentType: object.contentType,
      sha256: object.sha256,
      width: image ? Number(object.width) : null,
      height: image ? Number(object.height) : null,
    } as R2Object);
  }).sort((left, right) => left.targetKey.localeCompare(right.targetKey));
  return Object.freeze(objects);
}

async function verifyRemoteTarget(
  query: TargetQuery,
  phase1: LoadedBundle,
  phase2: LoadedBundle,
  r2Objects: readonly R2Object[],
): Promise<void> {
  const expected = await loadGeneratedTargetContract();
  const [schemaRows, appRows, d1Rows, foreignKeys, invariantRows, markerRows, mediaRows] = await Promise.all([
    query("SELECT type, name, tbl_name FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 4) <> '_cf_' ORDER BY type, name;"),
    query("SELECT id, ordinal, checksum FROM app_migrations ORDER BY ordinal, id;"),
    query("SELECT name FROM d1_migrations ORDER BY id;"),
    query("PRAGMA foreign_key_check;"),
    query(`SELECT
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM users WHERE role_id = 'site_owner' AND is_active = 1 AND deleted_at IS NULL) AS active_site_owners,
      (SELECT count(*) FROM roles WHERE id IN ('site_owner','admin','moderator','member')) AS built_in_roles,
      (SELECT count(*) FROM users AS u LEFT JOIN roles AS r ON r.id = u.role_id WHERE r.id IS NULL) AS users_without_roles,
      (SELECT count(*) FROM user_credentials AS c LEFT JOIN users AS u ON u.id = c.user_id WHERE u.id IS NULL) AS orphan_credentials,
      (SELECT count(*) FROM media_variants AS v LEFT JOIN media_assets AS a ON a.id = v.media_id WHERE a.id IS NULL) AS orphan_variants,
      (SELECT count(*) FROM media_links AS l LEFT JOIN media_assets AS a ON a.id = l.media_id WHERE a.id IS NULL) AS orphan_links,
      (SELECT count(*) FROM media_assets AS a WHERE NOT EXISTS (SELECT 1 FROM media_variants AS v WHERE v.media_id = a.id)) AS assets_without_variants,
      (SELECT count(*) FROM media_assets AS a WHERE (a.media_type = 'image' AND (SELECT count(*) FROM media_variants AS v WHERE v.media_id = a.id) <> 2) OR (a.media_type = 'audio' AND (SELECT count(*) FROM media_variants AS v WHERE v.media_id = a.id) <> 1)) AS assets_bad_variant_count;`),
    query(`SELECT phase, batch, source_digest, payload_sha256 FROM "${IMPORT_CHECKPOINT_TABLE}" ORDER BY phase, batch;`),
    query("SELECT media_id, variant, object_key, content_type, byte_size, sha256, width, height FROM media_variants ORDER BY object_key, media_id, variant;"),
  ]);

  const actualSchema = schemaRows
    .map((row, index) => parseSchemaRow(row, `remote schema row ${index}`))
    .filter(({ name }) => name !== "d1_migrations" && name !== IMPORT_CHECKPOINT_TABLE);
  if (stableJson(actualSchema) !== stableJson(expected.schema)) throw new TypeError("Final target schema objects differ from generated migrations");
  if (stableJson(appRows) !== stableJson(expected.appMigrations)) throw new TypeError("Final target app_migrations ledger differs from generated migrations");
  if (stableJson(d1Rows) !== stableJson(expected.d1Migrations)) throw new TypeError("Final target d1_migrations ledger differs from generated migrations");
  if (foreignKeys.length !== 0) throw new TypeError("Final target PRAGMA foreign_key_check reported violations");
  assertCoreInvariants(invariantRows);

  const expectedMarkers = [phase1, phase2].flatMap((bundle) => bundle.checkpoints.checkpoints.map((checkpoint) => ({
    phase: bundle.checkpoints.phase,
    batch: checkpoint.batch,
    source_digest: bundle.checkpoints.sourceDigest,
    payload_sha256: checkpoint.payloadSha256,
  }))).sort((left, right) => left.phase.localeCompare(right.phase) || left.batch - right.batch);
  if (stableJson(markerRows) !== stableJson(expectedMarkers)) throw new TypeError("Final target phase markers differ from immutable bundles");

  const expectedMedia = r2Objects.map((object) => ({
    media_id: object.mediaId,
    variant: object.variant,
    object_key: object.targetKey,
    content_type: object.contentType,
    byte_size: object.byteSize,
    sha256: object.sha256,
    width: object.width,
    height: object.height,
  }));
  if (stableJson(mediaRows) !== stableJson(expectedMedia)) {
    throw new TypeError("Final target media_variants do not match the bound R2 reconciliation");
  }
}

async function loadGeneratedTargetContract(): Promise<Readonly<{
  schema: readonly Readonly<{ type: string; name: string; tbl_name: string }>[];
  appMigrations: readonly Readonly<{ id: string; ordinal: number; checksum: string }>[];
  d1Migrations: readonly Readonly<{ name: string }>[];
}>> {
  const raw = JSON.parse(await readFile(join(GENERATED_MIGRATIONS, "manifest.json"), "utf8")) as unknown;
  if (!Array.isArray(raw) || raw.length < 1) throw new TypeError("Generated migration manifest is invalid");
  const migrations = [] as { id: string; ordinal: number; file: string; checksum: string }[];
  for (let index = 0; index < raw.length; index += 1) {
    const row = parseRecord(raw[index], `generated migration ${index}`);
    assertExactKeys(row, ["id", "ordinal", "file", "checksum"], `generated migration ${index}`);
    if (
      typeof row.id !== "string"
      || row.ordinal !== index
      || typeof row.file !== "string"
      || basename(row.file) !== row.file
      || !/^\d{4}_[A-Za-z0-9_-]+\.sql$/.test(row.file)
      || typeof row.checksum !== "string"
      || !/^[0-9a-f]{64}$/.test(row.checksum)
    ) throw new TypeError(`Generated migration ${index} is invalid`);
    migrations.push({ id: row.id, ordinal: index, file: row.file, checksum: row.checksum });
  }
  const database = new DatabaseSync(":memory:");
  try {
    for (const migration of migrations) {
      const sql = await readFile(join(GENERATED_MIGRATIONS, migration.file), "utf8");
      if (sha256(Buffer.from(canonicalMigrationPayload(sql), "utf8")) !== migration.checksum) throw new TypeError(`Generated migration ${migration.file} checksum differs from manifest`);
      database.exec(sql.replaceAll("--> statement-breakpoint", ""));
    }
    const generatedLedger = database.prepare("SELECT id, ordinal, checksum FROM app_migrations ORDER BY ordinal, id").all();
    const expectedLedger = migrations.map(({ id, ordinal, checksum }) => ({ id, ordinal, checksum }));
    if (stableJson(generatedLedger) !== stableJson(expectedLedger)) throw new TypeError("Generated migration SQL ledger differs from manifest");
    const schema = (database.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as Record<string, unknown>[])
      .map((row, index) => parseSchemaRow(row, `generated schema row ${index}`));
    return Object.freeze({
      schema: Object.freeze(schema),
      appMigrations: Object.freeze(expectedLedger.map((row) => Object.freeze(row))),
      d1Migrations: Object.freeze(migrations.map(({ file }) => Object.freeze({ name: file }))),
    });
  } finally {
    database.close();
  }
}

function parseSchemaRow(row: Record<string, unknown>, label: string): Readonly<{ type: string; name: string; tbl_name: string }> {
  assertExactKeys(row, ["type", "name", "tbl_name"], label);
  if (typeof row.type !== "string" || typeof row.name !== "string" || typeof row.tbl_name !== "string") {
    throw new TypeError(`${label} is invalid`);
  }
  return Object.freeze({ type: row.type, name: row.name, tbl_name: row.tbl_name });
}

function assertCoreInvariants(rows: readonly Record<string, unknown>[]): void {
  if (rows.length !== 1) throw new TypeError("Final target core invariant query returned an invalid row count");
  const row = rows[0]!;
  const keys = [
    "users", "active_site_owners", "built_in_roles", "users_without_roles", "orphan_credentials",
    "orphan_variants", "orphan_links", "assets_without_variants", "assets_bad_variant_count",
  ];
  assertExactKeys(row, keys, "final target core invariants");
  if (
    !Number.isSafeInteger(row.users)
    || Number(row.users) < 1
    || !Number.isSafeInteger(row.active_site_owners)
    || Number(row.active_site_owners) < 1
    || row.built_in_roles !== 4
    || keys.slice(3).some((key) => row[key] !== 0)
  ) throw new TypeError("Final target core row/mapping invariants failed");
}

function stableJson(value: unknown): string { return JSON.stringify(value); }

async function assertTargetOnly(database: string, configPath: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(database)) throw new TypeError("Target D1 identifier contains unsafe characters");
  const resolvedConfig = resolve(configPath);
  const config = await readFile(resolvedConfig, "utf8");
  if (SOURCE_DATABASES.has(database) || [...SOURCE_DATABASES].some((source) => config.includes(source))) throw new TypeError("Refusing to apply migration batches to the confirmed production source D1/config");
  const configuredDatabases = new Set([...config.matchAll(/"database_(?:name|id)"\s*:\s*"([A-Za-z0-9_-]+)"/g)].map((match) => match[1]!));
  if (!configuredDatabases.has(database)) throw new TypeError("Target D1 identifier is not declared by the supplied target config");
}

async function loadBundle(bundleDirectory: string): Promise<LoadedBundle> {
  const directory = resolve(bundleDirectory);
  const checkpointsBytes = await readFile(join(directory, "checkpoints.json"));
  const checkpoints = parseCheckpoints(JSON.parse(checkpointsBytes.toString("utf8")) as unknown);
  const rawManifest = parseRecord(JSON.parse(await readFile(join(directory, "bundle-manifest.json"), "utf8")) as unknown, "bundle manifest");
  const expectedKeys = checkpoints.phase === "phase-2"
    ? ["version", "phase", "sourceDigest", "checkpointsSha256", "inputs"]
    : ["version", "phase", "sourceDigest", "checkpointsSha256"];
  assertExactKeys(rawManifest, expectedKeys, "bundle manifest");
  if (rawManifest.version !== 1 || rawManifest.phase !== checkpoints.phase || rawManifest.sourceDigest !== checkpoints.sourceDigest || rawManifest.checkpointsSha256 !== sha256(checkpointsBytes)) throw new TypeError("Bundle manifest and immutable checkpoint plan differ");
  let inputs: BundleManifest["inputs"];
  if (checkpoints.phase === "phase-2") {
    const rawInputs = parseRecord(rawManifest.inputs, "phase-2 bundle inputs");
    assertExactKeys(rawInputs, ["r2ManifestSha256", "reconciliationSha256"], "phase-2 bundle inputs");
    if (typeof rawInputs.r2ManifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(rawInputs.r2ManifestSha256) || typeof rawInputs.reconciliationSha256 !== "string" || !/^[0-9a-f]{64}$/.test(rawInputs.reconciliationSha256)) throw new TypeError("Phase-2 bundle input SHA-256 values are invalid");
    inputs = Object.freeze({ r2ManifestSha256: rawInputs.r2ManifestSha256, reconciliationSha256: rawInputs.reconciliationSha256 });
  }
  await verifyBatchFiles(directory, checkpoints.checkpoints);
  return Object.freeze({
    directory,
    checkpoints,
    manifest: Object.freeze({ version: 1, phase: checkpoints.phase, sourceDigest: checkpoints.sourceDigest, checkpointsSha256: rawManifest.checkpointsSha256 as string, ...(inputs ? { inputs } : {}) }),
  });
}

async function verifyBatchFiles(directory: string, checkpoints: readonly Checkpoint[]): Promise<void> {
  for (const checkpoint of checkpoints) {
    if (checkpoint.fileName !== `batch-${String(checkpoint.batch).padStart(4, "0")}.sql` || basename(checkpoint.fileName) !== checkpoint.fileName) throw new TypeError(`Checkpoint ${checkpoint.batch} has an unsafe batch filename`);
    const bytes = await readFile(join(directory, checkpoint.fileName));
    if (bytes.byteLength > MAX_BATCH_BYTES || sha256(bytes) !== checkpoint.sha256) throw new TypeError(`Batch ${checkpoint.batch} size/SHA-256 differs from immutable checkpoint plan`);
    const sql = bytes.toString("utf8");
    const payload = sql.split("-- migration-payload-start\n")[1]?.split("-- migration-payload-end\n")[0];
    if (payload === undefined || sha256(Buffer.from(payload)) !== checkpoint.payloadSha256) throw new TypeError(`Batch ${checkpoint.batch} payload SHA-256 differs from checkpoint plan`);
    const statements = payload.split("\n").filter((line) => line.startsWith("-- "));
    if (statements.length < 1 || statements.length + 2 > MAX_BATCH_STATEMENTS || statements.at(-1)!.slice(3) !== checkpoint.afterStatement) throw new TypeError(`Batch ${checkpoint.batch} statement checkpoint is invalid`);
    const bodies = payload.split(/^-- [^\n]+$/m).slice(1);
    if (bodies.some((body) => Buffer.byteLength(body) > MAX_STATEMENT_BYTES + 2)) throw new TypeError(`Batch ${checkpoint.batch} contains an oversized statement`);
  }
}

async function readState(path: string, checkpoints: CheckpointDocument): Promise<State> {
  let input: unknown;
  try { input = JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return Object.freeze({ version: 1, phase: checkpoints.phase, sourceDigest: checkpoints.sourceDigest, applied: Object.freeze([]) });
    throw error;
  }
  const value = parseRecord(input, "checkpoint state");
  assertExactKeys(value, ["version", "phase", "sourceDigest", "applied"], "checkpoint state");
  if (value.version !== 1 || value.phase !== checkpoints.phase || value.sourceDigest !== checkpoints.sourceDigest || !Array.isArray(value.applied)) throw new TypeError("Checkpoint state identity is invalid");
  const applied = value.applied.map((raw, index) => {
    const entry = parseRecord(raw, `checkpoint state applied ${index}`);
    assertExactKeys(entry, ["batch", "sha256", "appliedAt"], `checkpoint state applied ${index}`);
    const expected = checkpoints.checkpoints[index];
    if (!expected || entry.batch !== expected.batch || entry.sha256 !== expected.sha256 || typeof entry.appliedAt !== "string" || entry.appliedAt.length === 0) throw new TypeError("Checkpoint state is not a verified contiguous prefix");
    return Object.freeze({ batch: entry.batch as number, sha256: entry.sha256 as string, appliedAt: entry.appliedAt });
  });
  return Object.freeze({ version: 1, phase: checkpoints.phase, sourceDigest: checkpoints.sourceDigest, applied: Object.freeze(applied) });
}

function parseCheckpoints(input: unknown): CheckpointDocument {
  const value = parseRecord(input, "checkpoint plan");
  assertExactKeys(value, ["version", "phase", "sourceDigest", "checkpoints"], "checkpoint plan");
  if (value.version !== 1 || (value.phase !== "phase-1" && value.phase !== "phase-2") || typeof value.sourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(value.sourceDigest) || !Array.isArray(value.checkpoints)) throw new TypeError("Checkpoint plan header is invalid");
  const checkpoints = value.checkpoints.map((raw, index) => {
    const entry = parseRecord(raw, `checkpoint ${index}`);
    assertExactKeys(entry, ["batch", "fileName", "sha256", "payloadSha256", "afterStatement", "applied"], `checkpoint ${index}`);
    if (entry.batch !== index + 1 || typeof entry.fileName !== "string" || typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256) || typeof entry.payloadSha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.payloadSha256) || typeof entry.afterStatement !== "string" || entry.applied !== false) throw new TypeError(`Checkpoint ${index} is invalid`);
    return Object.freeze(entry as unknown as Checkpoint);
  });
  return Object.freeze({ version: 1, phase: value.phase, sourceDigest: value.sourceDigest, checkpoints: Object.freeze(checkpoints) });
}

async function executeWranglerFile(database: string, config: string, batchPath: string): Promise<void> {
  const args = [WRANGLER_CLI, "d1", "execute", database, "--remote", "--json", "--config", resolve(config), "--file", resolve(batchPath)];
  await new Promise<void>((resolveDone, rejectDone) => {
    const child = spawn(process.execPath, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", () => rejectDone(new Error("Failed to start target-only Wrangler batch apply")));
    child.once("close", (code) => code === 0 ? resolveDone() : rejectDone(new Error(`Target D1 batch apply failed with exit code ${code ?? "unknown"}; SQL/output withheld`)));
  });
}

async function readRemoteMarker(database: string, config: string, phase: string, batch: number): Promise<RemoteMarker | null> {
  if (!await remoteCheckpointTableExists(database, config)) return null;
  const rows = await executeWranglerSelect(database, config, `SELECT phase, batch, source_digest, payload_sha256 FROM "${IMPORT_CHECKPOINT_TABLE}" WHERE phase = '${phase}' AND batch = ${batch};`);
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new TypeError(`Remote D1 has duplicate checkpoint markers for ${phase} batch ${batch}`);
  const row = rows[0]!;
  assertExactKeys(row, ["phase", "batch", "source_digest", "payload_sha256"], "remote checkpoint marker");
  if (typeof row.phase !== "string" || !Number.isSafeInteger(row.batch) || typeof row.source_digest !== "string" || typeof row.payload_sha256 !== "string") throw new TypeError("Remote D1 checkpoint marker fields are invalid");
  return Object.freeze({ phase: row.phase, batch: Number(row.batch), sourceDigest: row.source_digest, payloadSha256: row.payload_sha256 });
}

async function remoteCheckpointTableExists(database: string, config: string): Promise<boolean> {
  const rows = await executeWranglerSelect(database, config, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${IMPORT_CHECKPOINT_TABLE}';`);
  if (rows.length === 0) return false;
  if (rows.length !== 1 || rows[0]?.name !== IMPORT_CHECKPOINT_TABLE) throw new TypeError("Remote D1 import checkpoint table lookup is invalid");
  return true;
}

async function dropRemoteCheckpointTable(database: string, config: string): Promise<void> {
  const args = [WRANGLER_CLI, "d1", "execute", database, "--remote", "--json", "--config", resolve(config), "--command", `DROP TABLE "${IMPORT_CHECKPOINT_TABLE}";`];
  await new Promise<void>((resolveDone, rejectDone) => {
    const child = spawn(process.execPath, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", () => rejectDone(new Error("Failed to start target-only Wrangler checkpoint finalization")));
    child.once("close", (code) => code === 0 ? resolveDone() : rejectDone(new Error(`Target D1 checkpoint finalization failed with exit code ${code ?? "unknown"}; output withheld`)));
  });
}

async function executeWranglerSelect(database: string, config: string, sql: string): Promise<readonly Record<string, unknown>[]> {
  const select = /^SELECT\b[\s\S]*;$/i.test(sql) && !sql.slice(0, -1).includes(";");
  if (!select && sql !== "PRAGMA foreign_key_check;") throw new TypeError("Remote verifier refused a non-read-only query");
  const args = [WRANGLER_CLI, "d1", "execute", database, "--remote", "--json", "--config", resolve(config), "--command", sql];
  const output = await new Promise<string>((resolveOutput, rejectOutput) => {
    const child = spawn(process.execPath, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.resume();
    child.once("error", () => rejectOutput(new Error("Failed to start target-only Wrangler checkpoint query")));
    child.once("close", (code) => {
      if (size > 1024 * 1024) rejectOutput(new Error("Wrangler checkpoint JSON response exceeded 1MiB"));
      else if (code !== 0) rejectOutput(new Error(`Target D1 checkpoint query failed with exit code ${code ?? "unknown"}; output withheld`));
      else resolveOutput(Buffer.concat(stdout).toString("utf8"));
    });
  });
  let parsed: unknown;
  try { parsed = JSON.parse(output); }
  catch { throw new TypeError("Wrangler checkpoint query returned invalid JSON; output withheld"); }
  const envelope = Array.isArray(parsed) ? parsed : [parsed];
  if (envelope.length !== 1 || !isRecord(envelope[0]) || envelope[0].success !== true || !Array.isArray(envelope[0].results) || envelope[0].results.some((row) => !isRecord(row))) throw new TypeError("Wrangler checkpoint query response is invalid; output withheld");
  return envelope[0].results as Record<string, unknown>[];
}

async function writeStateAtomic(path: string, state: State): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const flags = parseFlags(args);
  const targetDatabase = requiredFlag(flags, "target-database");
  const targetConfig = requiredFlag(flags, "target-config");
  if (command === "apply") {
    const state = await applyMigrationBatches({ bundleDirectory: requiredFlag(flags, "bundle"), targetDatabase, targetConfig });
    process.stdout.write(`Applied/verified ${state.applied.length} ${state.phase} batch checkpoint(s); SQL and remote output were not printed.\n`);
    return;
  }
  if (command === "finalize") {
    const result = await finalizeMigration({
      phase1BundleDirectory: requiredFlag(flags, "phase-1-bundle"),
      phase2BundleDirectory: requiredFlag(flags, "phase-2-bundle"),
      reconciliationPath: requiredFlag(flags, "reconciliation"),
      targetDatabase,
      targetConfig,
    });
    process.stdout.write(`Finalized ${result.phase1Batches + result.phase2Batches} verified remote batch checkpoint(s); the temporary import marker table was removed.\n`);
    return;
  }
  throw new TypeError("Usage: apply.ts apply|finalize with explicit target/bundle/evidence flags");
}

function parseFlags(args: readonly string[]): Map<string, string> { const result = new Map<string, string>(); for (let index = 0; index < args.length; index += 2) { const flag = args[index]; const value = args[index + 1]; if (!flag?.startsWith("--") || value === undefined || value.startsWith("--") || result.has(flag.slice(2))) throw new TypeError(`Invalid CLI flag near ${flag ?? "end"}`); result.set(flag.slice(2), value); } return result; }
function requiredFlag(flags: Map<string, string>, name: string): string { const value = flags.get(name); if (!value) throw new TypeError(`Missing --${name}`); return value; }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function parseRecord(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} fields differ from contract`); }
function isNodeError(value: unknown): value is NodeJS.ErrnoException { return value instanceof Error && "code" in value; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
