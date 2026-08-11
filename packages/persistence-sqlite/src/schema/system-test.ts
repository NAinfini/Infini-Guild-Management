import { SYSTEM_TEST_ARTIFACT_TYPES } from "@guild/shared/schemas/system-test";
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const values = (items: readonly string[]) => sql.raw(items.map((item) => `'${item}'`).join(", "));

export const SYSTEM_TEST_BEFORE_IMAGE_TYPES = ["class_catalog", "class_tag", "badge"] as const;

export const systemTestRuns = sqliteTable(
  "system_test_runs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["running", "cleaning", "cleanup_failed", "completed"] }).notNull().default("running"),
    cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
    lastError: text("last_error"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_system_test_runs_actor").on(table.actorUserId, table.createdAt, table.id),
    index("idx_system_test_runs_expiry").on(table.status, table.expiresAt, table.id),
    check("system_test_runs_status_valid", sql`${table.status} IN ('running', 'cleaning', 'cleanup_failed', 'completed')`),
    check("system_test_runs_attempts_nonnegative", sql`${table.cleanupAttempts} >= 0`),
    check("system_test_runs_interval_valid", sql`${table.createdAt} < ${table.expiresAt}`),
    check("system_test_runs_error_bounded", sql`${table.lastError} IS NULL OR length(${table.lastError}) BETWEEN 1 AND 1000`),
    check(
      "system_test_runs_completion_consistent",
      sql`(${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL) OR (${table.status} <> 'completed' AND ${table.completedAt} IS NULL)`,
    ),
  ],
);

export const systemTestRequests = sqliteTable(
  "system_test_requests",
  {
    requestId: text("request_id").primaryKey(),
    runId: text("run_id").notNull().references(() => systemTestRuns.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    startedAt: text("started_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_system_test_requests_run").on(table.runId, table.startedAt, table.requestId),
    check("system_test_requests_id_present", sql`length(trim(${table.requestId})) BETWEEN 1 AND 200`),
  ],
);

export const systemTestArtifacts = sqliteTable(
  "system_test_artifacts",
  {
    runId: text("run_id").notNull().references(() => systemTestRuns.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type", { enum: SYSTEM_TEST_ARTIFACT_TYPES }).notNull(),
    artifactKey: text("artifact_key").notNull(),
    requestId: text("request_id").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    primaryKey({ name: "pk_system_test_artifacts", columns: [table.runId, table.artifactType, table.artifactKey] }),
    index("idx_system_test_artifacts_cleanup").on(table.runId, table.artifactType, table.artifactKey),
    check("system_test_artifacts_type_valid", sql`${table.artifactType} IN (${values(SYSTEM_TEST_ARTIFACT_TYPES)})`),
    check("system_test_artifacts_key_present", sql`length(trim(${table.artifactKey})) BETWEEN 1 AND 500`),
    check("system_test_artifacts_request_present", sql`length(trim(${table.requestId})) BETWEEN 1 AND 200`),
  ],
);

export const systemTestBeforeImages = sqliteTable(
  "system_test_before_images",
  {
    runId: text("run_id").notNull().references(() => systemTestRuns.id, { onDelete: "cascade" }),
    targetType: text("target_type", { enum: SYSTEM_TEST_BEFORE_IMAGE_TYPES }).notNull(),
    targetId: text("target_id").notNull(),
    beforeSortOrder: integer("before_sort_order").notNull(),
    beforeUpdatedAt: text("before_updated_at").notNull(),
    expectedSortOrder: integer("expected_sort_order").notNull(),
    expectedUpdatedAt: text("expected_updated_at").notNull(),
    requestId: text("request_id").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    primaryKey({ name: "pk_system_test_before_images", columns: [table.runId, table.targetType, table.targetId] }),
    index("idx_system_test_before_images_cleanup").on(table.runId, table.targetType, table.targetId),
    check("system_test_before_images_type_valid", sql`${table.targetType} IN (${values(SYSTEM_TEST_BEFORE_IMAGE_TYPES)})`),
    check("system_test_before_images_target_present", sql`length(trim(${table.targetId})) BETWEEN 1 AND 200`),
    check("system_test_before_images_request_present", sql`length(trim(${table.requestId})) BETWEEN 1 AND 200`),
    check("system_test_before_images_sort_nonnegative", sql`${table.beforeSortOrder} >= 0 AND ${table.expectedSortOrder} >= 0`),
  ],
);
