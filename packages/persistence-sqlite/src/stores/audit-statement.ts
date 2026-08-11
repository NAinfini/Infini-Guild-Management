import type { AuditMutation } from "@guild/server/modules/audit";
import type { SqlBatchStatement } from "@guild/kernel";

export function auditInsertStatement(
  audit: AuditMutation,
  guard?: Readonly<{ sql: string; params?: readonly (null | string | number | bigint | Uint8Array)[] }>,
): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO audit_log (
      id, request_id, actor_user_id, actor_username, entity_type, entity_id, action, summary, detail_json, occurred_at
    ) SELECT ?, ?, ?, (SELECT username FROM users WHERE id = ?), ?, ?, ?, ?, ?, ?${guard ? ` WHERE EXISTS (${guard.sql})` : ""}`,
    params: [
      audit.id,
      audit.requestId,
      audit.actorUserId,
      audit.actorUserId,
      audit.entityType,
      audit.entityId,
      audit.action,
      audit.summary,
      audit.details === null ? null : JSON.stringify(audit.details),
      audit.occurredAt,
      ...(guard?.params ?? []),
    ],
  };
}
