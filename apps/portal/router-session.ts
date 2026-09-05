import type { PortalSession } from "./session-transition";

type RouteSessionResolverDependencies = {
  getCachedSession: () => PortalSession | null;
  requestSession: () => Promise<PortalSession | null>;
  isSessionResolved: () => boolean;
  markSessionResolved: () => void;
};

export type RouteSessionResolver = {
  resolve: () => Promise<PortalSession | null>;
};

export function createRouteSessionResolver(
  dependencies: RouteSessionResolverDependencies,
): RouteSessionResolver {
  let inFlight: Promise<PortalSession | null> | null = null;

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
      inFlight ??= dependencies.requestSession()
        .then(() => {
          if (!dependencies.isSessionResolved()) dependencies.markSessionResolved();
          return dependencies.getCachedSession();
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
