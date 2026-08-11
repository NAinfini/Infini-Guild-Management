import type { AuthorizationContext } from "./authorization.js";

export type RequestContext = Readonly<{
  requestId: string;
  authorization: AuthorizationContext;
  now: string;
  signal?: AbortSignal;
}>;

export type CreateRequestContextInput = {
  requestId: string;
  authorization: AuthorizationContext;
  now?: string | Date;
  signal?: AbortSignal;
};

function normalizeNow(value: string | Date | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("now must be a valid date");
  return date.toISOString();
}

export function createRequestContext(input: CreateRequestContextInput): RequestContext {
  const requestId = input.requestId.trim();
  if (!requestId) throw new TypeError("requestId is required");
  return Object.freeze({
    requestId,
    authorization: input.authorization,
    now: normalizeNow(input.now),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}
