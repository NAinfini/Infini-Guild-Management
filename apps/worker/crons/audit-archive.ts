import type { Bindings } from "../index";

const ARCHIVE_PREFIX = "audit-archive";
const RETENTION_MONTHS = 3;

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
  row_count: number;
  size_bytes: number;
  content_encoding: "gzip";
  content_type: "application/x-ndjson";
};

type AuditArchiveManifest = {
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
  const y = cutoff.getUTCFullYear();
  const m = String(cutoff.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function archivePaths(month: string): { dataKey: string; manifestKey: string } {
  const [year, monthNumber] = month.split("-");
  return {
    dataKey: `${ARCHIVE_PREFIX}/${year}/${monthNumber}/audit-${month}.ndjson.gz`,
    manifestKey: `${ARCHIVE_PREFIX}/${year}/${monthNumber}/manifest.json`,
  };
}

function toNdjson(rows: AuditArchiveDbRow[]): string {
  return rows
    .map((row) =>
      JSON.stringify({
        id: row.id,
        entity_type: row.entity_type,
        action: row.action,
        actor_id: row.actor_id,
        entity_id: row.entity_id,
        diff_title: row.diff_title,
        detail_text: row.detail_text,
        created_at: row.created_at,
      }),
    )
    .join("\n");
}

async function gzipText(text: string): Promise<ArrayBuffer> {
  const compression = new CompressionStream("gzip");
  const compressed = new Blob([text]).stream().pipeThrough(compression);
  return await new Response(compressed).arrayBuffer();
}

function buildManifest(month: string, file: AuditArchiveManifestFile, rows: AuditArchiveDbRow[]): AuditArchiveManifest {
  const entities: Record<string, number> = {};
  for (const row of rows) {
    entities[row.entity_type] = (entities[row.entity_type] ?? 0) + 1;
  }

  return {
    month,
    generated_at: new Date().toISOString(),
    total_rows: rows.length,
    entities,
    files: [file],
  };
}

export async function runAuditArchiveCron(env: Bindings): Promise<void> {
  const maxMonth = lastFullyExpiredMonth();
  if (!maxMonth) return;

  const monthRows = await env.DB.prepare(
    "SELECT DISTINCT substr(created_at, 1, 7) AS month FROM audit_log WHERE substr(created_at, 1, 7) <= ?1 ORDER BY month ASC",
  )
    .bind(maxMonth)
    .all<{ month: string }>();

  const months = (monthRows.results ?? [])
    .map((row) => row.month)
    .filter((month): month is string => typeof month === "string" && /^\d{4}-\d{2}$/.test(month));

  for (const month of months) {
    const rows = await env.DB.prepare(
      "SELECT id, entity_type, action, actor_id, entity_id, diff_title, detail_text, created_at FROM audit_log WHERE created_at LIKE ?1 ORDER BY created_at ASC",
    )
      .bind(`${month}-%`)
      .all<AuditArchiveDbRow>();

    if (!rows.results || rows.results.length === 0) {
      continue;
    }

    const { dataKey, manifestKey } = archivePaths(month);
    const existing = await env.MEDIA.head(dataKey);

    if (existing) {
      await env.DB.prepare("DELETE FROM audit_log WHERE created_at LIKE ?1").bind(`${month}-%`).run();
      continue;
    }

    const ndjson = toNdjson(rows.results);
    const compressed = await gzipText(ndjson);
    const sizeBytes = compressed.byteLength;
    await env.MEDIA.put(dataKey, compressed, {
      httpMetadata: {
        contentType: "application/x-ndjson",
        contentEncoding: "gzip",
      },
    });

    const manifest = buildManifest(
      month,
      {
        key: dataKey,
        row_count: rows.results.length,
        size_bytes: sizeBytes,
        content_encoding: "gzip",
        content_type: "application/x-ndjson",
      },
      rows.results,
    );
    await env.MEDIA.put(manifestKey, JSON.stringify(manifest, null, 2), {
      httpMetadata: {
        contentType: "application/json",
      },
    });

    await env.DB.prepare("DELETE FROM audit_log WHERE created_at LIKE ?1").bind(`${month}-%`).run();
  }
}
