import { AppError } from "@guild/kernel";
import type {
  ErrorLogEntry,
  ErrorLogRecord,
  ErrorLogSource,
  ErrorLogStore,
} from "@guild/server/modules/audit";
import type { SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";

const MAX_RETAINED_ERROR_LOGS = 5_000;
const ERROR_LOG_COLUMNS = [
  "id", "source", "level", "message", "request_path", "request_method", "request_id", "stack", "created_at",
] as const;

export class SqliteErrorLogStore implements ErrorLogStore {
  constructor(private readonly sql: SqlExecutor) {}

  async insert(record: ErrorLogRecord): Promise<void> {
    await this.sql.batch([
      {
        method: "run",
        sql: `INSERT INTO error_log
          (id, source, level, message, request_path, request_method, request_id, stack, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [record.id, record.source, record.level, record.message, record.requestPath,
          record.requestMethod, record.requestId, record.stack, record.createdAt],
      },
      {
        method: "run",
        sql: `DELETE FROM error_log WHERE id IN (
          SELECT id FROM error_log
          ORDER BY created_at DESC, id DESC
          LIMIT -1 OFFSET ?
        )`,
        params: [MAX_RETAINED_ERROR_LOGS],
      },
    ]);
  }

  async list(query: Readonly<{ source: ErrorLogSource | null; page: number; limit: number }>) {
    const where = query.source === null ? "" : "WHERE source = ?";
    const params: SqlValue[] = query.source === null ? [] : [query.source];
    const [countResult, listResult] = await this.sql.readBatch([
      {
        method: "get",
        columns: ["total"],
        sql: `SELECT COUNT(*) AS total FROM error_log ${where}`,
        params,
      },
      {
        method: "all",
        columns: ERROR_LOG_COLUMNS,
        sql: `SELECT id, source, level, message, request_path, request_method, request_id, stack, created_at
          FROM error_log ${where}
          ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        params: [...params, query.limit, (query.page - 1) * query.limit],
      },
    ]);
    const total = scalarCount(required(countResult));
    return {
      data: rows(required(listResult)).map(mapRow),
      total,
      page: query.page,
      limit: query.limit,
      total_pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }
}

function mapRow(row: readonly SqlValue[]): ErrorLogEntry {
  if (row.length !== 9) throw corrupt("Invalid error log row");
  const [id, source, level, message, requestPath, requestMethod, requestId, stack, createdAt] = row as readonly [
    SqlValue, SqlValue, SqlValue, SqlValue, SqlValue, SqlValue, SqlValue, SqlValue, SqlValue,
  ];
  if (typeof id !== "string" || !isSource(source) || (level !== "error" && level !== "warn")
    || typeof message !== "string" || !nullableString(requestPath) || !nullableString(requestMethod)
    || !nullableString(requestId) || !nullableString(stack) || typeof createdAt !== "string") {
    throw corrupt("Invalid error log row");
  }
  return { id, source, level, message, requestPath, requestMethod, requestId, stack, context: null, createdAt };
}

function isSource(value: SqlValue): value is ErrorLogSource {
  return value === "request" || value === "scheduler" || value === "realtime" || value === "audit";
}

function nullableString(value: SqlValue): value is string | null {
  return value === null || typeof value === "string";
}

function scalarCount(result: SqlResult): number {
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) {
    throw corrupt("Invalid error log count result");
  }
  const value = result.rows[0];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw corrupt("Invalid error log count");
  return value;
}

function rows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && !Array.isArray(result.rows[0]))) {
    throw corrupt("Invalid error log query result");
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function required(value: SqlResult | undefined): SqlResult {
  if (!value) throw corrupt("Missing error log query result");
  return value;
}

function corrupt(message: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message });
}
