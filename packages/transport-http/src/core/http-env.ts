import type { RequestContext } from "@guild/kernel";
import type { Context } from "hono";

export type HttpEnv = {
  Variables: {
    requestContext: RequestContext;
    clientIdentifier: string;
  };
};

export function requestContext(context: Context<HttpEnv>): RequestContext {
  const value = context.get("requestContext");
  if (!value) throw new Error("RequestContext middleware is required");
  return value;
}

export function clientIdentifier(context: Context<HttpEnv>): string {
  const value = context.get("clientIdentifier");
  if (!value) throw new Error("Trusted client identifier middleware is required");
  return value;
}
