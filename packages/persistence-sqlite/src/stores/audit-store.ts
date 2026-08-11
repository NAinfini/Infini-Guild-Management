import { AppError } from "@guild/kernel";
import { jsonObjectSchema, type AuditLogEntry, type PaginatedResponse } from "@guild/shared";
import type { AuditMutation, AuditQuery, AuditStore } from "@guild/server/modules/audit";
import type { SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertStatement } from "./audit-statement.js";

const EXPORT_PAGE_SIZE = 100;
const AUDIT_COLUMNS = [
  "id", "entity_type", "action", "actor_user_id", "actor_username", "entity_id", "summary", "detail_json", "occurred_at",
] as const;

export class SqliteAuditStore implements AuditStore {
  constructor(private readonly sql: SqlExecutor) {}

  async list(query: AuditQuery): Promise<PaginatedResponse<AuditLogEntry>> {
    const filter = auditFilter(query);
    const [countResult, listResult] = await this.sql.batch([
      {
        method: "get",
        columns: ["total"],
        sql: `SELECT COUNT(*) AS total ${auditFrom()} ${filter.where}`,
        params: filter.params,
      },
      {
        method: "all",
        columns: AUDIT_COLUMNS,
        sql: `${auditSelect()} ${filter.where}
          ORDER BY logs.occurred_at DESC, logs.id DESC LIMIT ? OFFSET ?`,
        params: [...filter.params, query.limit, (query.page - 1) * query.limit],
      },
    ]);
    const count = oneRow(required(countResult))?.[0];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw corrupt("Invalid audit count");
    return {
      data: allRows(required(listResult)).map(mapAuditSqlRow),
      total: count,
      page: query.page,
      limit: query.limit,
      total_pages: Math.ceil(count / query.limit),
    };
  }

  async *export(query: Omit<AuditQuery, "page" | "limit">): AsyncIterable<AuditLogEntry> {
    let cursor: Readonly<{ occurredAt: string; id: string }> | null = null;
    while (true) {
      const filter = auditFilter({ ...query, page: 1, limit: EXPORT_PAGE_SIZE }, cursor);
      const rows = allRows(await this.sql.execute({
        method: "all",
        sql: `${auditSelect()} ${filter.where}
          ORDER BY logs.occurred_at DESC, logs.id DESC LIMIT ?`,
        params: [...filter.params, EXPORT_PAGE_SIZE],
      }));
      for (const row of rows) yield mapAuditSqlRow(row);
      if (rows.length < EXPORT_PAGE_SIZE) return;
      const last = mapAuditSqlRow(rows.at(-1)!);
      cursor = { occurredAt: last.created_at, id: last.id };
    }
  }

  async recordExport(audit: AuditMutation): Promise<void> {
    await this.sql.execute(auditInsertStatement(audit));
  }
}

function auditSelect(): string {
  return `SELECT logs.id, logs.entity_type, logs.action, logs.actor_user_id, logs.actor_username,
    logs.entity_id, logs.summary, logs.detail_json, logs.occurred_at ${auditFrom()}`;
}

function auditFrom(): string {
  return "FROM audit_log AS logs";
}

function auditFilter(
  query: AuditQuery,
  cursor: Readonly<{ occurredAt: string; id: string }> | null = null,
): Readonly<{ where: string; params: SqlValue[] }> {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (query.startAt) { clauses.push("logs.occurred_at >= ?"); params.push(query.startAt); }
  if (query.endAt) { clauses.push("logs.occurred_at <= ?"); params.push(query.endAt); }
  if (query.entityType) { clauses.push("logs.entity_type = ?"); params.push(query.entityType); }
  if (query.actorUserId) { clauses.push("logs.actor_user_id = ?"); params.push(query.actorUserId); }
  if (query.search) {
    const pattern = `%${escapeLike(query.search.toLowerCase())}%`;
    clauses.push(`(lower(COALESCE(logs.summary, '')) LIKE ? ESCAPE '\\'
      OR lower(logs.entity_id) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(logs.actor_username, '')) LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern, pattern);
  }
  if (cursor) {
    clauses.push("(logs.occurred_at < ? OR (logs.occurred_at = ? AND logs.id < ?))");
    params.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function mapAuditSqlRow(row: readonly SqlValue[]): AuditLogEntry {
  const [id, entityType, action, actorId, actorUsername, entityId, summary, detailJson, createdAt] = row;
  if (typeof id !== "string" || typeof entityType !== "string" || typeof action !== "string"
    || typeof actorId !== "string" || (actorUsername !== null && typeof actorUsername !== "string")
    || typeof entityId !== "string" || (summary !== null && typeof summary !== "string")
    || (detailJson !== null && typeof detailJson !== "string") || typeof createdAt !== "string") {
    throw corrupt("Invalid audit row");
  }
  let detail = null;
  if (detailJson !== null) {
    try {
      detail = jsonObjectSchema.parse(JSON.parse(detailJson) as unknown);
    } catch (cause) {
      throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Invalid audit detail", cause });
    }
  }
  return {
    id,
    entity_type: entityType as AuditLogEntry["entity_type"],
    action: action as AuditLogEntry["action"],
    actor_id: actorId,
    actor_username: actorUsername,
    entity_id: entityId,
    diff_title: summary,
    detail,
    created_at: createdAt,
  };
}

function oneRow(result: SqlResult): readonly SqlValue[] | null {
  if (result.rows === undefined) return null;
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) throw corrupt("Invalid SQLite get result");
  return result.rows as readonly SqlValue[];
}

function allRows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) throw corrupt("Invalid SQLite all result");
  return result.rows as readonly (readonly SqlValue[])[];
}

function required(result: SqlResult | undefined): SqlResult {
  if (!result) throw corrupt("SQLite batch result is missing");
  return result;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function corrupt(message: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message });
}
