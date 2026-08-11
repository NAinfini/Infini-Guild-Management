import { AppError } from "@guild/kernel";
import type { MiddlewareHandler } from "hono";
import type { HttpEnv } from "./http-env.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type MutationSecurityOptions = Readonly<{
  allowedOrigins?: readonly string[];
  expectedOrigin?: string;
}>;

export function createMutationSecurityMiddleware(
  options: MutationSecurityOptions,
): MiddlewareHandler<HttpEnv> {
  const allowed = new Set([
    ...(options.allowedOrigins ?? []),
    ...(options.expectedOrigin === undefined ? [] : [options.expectedOrigin]),
  ].map(configuredOrigin));
  if (allowed.size === 0) throw new TypeError("At least one allowed mutation origin is required");

  return async (context, next) => {
    if (!MUTATION_METHODS.has(context.req.method)) return next();
    const origin = requestOrigin(context.req.header("Origin"));
    if (!origin || !allowed.has(origin)) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Mutation request origin is not allowed" });
    }
    if (context.req.header("X-Requested-With") !== "XMLHttpRequest") {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Mutation request marker is required" });
    }
    return next();
  };
}

function configuredOrigin(value: string): string {
  const normalized = requestOrigin(value);
  if (!normalized) throw new TypeError(`Invalid mutation origin: ${value}`);
  return normalized;
}

function requestOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.origin === "null" || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      ? null
      : url.origin;
  } catch {
    return null;
  }
}
