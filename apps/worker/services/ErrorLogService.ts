import { drizzle } from "drizzle-orm/d1";
import { errorLog } from "../db/schema/error-log";
import { logger } from "../utils/logger";

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

export async function writeErrorLog(
  db: D1Database,
  input: ErrorLogInput,
): Promise<void> {
  try {
    const drizzleDb = drizzle(db);
    await drizzleDb.insert(errorLog).values({
      id: crypto.randomUUID(),
      source: input.source,
      level: input.level ?? "error",
      message: input.message.slice(0, 2000),
      requestPath: input.requestPath,
      requestMethod: input.requestMethod,
      requestId: input.requestId,
      stack: input.stack?.slice(0, 4000),
      context: input.context
        ? JSON.stringify(input.context)
        : null,
    });
  } catch (e) {
    logger.error("Failed to write error log", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
