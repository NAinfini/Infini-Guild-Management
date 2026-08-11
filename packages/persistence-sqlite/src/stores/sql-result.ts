import type { SqlResult, SqlRow } from "@guild/kernel";

export function returnedRows(result: SqlResult | undefined): readonly SqlRow[] {
  if (result?.rows === undefined || result.rows.length === 0) return [];
  return Array.isArray(result.rows[0])
    ? result.rows as readonly SqlRow[]
    : [result.rows as SqlRow];
}

export function returnedRowCount(result: SqlResult | undefined): number {
  return returnedRows(result).length;
}
