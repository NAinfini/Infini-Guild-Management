import type { MemberProfile, User } from "@guild/shared";
import { isApiRequestError } from "./api/client";

export type RouteSession = {
  user: User;
  profile: MemberProfile;
  session_scope: "normal" | "password_change";
};

type RouteSessionDependencies = {
  getCachedSession: () => RouteSession | null;
  requestSession: () => Promise<RouteSession>;
  transitionSession: (session: RouteSession | null) => void;
};

type RouteSessionResolverDependencies = RouteSessionDependencies & {
  isSessionResolved: () => boolean;
  markSessionResolved: () => void;
};

export type RouteSessionResolver = {
  resolve: () => Promise<RouteSession | null>;
};

export async function resolveRouteSession({
  getCachedSession,
  requestSession,
  transitionSession,
}: RouteSessionDependencies): Promise<RouteSession | null> {
  const cached = getCachedSession();
  if (cached) return cached;

  try {
    const response = await requestSession();
    transitionSession(response);
    return response;
  } catch (error) {
    if (!isApiRequestError(error) || error.status !== 401) {
      throw error;
    }
    transitionSession(null);
    return null;
  }
}

export function createRouteSessionResolver(
  dependencies: RouteSessionResolverDependencies,
): RouteSessionResolver {
  let inFlight: Promise<RouteSession | null> | null = null;

  return {
    resolve: () => {
      const cached = dependencies.getCachedSession();
      if (cached) {
        if (!dependencies.isSessionResolved()) dependencies.markSessionResolved();
        return Promise.resolve(cached);
      }
      if (dependencies.isSessionResolved()) {
        return Promise.resolve(null);
      }
      inFlight ??= resolveRouteSession(dependencies)
        .then((session) => {
          if (!dependencies.isSessionResolved()) dependencies.markSessionResolved();
          return session;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
