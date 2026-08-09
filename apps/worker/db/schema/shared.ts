// Domain: Shared Utilities
// Exports: nowUtc — ISO-8601 UTC timestamp default for all created_at/updated_at columns
import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export function canonicalUtcDateTime(column: AnySQLiteColumn) {
  return sql`length(${column}) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) IS NOT NULL AND ${column} = strftime('%Y-%m-%dT%H:%M:%fZ', ${column})`;
}

export function canonicalUtcDate(column: AnySQLiteColumn) {
  return sql`length(${column}) = 10 AND strftime('%Y-%m-%d', ${column}) IS NOT NULL AND ${column} = strftime('%Y-%m-%d', ${column})`;
}
