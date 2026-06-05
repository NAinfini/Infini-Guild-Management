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
  const serialized = JSON.stringify(entry);
  if (level === "debug") console.debug(serialized);
  else if (level === "warn") console.warn(serialized);
  else if (level === "error") console.error(serialized);
  else console.log(serialized);
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
