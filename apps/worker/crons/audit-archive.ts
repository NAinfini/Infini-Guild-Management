import type { Bindings } from "../index";

const ARCHIVE_PREFIX = "audit-archive";
const RETENTION_MONTHS = 3;
const ARCHIVE_PART_ROWS = 1000;
const D1_DELETE_IDS = 50;

type AuditArchiveDbRow = {
  id: string;
  entity_type: string;
  action: string;
  actor_id: string;
  entity_id: string;
  diff_title: string | null;
  detail_text: string | null;
  created_at: string;
};

type AuditArchiveManifestFile = {
  key: string;
  etag: string;
  row_count: number;
  size_bytes: number;
  content_encoding: "gzip";
  content_type: "application/x-ndjson";
};

type AuditArchiveManifest = {
  version: 1;
  month: string;
  generated_at: string;
  total_rows: number;
  entities: Record<string, number>;
  files: AuditArchiveManifestFile[];
};

function lastFullyExpiredMonth(): string | null {
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RETENTION_MONTHS, 0));
  if (cutoff.getTime() <= 0) return null;
  return `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}`;
}

function archivePaths(month: string, part: number): { dataKey: string; manifestKey: string } {
  const [year, monthNumber] = month.split("-");
  const root = `${ARCHIVE_PREFIX}/${year}/${monthNumber}`;
  return {
    dataKey: `${root}/audit-${month}-part-${String(part).padStart(4, "0")}.ndjson.gz`,
    manifestKey: `${root}/manifest.json`,
  };
}

function toNdjson(rows: AuditArchiveDbRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

async function gzipText(text: string): Promise<ArrayBuffer> {
  const compressed = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(compressed).arrayBuffer();
}

async function gunzipText(buffer: ArrayBuffer): Promise<string> {
  const decompressed = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(decompressed).text();
}

function normalizedEtag(etag: string | undefined): string | null {
  return etag ? etag.replace(/^W\//, "").replace(/^"|"$/g, "") : null;
}

function objectEtag(object: { etag?: string; httpEtag?: string } | null | undefined): string | null {
  return normalizedEtag(object?.etag ?? object?.httpEtag);
}

async function loadMonthRows(db: D1Database, month: string): Promise<AuditArchiveDbRow[]> {
  const rows: AuditArchiveDbRow[] = [];
  let createdAtCursor = "";
  let idCursor = "";
  while (true) {
    const page = await db.prepare(
      `SELECT id, entity_type, action, actor_id, entity_id, diff_title, detail_text, created_at
       FROM audit_log
       WHERE created_at LIKE ?1
         AND (created_at > ?2 OR (created_at = ?2 AND id > ?3))
       ORDER BY created_at ASC, id ASC
       LIMIT ?4`,
    ).bind(`${month}-%`, createdAtCursor, idCursor, ARCHIVE_PART_ROWS).all<AuditArchiveDbRow>();
    const pageRows = page.results ?? [];
    rows.push(...pageRows);
    if (pageRows.length < ARCHIVE_PART_ROWS) return rows;
    const tail = pageRows.at(-1);
    if (!tail || tail.created_at < createdAtCursor || (tail.created_at === createdAtCursor && tail.id <= idCursor)) {
      throw new Error(`Audit archive cursor did not advance for ${month}`);
    }
    createdAtCursor = tail.created_at;
    idCursor = tail.id;
  }
}

function parseManifest(value: unknown, month: string): AuditArchiveManifest {
  if (!value || typeof value !== "object") throw new Error(`Invalid audit archive manifest for ${month}`);
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.month !== month || typeof record.generated_at !== "string") {
    throw new Error(`Invalid audit archive manifest for ${month}`);
  }
  if (!Number.isSafeInteger(record.total_rows) || (record.total_rows as number) < 1 || !Array.isArray(record.files)) {
    throw new Error(`Invalid audit archive manifest for ${month}`);
  }
  const files: AuditArchiveManifestFile[] = record.files.map((value) => {
    if (!value || typeof value !== "object") throw new Error(`Invalid audit archive manifest file for ${month}`);
    const file = value as Record<string, unknown>;
    if (
      typeof file.key !== "string"
      || !file.key.startsWith(`${ARCHIVE_PREFIX}/`)
      || typeof file.etag !== "string"
      || !Number.isSafeInteger(file.row_count)
      || (file.row_count as number) < 1
      || !Number.isSafeInteger(file.size_bytes)
      || (file.size_bytes as number) < 1
      || file.content_encoding !== "gzip"
      || file.content_type !== "application/x-ndjson"
    ) {
      throw new Error(`Invalid audit archive manifest file for ${month}`);
    }
    return file as unknown as AuditArchiveManifestFile;
  });
  if (files.length === 0 || files.reduce((total, file) => total + file.row_count, 0) !== record.total_rows) {
    throw new Error(`Audit archive manifest row count mismatch for ${month}`);
  }
  const entities = record.entities;
  if (!entities || typeof entities !== "object" || Array.isArray(entities)) {
    throw new Error(`Invalid audit archive entity counts for ${month}`);
  }
  return { ...record, files, entities } as AuditArchiveManifest;
}

async function readAndVerifyDataFile(
  bucket: R2Bucket,
  file: AuditArchiveManifestFile,
): Promise<AuditArchiveDbRow[]> {
  const [head, object] = await Promise.all([bucket.head(file.key), bucket.get(file.key)]);
  if (!head || !object) throw new Error(`Missing audit archive data object: ${file.key}`);
  if (head.size !== file.size_bytes || object.size !== file.size_bytes) {
    throw new Error(`Audit archive size verification failed: ${file.key}`);
  }
  if (objectEtag(head) !== normalizedEtag(file.etag) || objectEtag(object) !== normalizedEtag(file.etag)) {
    throw new Error(`Audit archive ETag verification failed: ${file.key}`);
  }
  if (head.customMetadata?.rowCount !== String(file.row_count)) {
    throw new Error(`Audit archive row-count metadata verification failed: ${file.key}`);
  }
  const text = await gunzipText(await object.arrayBuffer());
  const lines = text ? text.split("\n") : [];
  if (lines.length !== file.row_count) throw new Error(`Audit archive row-count verification failed: ${file.key}`);
  return lines.map((line) => JSON.parse(line) as AuditArchiveDbRow);
}

async function readAndVerifyManifest(bucket: R2Bucket, month: string): Promise<{ manifest: AuditArchiveManifest; rows: AuditArchiveDbRow[] } | null> {
  const { manifestKey } = archivePaths(month, 1);
  const object = await bucket.get(manifestKey);
  if (!object) return null;
  const head = await bucket.head(manifestKey);
  if (!head || head.size !== object.size || objectEtag(head) !== objectEtag(object)) {
    throw new Error(`Audit archive manifest verification failed: ${manifestKey}`);
  }
  const manifest = parseManifest(JSON.parse(await object.text()) as unknown, month);
  const rows: AuditArchiveDbRow[] = [];
  for (const file of manifest.files) rows.push(...await readAndVerifyDataFile(bucket, file));
  if (rows.length !== manifest.total_rows) throw new Error(`Audit archive total row verification failed for ${month}`);
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error(`Duplicate audit row ids in archive ${month}`);
  return { manifest, rows };
}

async function writeDataPart(
  bucket: R2Bucket,
  month: string,
  part: number,
  rows: AuditArchiveDbRow[],
): Promise<AuditArchiveManifestFile> {
  const { dataKey } = archivePaths(month, part);
  const compressed = await gzipText(toNdjson(rows));
  const written = await bucket.put(dataKey, compressed, {
    httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" },
    customMetadata: { rowCount: String(rows.length) },
  });
  const etag = objectEtag(written);
  if (!etag) throw new Error(`Audit archive write did not return an ETag: ${dataKey}`);
  const file: AuditArchiveManifestFile = {
    key: dataKey,
    etag,
    row_count: rows.length,
    size_bytes: compressed.byteLength,
    content_encoding: "gzip",
    content_type: "application/x-ndjson",
  };
  await readAndVerifyDataFile(bucket, file);
  return file;
}

function buildManifest(month: string, files: AuditArchiveManifestFile[], rows: AuditArchiveDbRow[]): AuditArchiveManifest {
  const entities: Record<string, number> = {};
  for (const row of rows) entities[row.entity_type] = (entities[row.entity_type] ?? 0) + 1;
  return {
    version: 1,
    month,
    generated_at: new Date().toISOString(),
    total_rows: rows.length,
    entities,
    files,
  };
}

async function writeManifest(bucket: R2Bucket, manifest: AuditArchiveManifest): Promise<void> {
  const { manifestKey } = archivePaths(manifest.month, 1);
  const body = JSON.stringify(manifest, null, 2);
  const written = await bucket.put(manifestKey, body, { httpMetadata: { contentType: "application/json" } });
  const head = await bucket.head(manifestKey);
  const object = await bucket.get(manifestKey);
  if (
    !head
    || !object
    || head.size !== new TextEncoder().encode(body).byteLength
    || object.size !== head.size
    || objectEtag(written) !== objectEtag(head)
    || objectEtag(head) !== objectEtag(object)
  ) {
    throw new Error(`Audit archive manifest verification failed: ${manifestKey}`);
  }
  parseManifest(JSON.parse(await object.text()) as unknown, manifest.month);
}

async function deleteArchivedRows(db: D1Database, ids: readonly string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < uniqueIds.length; index += D1_DELETE_IDS) {
    const chunk = uniqueIds.slice(index, index + D1_DELETE_IDS);
    const placeholders = chunk.map(() => "?").join(", ");
    statements.push(db.prepare(`DELETE FROM audit_log WHERE id IN (${placeholders})`).bind(...chunk));
  }
  if (statements.length > 0) await db.batch(statements);
}

export async function runAuditArchiveCron(env: Bindings): Promise<void> {
  const maxMonth = lastFullyExpiredMonth();
  if (!maxMonth) return;

  const monthRows = await env.DB.prepare(
    "SELECT DISTINCT substr(created_at, 1, 7) AS month FROM audit_log WHERE substr(created_at, 1, 7) <= ?1 ORDER BY month ASC",
  ).bind(maxMonth).all<{ month: string }>();
  const months = (monthRows.results ?? [])
    .map((row) => row.month)
    .filter((month): month is string => typeof month === "string" && /^\d{4}-\d{2}$/.test(month));

  for (const month of months) {
    const databaseRows = await loadMonthRows(env.DB, month);
    if (databaseRows.length === 0) continue;

    let committed = await readAndVerifyManifest(env.MEDIA, month);
    if (!committed) {
      const files: AuditArchiveManifestFile[] = [];
      for (let index = 0; index < databaseRows.length; index += ARCHIVE_PART_ROWS) {
        files.push(await writeDataPart(env.MEDIA, month, files.length + 1, databaseRows.slice(index, index + ARCHIVE_PART_ROWS)));
      }
      // Manifest 是归档提交标记；只有读回验证且覆盖全部 D1 行 ID 后，才能删除源行。
      await writeManifest(env.MEDIA, buildManifest(month, files, databaseRows));
      committed = await readAndVerifyManifest(env.MEDIA, month);
      if (!committed) throw new Error(`Audit archive manifest was not committed for ${month}`);
    }

    const archivedIds = new Set(committed.rows.map((row) => row.id));
    const uncommittedRow = databaseRows.find((row) => !archivedIds.has(row.id));
    if (uncommittedRow) {
      throw new Error(`Audit row ${uncommittedRow.id} is not present in committed archive ${month}`);
    }
    await deleteArchivedRows(env.DB, databaseRows.map((row) => row.id));
  }
}
