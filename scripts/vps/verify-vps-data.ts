import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { FilesystemBlobStore, NodeSqlExecutor } from "@guild/vps/adapters";
import { SqliteBlobManifestStore } from "@guild/persistence-sqlite";
import {
  BlobReconciliationService,
  type BlobReconciliationCheckpoint,
  type BlobReconciliationFinding,
} from "@guild/server/modules/blob-reconciliation";
import { DEFAULT_VPS_MIGRATIONS, readMigrationDirectory } from "./migrate-vps.js";
import { assertCurrentVpsDatabase } from "./vps-migration.js";

export type VpsDataVerificationResult = Readonly<{
  databasePath: string;
  blobPath: string;
  scanned: number;
  findings: number;
  byKind: Readonly<{
    missing_blob: number;
    metadata_mismatch: number;
    orphan_candidate: number;
  }>;
}>;

export async function runVpsDataVerification(
  argumentsList: readonly string[],
  options: Readonly<{
    now?: string;
    report?: (finding: BlobReconciliationFinding) => void;
  }> = {},
): Promise<VpsDataVerificationResult> {
  const databasePath = path.resolve(option(argumentsList, "--database"));
  const blobPath = path.resolve(option(argumentsList, "--blobs"));
  const migrationsPath = path.resolve(optionalOption(argumentsList, "--migrations") ?? DEFAULT_VPS_MIGRATIONS);
  const pageSize = integerOption(argumentsList, "--page-size", 50, 1, 50);
  await Promise.all([
    access(databasePath, constants.R_OK),
    access(blobPath, constants.R_OK),
  ]);

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assertCurrentVpsDatabase(database, await readMigrationDirectory(migrationsPath));
  } finally {
    database.close();
  }

  /* 只读打开：校验工具绝不向被检查的库写入，也不改它的日志模式。 */
  const sql = new NodeSqlExecutor(databasePath, { readOnly: true });
  try {
    const blobs = new FilesystemBlobStore(blobPath, { createRoot: false });
    const verifier = new BlobReconciliationService(
      new SqliteBlobManifestStore(sql),
      blobs,
      blobs,
    );
    const now = options.now ?? new Date().toISOString();
    const byKind = { missing_blob: 0, metadata_mismatch: 0, orphan_candidate: 0 };
    let checkpoint: BlobReconciliationCheckpoint | undefined;
    let scanned = 0;
    do {
      const page = await verifier.scanPage({ now, limit: pageSize, checkpoint });
      scanned += page.scanned;
      for (const finding of page.findings) {
        byKind[finding.kind] += 1;
        options.report?.(finding);
      }
      checkpoint = page.nextCheckpoint ?? undefined;
    } while (checkpoint);
    return Object.freeze({
      databasePath,
      blobPath,
      scanned,
      findings: byKind.missing_blob + byKind.metadata_mismatch + byKind.orphan_candidate,
      byKind: Object.freeze(byKind),
    });
  } finally {
    await sql.close();
  }
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

function integerOption(
  argumentsList: readonly string[],
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = optionalOption(argumentsList, name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

if (import.meta.main) {
  runVpsDataVerification(process.argv.slice(2), {
    report: (finding) => console.error(JSON.stringify(finding)),
  }).then((result) => {
    console.info(JSON.stringify(result));
    if (result.findings > 0) process.exitCode = 1;
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "VPS data verification failed");
    process.exitCode = 1;
  });
}
