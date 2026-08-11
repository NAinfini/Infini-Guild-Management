import { AppError, type RequestContext } from "@guild/kernel";
import type { PaginatedResponse } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";

export const ERROR_LOG_SOURCES = ["request", "scheduler", "realtime", "audit"] as const;
export type ErrorLogSource = (typeof ERROR_LOG_SOURCES)[number];

export type ErrorLogEntry = Readonly<{
  id: string;
  source: ErrorLogSource;
  level: "error" | "warn";
  message: string;
  requestPath: string | null;
  requestMethod: string | null;
  requestId: string | null;
  stack: string | null;
  context: null;
  createdAt: string;
}>;

export type ErrorLogRecord = Omit<ErrorLogEntry, "context">;

export interface ErrorLogStore {
  insert(record: ErrorLogRecord): Promise<void>;
  list(query: Readonly<{
    source: ErrorLogSource | null;
    page: number;
    limit: number;
  }>): Promise<PaginatedResponse<ErrorLogEntry>>;
}

export class ErrorLogService {
  constructor(private readonly store: ErrorLogStore) {}

  async recordUnexpected(input: Readonly<{
    error: Error;
    requestId: string;
    requestPath: string;
    requestMethod: string;
    createdAt: string;
  }>): Promise<void> {
    await this.store.insert({
      id: crypto.randomUUID(),
      source: "request",
      level: "error",
      message: bounded(input.error.message || input.error.name || "Unexpected error", 2_000),
      requestPath: nullableBounded(input.requestPath, 2_048),
      requestMethod: nullableBounded(input.requestMethod.toUpperCase(), 16),
      requestId: nullableBounded(input.requestId, 200),
      stack: nullableBounded(input.error.stack ?? null, 4_000),
      createdAt: input.createdAt,
    });
  }

  async list(
    context: RequestContext,
    query: Readonly<{ source: ErrorLogSource | null; page: number; limit: number }>,
  ): Promise<PaginatedResponse<ErrorLogEntry>> {
    context.authorization.require(PERMISSION_ID.ADMIN_STATUS_VIEW);
    if (!Number.isInteger(query.page) || query.page < 1 || query.page > 100) throw invalid("Invalid error log page");
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw invalid("Invalid error log limit");
    if (query.source !== null && !ERROR_LOG_SOURCES.includes(query.source)) throw invalid("Invalid error log source");
    return this.store.list(query);
  }
}

function bounded(value: string, length: number): string {
  const normalized = value.trim() || "Unexpected error";
  return normalized.slice(0, length);
}

function nullableBounded(value: string | null, length: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, length) : null;
}

function invalid(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}
