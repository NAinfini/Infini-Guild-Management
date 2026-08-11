import type { RequestContext } from "@guild/kernel";
import type { MiddlewareHandler } from "hono";
import type { HttpEnv } from "./http-env.js";

export type RequestContextResolver = (request: Request) => RequestContext | Promise<RequestContext>;

export function createRequestContextMiddleware(resolve: RequestContextResolver): MiddlewareHandler<HttpEnv> {
  return async (context, next) => {
    const request = await resolve(context.req.raw);
    context.set("requestContext", request);
    await next();
    context.header("X-Request-Id", request.requestId);
  };
}
