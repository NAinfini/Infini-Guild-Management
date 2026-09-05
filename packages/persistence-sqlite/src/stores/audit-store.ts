import { AppError, type SqlExecutor, type SqlResult, type SqlValue } from "@guild/kernel";
import { auditEventSchema, auditPayloadV2Schema, type AuditEvent } from "@guild/shared";
import type {
  AuditEventWrite,
  AuditFilter,
  AuditStore,
  AuditStorePage,
  AuditStoreQuery,
} from "@guild/server/modules/audit";
import { auditInsertStatement } from "./audit-statement.js";

const EXPORT_PAGE_SIZE = 100;
const AUDIT_COLUMNS = [
  "id", "request_id", "actor_kind", "actor_id", "actor_label", "subject_type",
  "subject_id", "subject_label", "action", "payload_json", "occurred_at",
] as const;

export class SqliteAuditStore implements AuditStore {
  constructor(private readonly sql: SqlExecutor) {}

  async list(query: AuditStoreQuery): Promise<AuditStorePage> {
    const filter = auditFilter(query);
    const rows = allRows(await this.sql.read({
      method: "all",
      columns: AUDIT_COLUMNS,
      sql: `${auditSelect()} ${filter.where}
        ORDER BY logs.occurred_at DESC, logs.id DESC LIMIT ?`,
      params: [...filter.params, query.limit + 1],
    })).map(mapAuditSqlRow);
    const hasMore = rows.length > query.limit;
    return { data: hasMore ? rows.slice(0, query.limit) : rows, hasMore };
  }

  async *export(query: AuditFilter): AsyncIterable<AuditEvent> {
    let cursor: Readonly<{ occurredAt: string; eventId: string }> | null = null;
    while (true) {
      const filter = auditFilter({ ...query, limit: EXPORT_PAGE_SIZE, cursor });
      const rows = allRows(await this.sql.read({
        method: "all",
        columns: AUDIT_COLUMNS,
        sql: `${auditSelect()} ${filter.where}
          ORDER BY logs.occurred_at DESC, logs.id DESC LIMIT ?`,
        params: [...filter.params, EXPORT_PAGE_SIZE],
      }));
      for (const row of rows) yield mapAuditSqlRow(row);
      if (rows.length < EXPORT_PAGE_SIZE) return;
      const last = mapAuditSqlRow(rows.at(-1)!);
      cursor = { occurredAt: last.occurred_at, eventId: last.event_id };
    }
  }

  async recordExport(audit: AuditEventWrite): Promise<void> {
    await this.sql.execute(auditInsertStatement(audit));
  }
}

function auditSelect(): string {
  return `SELECT logs.id, logs.request_id, logs.actor_kind, logs.actor_id, logs.actor_label,
    logs.subject_type, logs.subject_id, logs.subject_label, logs.action, logs.payload_json,
    logs.occurred_at FROM audit_log AS logs`;
}

function auditFilter(query: AuditStoreQuery): Readonly<{ where: string; params: SqlValue[] }> {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (query.startAt) { clauses.push("logs.occurred_at >= ?"); params.push(query.startAt); }
  if (query.endAt) { clauses.push("logs.occurred_at <= ?"); params.push(query.endAt); }
  if (query.subjectType) { clauses.push("logs.subject_type = ?"); params.push(query.subjectType); }
  if (query.subjectId) { clauses.push("logs.subject_id = ?"); params.push(query.subjectId); }
  if (query.actorId) { clauses.push("logs.actor_id = ?"); params.push(query.actorId); }
  if (query.search) {
    const pattern = `%${escapeLike(query.search.toLowerCase())}%`;
    clauses.push(`(lower(COALESCE(logs.subject_label, '')) LIKE ? ESCAPE '\\'
      OR lower(logs.subject_id) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(logs.actor_label, '')) LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern, pattern);
  }
  if (query.cursor) {
    clauses.push("(logs.occurred_at < ? OR (logs.occurred_at = ? AND logs.id < ?))");
    params.push(query.cursor.occurredAt, query.cursor.occurredAt, query.cursor.eventId);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function mapAuditSqlRow(row: readonly SqlValue[]): AuditEvent {
  const [eventId, requestId, actorKind, actorId, actorLabel, subjectType, subjectId,
    subjectLabel, action, payloadJson, occurredAt] = row;
  if (typeof payloadJson !== "string") throw corrupt("Invalid audit payload");
  let payload: AuditEvent["payload"];
  try {
    payload = auditPayloadV2Schema.parse(JSON.parse(payloadJson) as unknown);
  } catch (cause) {
    throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Invalid audit payload", cause });
  }
  return auditEventSchema.parse({
    event_id: eventId,
    request_id: requestId,
    actor: { kind: actorKind, id: actorId, label: actorLabel },
    subject: { type: subjectType, id: subjectId, label: subjectLabel },
    action,
    payload,
    occurred_at: occurredAt,
  });
}

function allRows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) throw corrupt("Invalid SQLite all result");
  return result.rows as readonly (readonly SqlValue[])[];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function corrupt(message: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message });
}
