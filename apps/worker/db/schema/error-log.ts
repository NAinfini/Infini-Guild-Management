// Domain: Error Log (Observability)
// Tables: error_log
// Dependencies: none
import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nowUtc } from "./shared";

export const errorLog = sqliteTable(
  "error_log",
  {
    id: text("id").primaryKey().notNull(),
    source: text("source", { enum: ["request", "cron", "push", "audit"] }).notNull(),
    level: text("level", { enum: ["error", "warn"] }).notNull().default("error"),
    message: text("message").notNull(),
    requestPath: text("request_path"),
    requestMethod: text("request_method"),
    requestId: text("request_id"),
    stack: text("stack"),
    context: text("context"),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxCreatedAt: index("idx_error_log_created_at").on(table.createdAt, table.id),
    idxSourceCreated: index("idx_error_log_source_created").on(table.source, table.createdAt, table.id),
    sourceValid: check("error_log_source_valid", sql`${table.source} IN ('request', 'cron', 'push', 'audit')`),
    levelValid: check("error_log_level_valid", sql`${table.level} IN ('error', 'warn')`),
    contextObject: check("error_log_context_object", sql`${table.context} IS NULL OR (json_valid(${table.context}) AND json_type(${table.context}) = 'object')`),
  }),
);
