import { AppError } from "@guild/kernel";
import type { AbsencePolicy, AbsencePolicyReader } from "@guild/server/modules/members";
import type { SqlExecutor, SqlValue } from "@guild/kernel";

/** Reads the canonical site-config absence policy through the D1/SQLite executor. */
export class SqliteAbsencePolicyReader implements AbsencePolicyReader {
  constructor(private readonly sql: SqlExecutor) {}

  async readAbsencePolicy(): Promise<AbsencePolicy> {
    const result = await this.sql.execute({
      method: "get",
      sql: `SELECT absence_max_span_days, absence_max_entries_per_user
        FROM site_config WHERE singleton = 1 LIMIT 1`,
    });
    const row = result.rows;
    if (!Array.isArray(row) || (row.length > 0 && Array.isArray(row[0]))) throw corrupt();
    const [maxSpanDays, maxEntriesPerUser] = row as readonly SqlValue[];
    if (!positiveInteger(maxSpanDays) || !positiveInteger(maxEntriesPerUser)) throw corrupt();
    return { maxSpanDays, maxEntriesPerUser };
  }
}

function positiveInteger(value: SqlValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function corrupt(): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message: "Site absence policy is missing or invalid" });
}
