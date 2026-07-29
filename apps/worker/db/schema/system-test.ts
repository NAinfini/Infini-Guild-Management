// Domain: Admin system-test run registry
// Tables: system_test_runs, system_test_artifacts
// Dependencies: auth.users
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const systemTestRuns = sqliteTable(
  "system_test_runs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull().references(() => users.id),
    status: text("status").notNull().default("running"),
    activeRequests: integer("active_requests").notNull().default(0),
    cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
    completedAt: text("completed_at"),
  },
  (table) => ({
    statusValid: check(
      "system_test_runs_status_valid",
      sql`${table.status} IN ('running', 'cleaning', 'cleanup_failed', 'completed', 'manual_review')`,
    ),
    activeRequestsNonnegative: check(
      "system_test_runs_active_requests_nonnegative",
      sql`${table.activeRequests} >= 0`,
    ),
    idxCleanupLookup: index("idx_system_test_runs_cleanup_lookup").on(table.status, table.updatedAt, table.id),
  }),
);

export const systemTestArtifacts = sqliteTable(
  "system_test_artifacts",
  {
    runId: text("run_id").notNull().references(() => systemTestRuns.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type").notNull(),
    artifactKey: text("artifact_key").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.runId, table.artifactType, table.artifactKey] }),
    idxRunType: index("idx_system_test_artifacts_run_type").on(table.runId, table.artifactType),
  }),
);
