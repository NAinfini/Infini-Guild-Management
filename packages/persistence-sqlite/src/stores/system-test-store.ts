import type {
  SystemTestArtifact,
  SystemTestRunRecord,
  SystemTestRunStatus,
  SystemTestStore,
} from "@guild/server/modules/system-test";
import {
  SYSTEM_TEST_ARTIFACT_TYPES,
  type SystemTestArtifactType,
} from "@guild/shared/schemas/system-test";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertStatement } from "./audit-statement.js";
import { returnedRowCount } from "./sql-result.js";
import {
  observedBacklog,
  SCHEDULED_BACKLOG_READ_LIMIT,
} from "./scheduled-backlog.js";

export class SqliteSystemTestStore implements SystemTestStore {
  constructor(private readonly sql: SqlExecutor) {}

  async createRun(input: Parameters<SystemTestStore["createRun"]>[0]): Promise<void> {
    await this.sql.execute({
      method: "run",
      sql: `INSERT INTO system_test_runs
        (id, actor_user_id, status, cleanup_attempts, expires_at, created_at, updated_at)
        VALUES (?, ?, 'running', 0, ?, ?, ?)`,
      params: [input.id, input.actorUserId, input.expiresAt, input.createdAt, input.createdAt],
    });
  }

  async getRun(id: string): Promise<SystemTestRunRecord | null> {
    const row = oneRow(await this.sql.execute({
      method: "get",
      sql: "SELECT id, actor_user_id, status, cleanup_attempts FROM system_test_runs WHERE id = ?",
      params: [id],
    }));
    if (!row) return null;
    const [runId, actorUserId, status, attempts] = row;
    if (typeof runId !== "string" || typeof actorUserId !== "string" || !isRunStatus(status)
      || typeof attempts !== "number" || !Number.isSafeInteger(attempts) || attempts < 0) {
      throw new Error("Invalid system test run row");
    }
    return { id: runId, actorUserId, status, cleanupAttempts: attempts };
  }

  async beginRequest(input: Parameters<SystemTestStore["beginRequest"]>[0]): Promise<boolean> {
    if (input.actorUserId === null && !input.allowAnonymous) return false;
    const result = await this.sql.execute({
      method: "get",
      sql: `INSERT INTO system_test_requests (request_id, run_id, actor_user_id, started_at)
        SELECT ?, runs.id, ?, ?
        FROM system_test_runs AS runs
        WHERE runs.id = ? AND runs.status = 'running'
          AND (
            ? IS NULL
            OR runs.actor_user_id = ?
            OR EXISTS (
              SELECT 1 FROM system_test_artifacts AS artifacts
              WHERE artifacts.run_id = runs.id
                AND artifacts.artifact_type = 'user'
                AND artifacts.artifact_key = ?
            )
          )
        RETURNING 1 AS affected`,
      params: [
        input.requestId,
        input.actorUserId,
        input.startedAt,
        input.runId,
        input.actorUserId,
        input.actorUserId,
        input.actorUserId,
      ],
    });
    return returnedRowCount(result) === 1;
  }

  async endRequest(requestId: string): Promise<void> {
    await this.sql.execute({ method: "run", sql: "DELETE FROM system_test_requests WHERE request_id = ?", params: [requestId] });
  }

  async isActiveRequest(requestId: string): Promise<boolean> {
    return oneRow(await this.sql.execute({
      method: "get",
      sql: `SELECT 1 FROM system_test_requests AS requests
        JOIN system_test_runs AS runs ON runs.id = requests.run_id
        WHERE requests.request_id = ? AND runs.status = 'running'`,
      params: [requestId],
    })) !== null;
  }

  async claimCleanup(runId: string, at: string): Promise<boolean> {
    const result = await this.sql.execute({
      method: "get",
      sql: `UPDATE system_test_runs
        SET status = 'cleaning',
            cleanup_attempts = cleanup_attempts + CASE WHEN status = 'cleaning' THEN 0 ELSE 1 END,
            last_error = NULL,
            updated_at = ?
        WHERE id = ? AND status IN ('running', 'cleaning', 'cleanup_failed')
          AND NOT EXISTS (SELECT 1 FROM system_test_requests WHERE run_id = ?)
        RETURNING 1 AS affected`,
      params: [at, runId, runId],
    });
    return returnedRowCount(result) === 1;
  }

  async listArtifacts(runId: string, limit: number): Promise<readonly SystemTestArtifact[]> {
    const rows = allRows(await this.sql.execute({
      method: "all",
      sql: `SELECT artifact_type, artifact_key
        FROM system_test_artifacts
        WHERE run_id = ?
        ORDER BY CASE artifact_type
          WHEN 'guild_war' THEN 10
          WHEN 'event' THEN 20
          WHEN 'recurring_template' THEN 30
          WHEN 'storage_batch' THEN 40
          WHEN 'storage_item' THEN 50
          WHEN 'storage_category' THEN 60
          WHEN 'storage' THEN 70
          WHEN 'wiki_article' THEN 80
          WHEN 'wiki_category' THEN 90
          WHEN 'announcement' THEN 100
          WHEN 'gallery_item' THEN 110
          WHEN 'badge' THEN 120
          WHEN 'invite_link' THEN 130
          WHEN 'member_absence' THEN 140
          WHEN 'user' THEN 150
          WHEN 'role' THEN 160
          WHEN 'class_tag' THEN 170
          WHEN 'class_catalog' THEN 180
          WHEN 'media_asset' THEN 190
          WHEN 'error_log' THEN 195
          WHEN 'audit_log' THEN 200
        END, artifact_key
        LIMIT ?`,
      params: [runId, limit],
    }));
    return rows.map(([type, key]) => {
      if (!isArtifactType(type) || typeof key !== "string") throw new Error("Invalid system test artifact row");
      return { type, key };
    });
  }

  async completeCleanup(runId: string, at: string): Promise<boolean> {
    const result = await this.sql.execute({
      method: "get",
      sql: `UPDATE system_test_runs
        SET status = 'completed', completed_at = ?, updated_at = ?, last_error = NULL
        WHERE id = ? AND status = 'cleaning'
          AND NOT EXISTS (SELECT 1 FROM system_test_requests WHERE run_id = ?)
          AND NOT EXISTS (SELECT 1 FROM system_test_artifacts WHERE run_id = ?)
          AND NOT EXISTS (SELECT 1 FROM system_test_before_images WHERE run_id = ?)
        RETURNING 1 AS affected`,
      params: [at, at, runId, runId, runId, runId],
    });
    return returnedRowCount(result) === 1;
  }

  async failCleanup(runId: string, message: string, at: string): Promise<void> {
    await this.sql.execute({
      method: "run",
      sql: `UPDATE system_test_runs
        SET status = 'cleanup_failed', last_error = ?, updated_at = ?
        WHERE id = ? AND status = 'cleaning'`,
      params: [message, at, runId],
    });
  }

  async listExpiredRunIds(before: string, limit: number): Promise<readonly string[]> {
    return allRows(await this.sql.execute({
      method: "all",
      sql: `SELECT id FROM system_test_runs
        WHERE status <> 'completed' AND expires_at <= ?
        ORDER BY expires_at, id LIMIT ?`,
      params: [before, limit],
    })).map((row) => {
      if (typeof row[0] !== "string") throw new Error("Invalid expired system test run row");
      return row[0];
    });
  }

  async inspectExpiredBacklog(before: string) {
    const pendingAt = allRows(await this.sql.execute({
      method: "all",
      columns: ["pending_at"],
      sql: `SELECT expires_at AS pending_at FROM system_test_runs
        WHERE status IN ('running', 'cleaning', 'cleanup_failed') AND expires_at <= ?
        ORDER BY expires_at, id LIMIT ?`,
      params: [before, SCHEDULED_BACKLOG_READ_LIMIT],
    })).map((row) => {
      const pendingAt = row[0];
      if (typeof pendingAt !== "string") throw new Error("Invalid expired system test backlog row");
      return pendingAt;
    });
    return observedBacklog(pendingAt);
  }

  async expireRequests(runId: string, before: string): Promise<void> {
    await this.sql.execute({
      method: "run",
      sql: "DELETE FROM system_test_requests WHERE run_id = ? AND started_at <= ?",
      params: [runId, before],
    });
  }

  async finalizeRun(input: Parameters<SystemTestStore["finalizeRun"]>[0]): Promise<boolean> {
    const predicate = `id = ? AND actor_user_id = ? AND status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM system_test_requests WHERE run_id = system_test_runs.id)
      AND NOT EXISTS (SELECT 1 FROM system_test_artifacts WHERE run_id = system_test_runs.id)
      AND NOT EXISTS (SELECT 1 FROM system_test_before_images WHERE run_id = system_test_runs.id)`;
    const guard = { sql: `SELECT 1 FROM system_test_runs WHERE ${predicate}`, params: [input.runId, input.actorUserId] };
    const statements: SqlBatchStatement[] = [];
    if (input.audit) statements.push(auditInsertStatement(input.audit, guard));
    statements.push({
      method: "all",
      columns: ["affected"],
      sql: `DELETE FROM system_test_runs WHERE ${predicate} RETURNING 1 AS affected`,
      params: [input.runId, input.actorUserId],
    });
    const results = await this.sql.batch(statements);
    return returnedRowCount(results.at(-1)) === 1;
  }
}

function oneRow(result: SqlResult): readonly SqlValue[] | null {
  if (result.rows === undefined) return null;
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) {
    throw new Error("Invalid SQLite get result");
  }
  return result.rows as readonly SqlValue[];
}

function allRows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw new Error("Invalid SQLite all result");
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function isRunStatus(value: SqlValue | undefined): value is SystemTestRunStatus {
  return value === "running" || value === "cleaning" || value === "cleanup_failed" || value === "completed";
}

function isArtifactType(value: SqlValue | undefined): value is SystemTestArtifactType {
  return typeof value === "string" && (SYSTEM_TEST_ARTIFACT_TYPES as readonly string[]).includes(value);
}
