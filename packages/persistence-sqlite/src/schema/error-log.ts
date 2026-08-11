import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ERROR_LOG_SOURCES = ["request", "scheduler", "realtime", "audit"] as const;

export const errorLog = sqliteTable(
  "error_log",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: ERROR_LOG_SOURCES }).notNull(),
    level: text("level", { enum: ["error", "warn"] }).notNull(),
    message: text("message").notNull(),
    requestPath: text("request_path"),
    requestMethod: text("request_method"),
    requestId: text("request_id"),
    stack: text("stack"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_error_log_created").on(table.createdAt, table.id),
    index("idx_error_log_source_created").on(table.source, table.createdAt, table.id),
    index("idx_error_log_request").on(table.requestId),
    check("error_log_source_valid", sql`${table.source} IN ('request', 'scheduler', 'realtime', 'audit')`),
    check("error_log_level_valid", sql`${table.level} IN ('error', 'warn')`),
    check("error_log_message_bounded", sql`length(${table.message}) BETWEEN 1 AND 2000`),
    check("error_log_path_bounded", sql`${table.requestPath} IS NULL OR length(${table.requestPath}) BETWEEN 1 AND 2048`),
    check("error_log_method_bounded", sql`${table.requestMethod} IS NULL OR length(${table.requestMethod}) BETWEEN 1 AND 16`),
    check("error_log_request_bounded", sql`${table.requestId} IS NULL OR length(${table.requestId}) BETWEEN 1 AND 200`),
    check("error_log_stack_bounded", sql`${table.stack} IS NULL OR length(${table.stack}) BETWEEN 1 AND 4000`),
  ],
);
