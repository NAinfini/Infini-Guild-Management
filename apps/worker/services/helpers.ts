import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Emits `column LIKE pattern ESCAPE '\'` so backslash escapes produced by
 * `escapeLikePattern` are honoured. Drizzle's bare `like()` omits the ESCAPE
 * clause, which makes those backslashes match literally — use this instead.
 */
export function likeEscaped(column: SQLWrapper, pattern: string): SQL<unknown> {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

export function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

export function parseRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
