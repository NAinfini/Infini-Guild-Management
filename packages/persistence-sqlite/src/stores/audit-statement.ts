import type { SqlBatchStatement, SqlValue } from "@guild/kernel";
import type { AuditEventWrite } from "@guild/server/modules/audit";

const AUDIT_INSERT_COLUMNS = `(
  id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
  subject_label, action, payload_json, occurred_at
)`;

export function auditInsertSelectStatement(
  selectSql: string,
  params: readonly SqlValue[] = [],
): SqlBatchStatement {
  return { method: "run", sql: `INSERT INTO audit_log ${AUDIT_INSERT_COLUMNS} ${selectSql}`, params };
}

export function auditInsertStatement(
  audit: AuditEventWrite,
  guard?: Readonly<{ sql: string; params?: readonly SqlValue[] }>,
): SqlBatchStatement {
  return auditInsertSelectStatement(
    `SELECT ?, ?, ?, ?,
      CASE WHEN ? = 'user' THEN (SELECT display_name FROM users WHERE id = ?) ELSE ? END,
      ?, ?, ?, ?, ?, ?${guard ? ` WHERE EXISTS (${guard.sql})` : ""}`,
    [
      audit.eventId,
      audit.requestId,
      audit.actorKind,
      audit.actorId,
      audit.actorKind,
      audit.actorId,
      audit.actorLabel,
      audit.subjectType,
      audit.subjectId,
      audit.subjectLabel,
      audit.action,
      JSON.stringify(audit.payload),
      audit.occurredAt,
      ...(guard?.params ?? []),
    ],
  );
}
