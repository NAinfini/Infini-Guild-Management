import { drizzle } from "drizzle-orm/d1";
import { errorLog } from "../db/schema/error-log";
import { logger } from "../utils/logger";

const ERROR_MESSAGE_MAX_LENGTH = 2000;
const ERROR_STACK_MAX_LENGTH = 4000;

export type ErrorLogInput = {
  source: "request" | "cron" | "push" | "audit";
  level?: "error" | "warn";
  message: string;
  requestPath?: string;
  requestMethod?: string;
  requestId?: string;
  stack?: string;
  context?: Record<string, unknown>;
};

function toErrorLogValues(input: ErrorLogInput) {
  return {
    id: crypto.randomUUID(),
    source: input.source,
    level: input.level ?? "error",
    message: input.message.slice(0, ERROR_MESSAGE_MAX_LENGTH),
    requestPath: input.requestPath,
    requestMethod: input.requestMethod,
    requestId: input.requestId,
    stack: input.stack?.slice(0, ERROR_STACK_MAX_LENGTH),
    context: input.context
      ? JSON.stringify(input.context)
      : null,
  };
}

export async function writeErrorLog(
  db: D1Database,
  input: ErrorLogInput,
): Promise<void> {
  try {
    const drizzleDb = drizzle(db);
    await drizzleDb.insert(errorLog).values(toErrorLogValues(input));
  } catch (e) {
    logger.error("Failed to write error log", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Error rows created while a system-test request lease is active must be
 * registered in the same D1 batch. This prevents either an untracked error UUID
 * or an artifact pointer without its row from surviving a failed request.
 */
export async function writeSystemTestErrorLog(
  db: D1Database,
  runId: string,
  input: ErrorLogInput,
): Promise<void> {
  const values = toErrorLogValues(input);
  const results = await db.batch([
    db.prepare(
      `INSERT INTO error_log
         (id, source, level, message, request_path, request_method, request_id, stack, context)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM system_test_runs
       WHERE id = ? AND status = 'running'`,
    ).bind(
      values.id,
      values.source,
      values.level,
      values.message,
      values.requestPath ?? null,
      values.requestMethod ?? null,
      values.requestId ?? null,
      values.stack ?? null,
      values.context,
      runId,
    ),
    db.prepare(
      `INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key)
       SELECT ?, 'error_log', ?
       FROM system_test_runs
       WHERE id = ? AND status = 'running'
       ON CONFLICT(run_id, artifact_type, artifact_key)
       DO UPDATE SET artifact_key = excluded.artifact_key`,
    ).bind(runId, values.id, runId),
  ]);
  if (results.length !== 2 || results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("System test run closed before its error record was registered");
  }
}
