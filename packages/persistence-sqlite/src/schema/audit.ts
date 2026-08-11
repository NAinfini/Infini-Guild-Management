import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@guild/shared/constants/audit";
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const enumValues = (items: readonly string[]) => sql.raw(items.map((item) => `'${item}'`).join(", "));

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorUsername: text("actor_username"),
    entityType: text("entity_type", { enum: AUDIT_ENTITY_TYPES }).notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action", { enum: AUDIT_ACTIONS }).notNull(),
    summary: text("summary"),
    detailJson: text("detail_json"),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    index("idx_audit_log_occurred").on(table.occurredAt, table.id),
    index("idx_audit_log_actor_occurred").on(table.actorUserId, table.occurredAt, table.id),
    index("idx_audit_log_entity_occurred").on(table.entityType, table.occurredAt, table.id),
    index("idx_audit_log_target_occurred").on(table.entityType, table.entityId, table.occurredAt, table.id),
    index("idx_audit_log_request").on(table.requestId),
    check("audit_log_entity_type_valid", sql`${table.entityType} IN (${enumValues(AUDIT_ENTITY_TYPES)})`),
    check("audit_log_action_valid", sql`${table.action} IN (${enumValues(AUDIT_ACTIONS)})`),
    check("audit_log_entity_id_present", sql`length(trim(${table.entityId})) > 0`),
    check("audit_log_request_id_present", sql`length(trim(${table.requestId})) > 0`),
    check("audit_log_summary_bounded", sql`${table.summary} IS NULL OR length(${table.summary}) BETWEEN 1 AND 200`),
    check(
      "audit_log_detail_object",
      sql`${table.detailJson} IS NULL OR (json_valid(${table.detailJson}) AND json_type(${table.detailJson}) = 'object' AND length(${table.detailJson}) <= 16384)`,
    ),
  ],
);

export const auditArchives = sqliteTable(
  "audit_archives",
  {
    id: text("id").primaryKey(),
    month: text("month").notNull(),
    status: text("status", { enum: ["pending", "ready"] }).notNull(),
    objectKey: text("object_key").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("ux_audit_archives_object_key").on(table.objectKey),
    uniqueIndex("ux_audit_archives_one_pending")
      .on(table.status)
      .where(sql`${table.status} = 'pending'`),
    index("idx_audit_archives_month_ready").on(table.month, table.status, table.createdAt, table.id),
    check("audit_archives_id_present", sql`length(trim(${table.id})) BETWEEN 1 AND 64`),
    check("audit_archives_month_valid", sql`${table.month} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'`),
    check("audit_archives_status_valid", sql`${table.status} IN ('pending', 'ready')`),
    check("audit_archives_object_key_valid", sql`${table.objectKey} GLOB 'audit/[0-9][0-9][0-9][0-9]/[0-9][0-9]/*.ndjson'`),
    check("audit_archives_row_count_valid", sql`${table.rowCount} BETWEEN 0 AND 100`),
    check(
      "audit_archives_state_consistent",
      sql`(
        ${table.status} = 'pending'
        AND ${table.sizeBytes} IS NULL
        AND ${table.sha256} IS NULL
        AND ${table.completedAt} IS NULL
        AND ${table.leaseToken} IS NOT NULL
        AND ${table.leaseExpiresAt} IS NOT NULL
      ) OR (
        ${table.status} = 'ready'
        AND ${table.rowCount} > 0
        AND ${table.startsAt} IS NOT NULL
        AND ${table.endsAt} IS NOT NULL
        AND ${table.sizeBytes} > 0
        AND length(${table.sha256}) = 64
        AND ${table.sha256} NOT GLOB '*[^0-9a-f]*'
        AND ${table.completedAt} IS NOT NULL
        AND ${table.leaseToken} IS NULL
        AND ${table.leaseExpiresAt} IS NULL
      )`,
    ),
  ],
);

export const auditArchiveItems = sqliteTable(
  "audit_archive_items",
  {
    archiveId: text("archive_id").notNull().references(() => auditArchives.id, { onDelete: "cascade" }),
    auditId: text("audit_id").notNull().references(() => auditLog.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ name: "pk_audit_archive_items", columns: [table.archiveId, table.auditId] }),
    uniqueIndex("ux_audit_archive_items_audit").on(table.auditId),
    uniqueIndex("ux_audit_archive_items_position").on(table.archiveId, table.position),
    check("audit_archive_items_position_valid", sql`${table.position} BETWEEN 0 AND 99`),
  ],
);
