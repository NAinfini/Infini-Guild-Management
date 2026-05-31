// Domain: Error Log (Observability)
// Tables: error_log
// Dependencies: none
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nowUtc } from "./shared";

export const errorLog = sqliteTable(
  "error_log",
  {
    id: text("id").primaryKey().notNull(),
    source: text("source").notNull(),
    level: text("level").notNull().default("error"),
    message: text("message").notNull(),
    requestPath: text("request_path"),
    requestMethod: text("request_method"),
    requestId: text("request_id"),
    stack: text("stack"),
    context: text("context"),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxCreatedAt: index("idx_error_log_created_at").on(table.createdAt),
    idxSource: index("idx_error_log_source").on(table.source),
  }),
);
