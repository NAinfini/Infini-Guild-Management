type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function emit(level: LogLevel, message: string, context?: LogContext, requestId?: string): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (requestId) entry.requestId = requestId;
  if (context) entry.context = context;
  console.log(JSON.stringify(entry));
}

export function createLogger(requestId?: string) {
  return {
    debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx, requestId),
    info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx, requestId),
    warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx, requestId),
    error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx, requestId),
  };
}

export const logger = createLogger();
