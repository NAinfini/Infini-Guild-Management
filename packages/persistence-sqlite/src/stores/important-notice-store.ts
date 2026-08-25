import type {
  ImportantNoticeAcknowledgement,
  ImportantNoticeActive,
} from "@guild/shared";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import type {
  ImportantNoticeRecord,
  ImportantNoticeStore,
} from "@guild/server/modules/important-notices";
import { auditInsertStatement } from "./audit-statement.js";
import { returnedRowCount } from "./sql-result.js";

const RECORD_COLUMNS = [
  "id", "title", "body_json", "status", "publish_at", "expires_at", "publication_revision",
  "revision_token", "created_by", "updated_by", "created_at", "updated_at",
] as const;

export class SqliteImportantNoticeStore implements ImportantNoticeStore {
  constructor(private readonly sql: SqlExecutor) {}

  async list(): Promise<readonly ImportantNoticeRecord[]> {
    const result = await this.sql.execute({
      method: "all",
      columns: RECORD_COLUMNS,
      sql: `SELECT ${RECORD_COLUMNS.join(", ")} FROM important_notices
        ORDER BY updated_at DESC, id DESC`,
    });
    return allRows(result, "Important notice list").map(mapRecord);
  }

  async get(id: string): Promise<ImportantNoticeRecord | null> {
    const result = await this.sql.execute({
      method: "get",
      columns: RECORD_COLUMNS,
      sql: `SELECT ${RECORD_COLUMNS.join(", ")} FROM important_notices WHERE id = ?`,
      params: [id],
    });
    const row = oneRow(result, "Important notice");
    return row === null ? null : mapRecord(row);
  }

  async create(input: Parameters<ImportantNoticeStore["create"]>[0]): Promise<void> {
    await this.sql.batch([
      insertRecord(input.record),
      auditInsertStatement(input.audit),
    ]);
  }

  async update(input: Parameters<ImportantNoticeStore["update"]>[0]): Promise<boolean> {
    const guard = { sql: "SELECT 1 FROM important_notices WHERE id = ? AND revision_token = ?", params: [input.record.id, input.record.revisionToken] } as const;
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["id"],
        sql: `UPDATE important_notices
          SET title = ?, body_json = ?, status = ?, publish_at = ?, expires_at = ?, publication_revision = ?,
              revision_token = ?, updated_by = ?, updated_at = ?
          WHERE id = ? AND revision_token = ? RETURNING id`,
        params: [
          input.record.title,
          input.record.body_json,
          input.record.status,
          input.record.publish_at,
          input.record.expires_at,
          input.record.publication_revision,
          input.record.revisionToken,
          input.record.updatedBy,
          input.record.updated_at,
          input.record.id,
          input.expectedRevisionToken,
        ],
      },
      auditInsertStatement(input.audit, guard),
    ]);
    return returnedRowCount(required(results[0], "Important notice update")) === 1;
  }

  async delete(input: Parameters<ImportantNoticeStore["delete"]>[0]): Promise<boolean> {
    const mutationToken = crypto.randomUUID();
    const guard = { sql: "SELECT 1 FROM important_notices WHERE id = ? AND revision_token = ?", params: [input.id, mutationToken] } as const;
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["id"],
        sql: `UPDATE important_notices SET revision_token = ?
          WHERE id = ? AND revision_token = ? RETURNING id`,
        params: [mutationToken, input.id, input.expectedRevisionToken],
      },
      auditInsertStatement(input.audit, guard),
      {
        method: "run",
        sql: "DELETE FROM important_notices WHERE id = ? AND revision_token = ?",
        params: [input.id, mutationToken],
      },
    ]);
    return returnedRowCount(required(results[0], "Important notice delete")) === 1;
  }

  async listActive(now: string): Promise<readonly ImportantNoticeActive[]> {
    const result = await this.sql.execute({
      method: "all",
      columns: ["id", "title", "body_json", "published_at", "expires_at", "publication_revision"],
      sql: `SELECT id, title, body_json, publish_at AS published_at, expires_at, publication_revision
        FROM important_notices INDEXED BY idx_important_notices_active
        WHERE status IN ('scheduled', 'published') AND publish_at <= ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY publish_at ASC, id ASC`,
      params: [now, now],
    });
    return allRows(result, "Active important notices").map((row) => {
      const [id, title, bodyJson, publishedAt, expiresAt, publicationRevision] = row;
      if (
        typeof id !== "string" || typeof title !== "string" || typeof bodyJson !== "string"
        || typeof publishedAt !== "string" || (expiresAt !== null && typeof expiresAt !== "string")
        || typeof publicationRevision !== "number" || !Number.isSafeInteger(publicationRevision) || publicationRevision < 1
      ) throw new TypeError("Invalid active important notice row");
      return {
        id,
        title,
        body_json: bodyJson,
        published_at: publishedAt,
        expires_at: expiresAt,
        publication_revision: positiveInteger(publicationRevision, "Active important notice revision"),
      };
    });
  }

  async listAcknowledgements(userId: string, now: string): Promise<readonly ImportantNoticeAcknowledgement[]> {
    const result = await this.sql.execute({
      method: "all",
      columns: ["notice_id", "publication_revision"],
      sql: `SELECT acknowledgements.notice_id, acknowledgements.publication_revision
        FROM important_notice_acknowledgements AS acknowledgements
        JOIN important_notices AS notices ON notices.id = acknowledgements.notice_id
          AND notices.publication_revision = acknowledgements.publication_revision
        WHERE acknowledgements.user_id = ?
          AND notices.status IN ('scheduled', 'published') AND notices.publish_at <= ?
          AND (notices.expires_at IS NULL OR notices.expires_at > ?)
        ORDER BY acknowledgements.notice_id`,
      params: [userId, now, now],
    });
    return allRows(result, "Important notice acknowledgements").map((row) => {
      const [noticeId, revision] = row;
      if (typeof noticeId !== "string" || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
        throw new TypeError("Invalid important notice acknowledgement row");
      }
      return {
        notice_id: noticeId,
        publication_revision: positiveInteger(revision, "Important notice acknowledgement revision"),
      };
    });
  }

  async acknowledge(input: Parameters<ImportantNoticeStore["acknowledge"]>[0]): Promise<boolean> {
    const results = await this.sql.batch([
      {
        method: "run",
        sql: `INSERT INTO important_notice_acknowledgements
          (notice_id, user_id, publication_revision, acknowledged_at)
          SELECT id, ?, publication_revision, ? FROM important_notices
          WHERE id = ? AND publication_revision = ?
            AND status IN ('scheduled', 'published') AND publish_at <= ?
            AND (expires_at IS NULL OR expires_at > ?)
          ON CONFLICT(notice_id, user_id, publication_revision) DO NOTHING`,
        params: [input.userId, input.now, input.id, input.publicationRevision, input.now, input.now],
      },
      {
        method: "get",
        columns: ["active"],
        sql: `SELECT EXISTS(
          SELECT 1 FROM important_notices
          WHERE id = ? AND publication_revision = ?
            AND status IN ('scheduled', 'published') AND publish_at <= ?
            AND (expires_at IS NULL OR expires_at > ?)
        ) AS active`,
        params: [input.id, input.publicationRevision, input.now, input.now],
      },
    ]);
    return numberCell(required(results[1], "Important notice acknowledgement"), "Important notice active flag") === 1;
  }
}

function insertRecord(record: ImportantNoticeRecord): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO important_notices (
      id, title, body_json, status, publish_at, expires_at, publication_revision, revision_token,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      record.id,
      record.title,
      record.body_json,
      record.status,
      record.publish_at,
      record.expires_at,
      record.publication_revision,
      record.revisionToken,
      record.createdBy,
      record.updatedBy,
      record.created_at,
      record.updated_at,
    ],
  };
}

function mapRecord(row: readonly SqlValue[]): ImportantNoticeRecord {
  const [
    id, title, bodyJson, status, publishAt, expiresAt, publicationRevision,
    revisionToken, createdBy, updatedBy, createdAt, updatedAt,
  ] = row;
  if (
    typeof id !== "string" || typeof title !== "string" || typeof bodyJson !== "string" || typeof status !== "string"
    || (publishAt !== null && typeof publishAt !== "string") || (expiresAt !== null && typeof expiresAt !== "string")
    || typeof publicationRevision !== "number" || !Number.isSafeInteger(publicationRevision)
    || typeof revisionToken !== "string" || typeof createdBy !== "string"
    || (updatedBy !== null && typeof updatedBy !== "string") || typeof createdAt !== "string" || typeof updatedAt !== "string"
  ) throw new TypeError("Invalid important notice row");
  if (status !== "draft" && status !== "scheduled" && status !== "published" && status !== "withdrawn") {
    throw new TypeError("Invalid important notice status");
  }
  return {
    id,
    title,
    body_json: bodyJson,
    status,
    publish_at: publishAt,
    expires_at: expiresAt,
    publication_revision: nonnegativeInteger(publicationRevision, "Important notice publication revision"),
    revisionToken,
    createdBy,
    updatedBy,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function required(result: SqlResult | undefined, label: string): SqlResult {
  if (!result) throw new TypeError(`${label} result is missing`);
  return result;
}

function allRows(result: SqlResult, label: string): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw new TypeError(`${label} rows are invalid`);
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function oneRow(result: SqlResult, label: string): readonly SqlValue[] | null {
  if (result.rows === undefined) return null;
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) {
    throw new TypeError(`${label} row is invalid`);
  }
  return result.rows as readonly SqlValue[];
}

function numberCell(result: SqlResult, label: string): number {
  const row = oneRow(result, label);
  return nonnegativeInteger(row?.[0], label);
}

function positiveInteger(value: SqlValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nonnegativeInteger(value: SqlValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
