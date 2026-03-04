// Domain: Shared Utilities
// Exports: nowUtc — ISO-8601 UTC timestamp default for all created_at/updated_at columns
import { sql } from "drizzle-orm";

export const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
