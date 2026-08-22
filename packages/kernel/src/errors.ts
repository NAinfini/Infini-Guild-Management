import {
  ERROR_STATUS,
  type ErrorCode,
  type StandardErrorResponse,
} from "@guild/shared/constants/errors";

/*
 * 错误码与状态码的对照表唯一定义在 @guild/shared（portal 只能依赖 shared）。
 * kernel 在此之上提供后端抛错载体 AppError，并复导出契约类型，
 * 让后端消费方从一个入口拿到抛错类与其公开字段的类型。
 */
export type { ErrorCode, StandardErrorResponse };

export type AppErrorStatus = (typeof ERROR_STATUS)[ErrorCode];

export type AppErrorOptions = {
  code: ErrorCode;
  status: AppErrorStatus;
  message: string;
  details?: unknown;
  cause?: unknown;
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

  toResponseBody(requestId: string): StandardErrorResponse {
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
