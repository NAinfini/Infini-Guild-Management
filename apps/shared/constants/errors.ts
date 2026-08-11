export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  UPSTREAM_ERROR: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export type StandardErrorResponse = {
  error_code: ErrorCode;
  message: string;
  request_id: string;
  details?: unknown;
};
