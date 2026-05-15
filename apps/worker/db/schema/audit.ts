// Domain: Audit Log
// Tables: audit_log
// Dependencies: auth.users
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    action: text("action").notNull(),
    actorId: text("actor_id").notNull().references(() => users.id),
    entityId: text("entity_id").notNull(),
    diffTitle: text("diff_title"),
    detailText: text("detail_text"),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxCreatedAt: index("idx_audit_log_created_at").on(table.createdAt),
    idxEntityActorCreated: index("idx_audit_log_entity_actor_created").on(table.entityType, table.actorId, table.createdAt),
    idxEntityCreated: index("idx_audit_log_entity_created").on(table.entityType, table.createdAt, table.id),
    idxActorId: index("idx_audit_log_actor_id").on(table.actorId),
    idxActorCreated: index("idx_audit_log_actor_created").on(table.actorId, table.createdAt, table.id),
  }),
);
