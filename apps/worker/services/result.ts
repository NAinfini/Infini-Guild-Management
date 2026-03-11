import type { ErrorCode } from "@guild/shared";

export type ServiceOk<T> = { ok: true; data: T };
export type ServiceErr = { ok: false; code: ErrorCode; message: string; details?: unknown };
export type ServiceResult<T> = ServiceOk<T> | ServiceErr;

export function ok<T>(data: T): ServiceOk<T> {
  return { ok: true, data };
}

export function err(code: ErrorCode, message: string, details?: unknown): ServiceErr {
  return { ok: false, code, message, ...(details !== undefined ? { details } : {}) };
}
