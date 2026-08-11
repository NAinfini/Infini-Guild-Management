import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const appMigrations = sqliteTable(
  "app_migrations",
  {
    id: text("id").primaryKey(),
    ordinal: integer("ordinal").notNull().unique(),
    checksum: text("checksum").notNull(),
    appliedAt: text("applied_at").notNull().default(nowUtc),
  },
  (table) => [
    check("app_migrations_id_valid", sql`length(${table.id}) > 0`),
    check("app_migrations_ordinal_valid", sql`${table.ordinal} >= 0`),
    check(
      "app_migrations_checksum_valid",
      sql`length(${table.checksum}) = 64 AND ${table.checksum} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);
