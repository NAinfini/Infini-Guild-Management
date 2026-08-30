import type { ImportantNoticeActive, ImportantNoticeAudienceRole } from "@guild/shared";
import { MAX_ACTIVE_IMPORTANT_NOTICES } from "@guild/shared/constants/important-notices";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import type {
  ImportantNoticeRecord,
  ImportantNoticeStore,
} from "@guild/server/modules/important-notices";
import { auditInsertStatement } from "./audit-statement.js";
import { returnedRowCount } from "./sql-result.js";

const RECORD_COLUMNS = [
  "id", "title", "body_json", "status", "publish_at", "expires_at", "publication_revision",
  "requires_acknowledgement", "audience_scope", "audience_role_ids", "revision_token",
  "created_by", "updated_by", "created_at", "updated_at",
] as const;

const RECORD_SELECT = `id, title, body_json, status, publish_at, expires_at, publication_revision,
  requires_acknowledgement, audience_scope,
  coalesce((SELECT json_group_array(role_id) FROM important_notice_audience_roles
    WHERE notice_id = important_notices.id), '[]') AS audience_role_ids,
  revision_token, created_by, updated_by, created_at, updated_at`;

export class SqliteImportantNoticeStore implements ImportantNoticeStore {
  constructor(private readonly sql: SqlExecutor) {}

  async list(): Promise<readonly ImportantNoticeRecord[]> {
    const result = await this.sql.execute({
      method: "all",
      columns: RECORD_COLUMNS,
      sql: `SELECT ${RECORD_SELECT} FROM important_notices
        ORDER BY updated_at DESC, id DESC`,
    });
    return allRows(result, "Important notice list").map(mapRecord);
  }

  async get(id: string): Promise<ImportantNoticeRecord | null> {
    const result = await this.sql.execute({
      method: "get",
      columns: RECORD_COLUMNS,
      sql: `SELECT ${RECORD_SELECT} FROM important_notices WHERE id = ?`,
      params: [id],
    });
    const row = oneRow(result, "Important notice");
    return row === null ? null : mapRecord(row);
  }

  async create(input: Parameters<ImportantNoticeStore["create"]>[0]): Promise<void> {
    await this.sql.batch([
      insertRecord(input.record),
      replaceAudienceRolesStatement(input.record),
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
              requires_acknowledgement = ?, audience_scope = ?, revision_token = ?, updated_by = ?, updated_at = ?
          WHERE id = ? AND revision_token = ? RETURNING id`,
        params: [
          input.record.title,
          input.record.body_json,
          input.record.status,
          input.record.publish_at,
          input.record.expires_at,
          input.record.publication_revision,
          input.record.requires_acknowledgement ? 1 : 0,
          input.record.audience_scope,
          input.record.revisionToken,
          input.record.updatedBy,
          input.record.updated_at,
          input.record.id,
          input.expectedRevisionToken,
        ],
      },
      {
        method: "run",
        sql: `DELETE FROM important_notice_audience_roles
          WHERE notice_id = ? AND EXISTS (
            SELECT 1 FROM important_notices WHERE id = ? AND revision_token = ?
          )`,
        params: [input.record.id, input.record.id, input.record.revisionToken],
      },
      replaceAudienceRolesStatement(input.record, input.record.revisionToken),
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

  async listAudienceRoles(): Promise<readonly ImportantNoticeAudienceRole[]> {
    const result = await this.sql.execute({
      method: "all",
      columns: ["id", "name", "color", "level"],
      sql: "SELECT id, name, color, level FROM roles ORDER BY level DESC, name COLLATE NOCASE, id",
    });
    return allRows(result, "Important notice audience roles").map((row) => {
      const [id, name, color, level] = row;
      if (
        typeof id !== "string" || typeof name !== "string" || (color !== null && typeof color !== "string")
        || typeof level !== "number" || !Number.isSafeInteger(level)
      ) throw new TypeError("Invalid important notice audience role row");
      return { id, name, color, level };
    });
  }

  async listActive(input: Parameters<ImportantNoticeStore["listActive"]>[0]): Promise<readonly ImportantNoticeActive[]> {
    const result = await this.sql.execute({
      method: "all",
      columns: [
        "id", "title", "body_json", "published_at", "expires_at", "requires_acknowledgement",
        "read_at", "acknowledged_at",
      ],
      sql: `SELECT notices.id, notices.title, notices.body_json, notices.publish_at AS published_at,
          notices.expires_at, notices.requires_acknowledgement,
          CASE WHEN receipts.read_publication_revision = notices.publication_revision
            THEN receipts.read_at ELSE NULL END AS read_at,
          receipts.acknowledged_at
        FROM important_notices AS notices INDEXED BY idx_important_notices_active
        LEFT JOIN important_notice_receipts AS receipts
          ON receipts.notice_id = notices.id AND receipts.user_id = ?
        WHERE notices.status IN ('scheduled', 'published') AND notices.publish_at <= ?
          AND (notices.expires_at IS NULL OR notices.expires_at > ?)
          AND (notices.audience_scope = 'all' OR EXISTS (
            SELECT 1 FROM important_notice_audience_roles AS audience
            WHERE audience.notice_id = notices.id AND audience.role_id = ?
          ))
        ORDER BY notices.publish_at ASC, notices.id ASC
        LIMIT ${MAX_ACTIVE_IMPORTANT_NOTICES + 1}`,
      params: [input.userId, input.now, input.now, input.roleId],
    });
    return allRows(result, "Active important notices").map((row) => {
      const [id, title, bodyJson, publishedAt, expiresAt, requiresAcknowledgement, readAt, acknowledgedAt] = row;
      if (
        typeof id !== "string" || typeof title !== "string" || typeof bodyJson !== "string"
        || typeof publishedAt !== "string" || (expiresAt !== null && typeof expiresAt !== "string")
        || (requiresAcknowledgement !== 0 && requiresAcknowledgement !== 1)
        || (readAt !== null && typeof readAt !== "string")
        || (acknowledgedAt !== null && typeof acknowledgedAt !== "string")
      ) throw new TypeError("Invalid active important notice row");
      return {
        id,
        title,
        body_json: bodyJson,
        published_at: publishedAt,
        expires_at: expiresAt,
        requires_acknowledgement: requiresAcknowledgement === 1,
        read_at: readAt,
        acknowledged_at: acknowledgedAt,
      };
    });
  }

  async markRead(input: Parameters<ImportantNoticeStore["markRead"]>[0]): Promise<number> {
    const idsJson = input.ids === null ? null : JSON.stringify(input.ids);
    const result = await this.sql.execute({
      method: "all",
      columns: ["notice_id"],
      sql: `INSERT INTO important_notice_receipts
          (notice_id, user_id, read_at, read_publication_revision, acknowledged_at)
        SELECT notices.id, ?, ?, notices.publication_revision, NULL
        FROM important_notices AS notices INDEXED BY idx_important_notices_active
        WHERE notices.status IN ('scheduled', 'published') AND notices.publish_at <= ?
          AND (notices.expires_at IS NULL OR notices.expires_at > ?)
          AND (notices.audience_scope = 'all' OR EXISTS (
            SELECT 1 FROM important_notice_audience_roles AS audience
            WHERE audience.notice_id = notices.id AND audience.role_id = ?
          ))
          ${idsJson === null ? "" : "AND notices.id IN (SELECT value FROM json_each(?))"}
        ON CONFLICT(notice_id, user_id) DO UPDATE SET
          read_at = excluded.read_at,
          read_publication_revision = excluded.read_publication_revision
          WHERE important_notice_receipts.read_publication_revision <> excluded.read_publication_revision
        RETURNING notice_id`,
      params: [
        input.userId,
        input.now,
        input.now,
        input.now,
        input.roleId,
        ...(idsJson === null ? [] : [idsJson]),
      ],
    });
    return allRows(result, "Important notice read receipts").length;
  }

  async acknowledge(input: Parameters<ImportantNoticeStore["acknowledge"]>[0]): Promise<boolean> {
    const result = await this.sql.execute({
      method: "all",
      columns: ["notice_id"],
      sql: `INSERT INTO important_notice_receipts
          (notice_id, user_id, read_at, read_publication_revision, acknowledged_at)
        SELECT notices.id, ?, ?, notices.publication_revision, ? FROM important_notices AS notices
        WHERE notices.id = ? AND notices.requires_acknowledgement = 1
          AND notices.status IN ('scheduled', 'published') AND notices.publish_at <= ?
          AND (notices.expires_at IS NULL OR notices.expires_at > ?)
          AND (notices.audience_scope = 'all' OR EXISTS (
            SELECT 1 FROM important_notice_audience_roles AS audience
            WHERE audience.notice_id = notices.id AND audience.role_id = ?
          ))
        ON CONFLICT(notice_id, user_id) DO UPDATE SET
          read_at = CASE
            WHEN important_notice_receipts.read_publication_revision = excluded.read_publication_revision
              THEN important_notice_receipts.read_at
            ELSE excluded.read_at
          END,
          read_publication_revision = excluded.read_publication_revision,
          acknowledged_at = coalesce(important_notice_receipts.acknowledged_at, excluded.acknowledged_at)
        RETURNING notice_id`,
      params: [input.userId, input.now, input.now, input.id, input.now, input.now, input.roleId],
    });
    return allRows(result, "Important notice acknowledgement").length === 1;
  }
}

function insertRecord(record: ImportantNoticeRecord): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO important_notices (
      id, title, body_json, status, publish_at, expires_at, publication_revision, revision_token,
      requires_acknowledgement, audience_scope, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      record.id,
      record.title,
      record.body_json,
      record.status,
      record.publish_at,
      record.expires_at,
      record.publication_revision,
      record.revisionToken,
      record.requires_acknowledgement ? 1 : 0,
      record.audience_scope,
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
    requiresAcknowledgement, audienceScope, audienceRoleIdsJson, revisionToken,
    createdBy, updatedBy, createdAt, updatedAt,
  ] = row;
  if (
    typeof id !== "string" || typeof title !== "string" || typeof bodyJson !== "string" || typeof status !== "string"
    || (publishAt !== null && typeof publishAt !== "string") || (expiresAt !== null && typeof expiresAt !== "string")
    || typeof publicationRevision !== "number" || !Number.isSafeInteger(publicationRevision)
    || (requiresAcknowledgement !== 0 && requiresAcknowledgement !== 1)
    || (audienceScope !== "all" && audienceScope !== "roles") || typeof audienceRoleIdsJson !== "string"
    || typeof revisionToken !== "string" || typeof createdBy !== "string"
    || (updatedBy !== null && typeof updatedBy !== "string") || typeof createdAt !== "string" || typeof updatedAt !== "string"
  ) throw new TypeError("Invalid important notice row");
  const audienceRoleIds = parseAudienceRoleIds(audienceRoleIdsJson);
  if (audienceScope === "all" && audienceRoleIds.length > 0) {
    throw new TypeError("Invalid important notice audience");
  }
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
    requires_acknowledgement: requiresAcknowledgement === 1,
    audience_scope: audienceScope,
    audience_role_ids: audienceRoleIds,
    revisionToken,
    createdBy,
    updatedBy,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function replaceAudienceRolesStatement(
  record: ImportantNoticeRecord,
  revisionToken?: string,
): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO important_notice_audience_roles (notice_id, role_id)
      SELECT ?, value FROM json_each(?)
      ${revisionToken === undefined ? "" : "WHERE EXISTS (SELECT 1 FROM important_notices WHERE id = ? AND revision_token = ?)"}`,
    params: revisionToken === undefined
      ? [record.id, JSON.stringify(record.audience_role_ids)]
      : [record.id, JSON.stringify(record.audience_role_ids), record.id, revisionToken],
  };
}

function parseAudienceRoleIds(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new TypeError("Invalid important notice audience roles");
  }
  if (!Array.isArray(parsed) || parsed.some((roleId) => typeof roleId !== "string")) {
    throw new TypeError("Invalid important notice audience roles");
  }
  return [...parsed].sort();
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

function nonnegativeInteger(value: SqlValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
