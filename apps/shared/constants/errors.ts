/*
 * 全栈唯一的错误码→HTTP 状态对照表。portal 依据它解析响应，
 * kernel 的 AppError 依据它校验抛错状态，两端不允许各自维护副本。
 * freeze 保证运行时不可被任何一侧就地改写。
 */
export const ERROR_STATUS = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  UPSTREAM_ERROR: 503,
} as const);

export type ErrorCode = keyof typeof ERROR_STATUS;

export type StandardErrorResponse = {
  error_code: ErrorCode;
  message: string;
  request_id: string;
  details?: unknown;
};
