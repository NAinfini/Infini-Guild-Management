export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "UPSTREAM_ERROR";

export type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

const ERROR_STATUS: Readonly<Record<ErrorCode, AppErrorStatus>> = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  UPSTREAM_ERROR: 503,
});

export type AppErrorOptions = {
  code: ErrorCode;
  status: AppErrorStatus;
  message: string;
  details?: unknown;
  cause?: unknown;
};

export type AppErrorBody = {
  error_code: ErrorCode;
  message: string;
  request_id: string;
  details?: unknown;
};

export class AppError extends Error {
  override readonly name = "AppError";
  readonly code: ErrorCode;
  readonly status: AppErrorStatus;
  readonly details?: unknown;

  constructor(options: AppErrorOptions) {
    const message = options.message.trim();
    if (!message) throw new TypeError("AppError message is required");
    if (ERROR_STATUS[options.code] !== options.status) {
      throw new TypeError(`${options.code} errors must use HTTP ${ERROR_STATUS[options.code]}`);
    }
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }

  toResponseBody(requestId: string): AppErrorBody {
    if (!requestId.trim()) throw new TypeError("requestId is required");
    return {
      error_code: this.code,
      message: this.message,
      request_id: requestId,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
