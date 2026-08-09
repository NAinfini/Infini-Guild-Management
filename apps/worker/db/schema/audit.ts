// Domain: Audit Log
// Tables: audit_log
// Dependencies: auth.users
import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@guild/shared/constants/audit";
import { users } from "./auth";
import { nowUtc } from "./shared";

const AUDIT_ENTITY_TYPE_IDS = AUDIT_ENTITY_TYPES as unknown as [string, ...string[]];
const AUDIT_ACTION_IDS = AUDIT_ACTIONS as unknown as [string, ...string[]];
const AUDIT_ENTITY_TYPE_VALUES = sql.raw(AUDIT_ENTITY_TYPES.map((value) => `'${value}'`).join(", "));
const AUDIT_ACTION_VALUES = sql.raw(AUDIT_ACTIONS.map((value) => `'${value}'`).join(", "));

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type", { enum: AUDIT_ENTITY_TYPE_IDS }).notNull(),
    action: text("action", { enum: AUDIT_ACTION_IDS }).notNull(),
    actorId: text("actor_id").notNull().references(() => users.id),
    entityId: text("entity_id").notNull(),
    diffTitle: text("diff_title"),
    detailText: text("detail_text"),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxCreatedAt: index("idx_audit_log_created_at").on(table.createdAt, table.id),
    idxEntityActorCreated: index("idx_audit_log_entity_actor_created").on(table.entityType, table.actorId, table.createdAt, table.id),
    idxEntityCreated: index("idx_audit_log_entity_created").on(table.entityType, table.createdAt, table.id),
    idxActorCreated: index("idx_audit_log_actor_created").on(table.actorId, table.createdAt, table.id),
    entityTypeValid: check("audit_log_entity_type_valid", sql`${table.entityType} IN (${AUDIT_ENTITY_TYPE_VALUES})`),
    actionValid: check("audit_log_action_valid", sql`${table.action} IN (${AUDIT_ACTION_VALUES})`),
    detailObject: check("audit_log_detail_object", sql`${table.detailText} IS NULL OR (json_valid(${table.detailText}) AND json_type(${table.detailText}) = 'object')`),
  }),
);
