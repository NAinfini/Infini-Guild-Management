import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { nanoid } from "nanoid";
import { auditLog } from "../db/schema";
import type { Bindings } from "../index";
import { createLogger } from "../utils/logger";
import type { AuditEntityType, AuditAction } from "@guild/shared/constants/audit";
import { getSystemTestRunId } from "./SystemTestService";

const dbCache = new WeakMap<object, ReturnType<typeof drizzle>>();

function getDb(d1: D1Database): ReturnType<typeof drizzle> {
  let db = dbCache.get(d1);
  if (!db) {
    db = drizzle(d1);
    dbCache.set(d1, db);
  }
  return db;
}

export type WriteAuditLogInput = {
  entityType: AuditEntityType;
  action: AuditAction;
  actorId: string;
  entityId: string;
  diffTitle?: string | null;
  detailText?: string | null;
};

export type AuditLogStatementCondition = {
  sql: string;
  bindings: readonly unknown[];
};

/**
 * Builds durable audit statements for callers that already own an atomic D1
 * batch. The condition is internal SQL supplied by the service, never request
 * input. No statement is executed here.
 */
export function buildAuditLogStatements(
  c: Context,
  input: WriteAuditLogInput,
  condition?: AuditLogStatementCondition,
): D1PreparedStatement[] {
  const env = c.env as Bindings;
  const id = nanoid();
  const runId = getSystemTestRunId(c);
  const conditions: string[] = [];
  const conditionBindings: unknown[] = [];

  if (runId) {
    conditions.push(
      "EXISTS (SELECT 1 FROM system_test_runs WHERE id = ? AND status = 'running')",
    );
    conditionBindings.push(runId);
  }
  if (condition) {
    conditions.push(condition.sql);
    conditionBindings.push(...condition.bindings);
  }

  const values = [
    id,
    input.entityType,
    input.action,
    input.actorId,
    input.entityId,
    input.diffTitle ?? null,
    input.detailText ?? null,
  ];
  const auditStatement = conditions.length > 0
    ? env.DB.prepare(
        `INSERT INTO audit_log (id, entity_type, action, actor_id, entity_id, diff_title, detail_text)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE ${conditions.join(" AND ")}`,
      ).bind(...values, ...conditionBindings)
    : env.DB.prepare(
        `INSERT INTO audit_log (id, entity_type, action, actor_id, entity_id, diff_title, detail_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(...values);

  if (!runId) return [auditStatement];

  return [
    auditStatement,
    env.DB.prepare(
      `INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key)
       SELECT ?, 'audit_log', ?
       WHERE EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
         AND EXISTS (SELECT 1 FROM system_test_runs WHERE id = ? AND status = 'running')
       ON CONFLICT(run_id, artifact_type, artifact_key)
       DO UPDATE SET artifact_key = excluded.artifact_key`,
    ).bind(runId, id, id, runId),
  ];
}

async function writeSystemTestAudit(
  env: Bindings,
  runId: string,
  id: string,
  input: WriteAuditLogInput,
): Promise<void> {
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log (id, entity_type, action, actor_id, entity_id, diff_title, detail_text)
       SELECT ?, ?, ?, ?, ?, ?, ? FROM system_test_runs WHERE id = ? AND status = 'running'`,
    ).bind(
      id,
      input.entityType,
      input.action,
      input.actorId,
      input.entityId,
      input.diffTitle ?? null,
      input.detailText ?? null,
      runId,
    ),
    env.DB.prepare(
      `INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key)
       SELECT ?, 'audit_log', ? FROM system_test_runs WHERE id = ? AND status = 'running'
       ON CONFLICT(run_id, artifact_type, artifact_key)
       DO UPDATE SET artifact_key = excluded.artifact_key`,
    ).bind(runId, id, runId),
  ]);
  if (results.length !== 2 || results.some((result) => (result.meta.changes ?? 0) === 0)) {
    throw new Error("System test run closed before its audit record was registered");
  }
}

export async function writeAuditLog(c: Context, input: WriteAuditLogInput): Promise<void> {
  const env = c.env as Bindings;
  const db = getDb(env.DB);
  const log = createLogger(c.get("requestId") as string | undefined);
  const id = nanoid();
  const values = {
    id,
    entityType: input.entityType,
    action: input.action,
    actorId: input.actorId,
    entityId: input.entityId,
    diffTitle: input.diffTitle ?? null,
    detailText: input.detailText ?? null,
  };
  const runId = getSystemTestRunId(c);
  if (runId) {
    try {
      await writeSystemTestAudit(env, runId, id, input);
    } catch (error) {
      // Keep the business response available to the tracking middleware. It
      // can then register the exact returned root/media IDs or compensate them
      // instead of turning a successful write into an unlocatable 500.
      log.error("Temporary system-test audit write failed", {
        action: input.action,
        entityType: input.entityType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  const task = db.insert(auditLog).values(values).catch((err) => {
    log.error("writeAuditLog failed", { action: input.action, entityType: input.entityType, error: String(err) });
  });
  c.executionCtx.waitUntil(task);
}

export async function writeAuditLogDurable(c: Context, input: WriteAuditLogInput): Promise<void> {
  const env = c.env as Bindings;
  const db = getDb(env.DB);
  const log = createLogger(c.get("requestId") as string | undefined);
  const id = nanoid();
  const values = {
    id,
    entityType: input.entityType,
    action: input.action,
    actorId: input.actorId,
    entityId: input.entityId,
    diffTitle: input.diffTitle ?? null,
    detailText: input.detailText ?? null,
  };
  const runId = getSystemTestRunId(c);
  if (runId) {
    try {
      await writeSystemTestAudit(env, runId, id, input);
    } catch (error) {
      log.error("Temporary durable system-test audit write failed", {
        action: input.action,
        entityType: input.entityType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  await db.insert(auditLog).values(values);
}
