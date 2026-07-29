import type { MemberProfile, User } from "@guild/shared";
import { isApiRequestError } from "./api/client";

export type RouteSession = {
  user: User;
  profile: MemberProfile;
};

type RouteSessionDependencies = {
  getCachedSession: () => RouteSession | null;
  requestSession: () => Promise<RouteSession>;
  setSession: (user: User, profile: MemberProfile) => void;
  clearSession: () => void;
  clearQueryCache: () => void;
};

export async function resolveRouteSession({
  getCachedSession,
  requestSession,
  setSession,
  clearSession,
  clearQueryCache,
}: RouteSessionDependencies): Promise<RouteSession | null> {
  const cached = getCachedSession();
  if (cached) return cached;

  try {
    const response = await requestSession();
    setSession(response.user, response.profile);
    return response;
  } catch (error) {
    if (!isApiRequestError(error) || error.status !== 401) {
      throw error;
    }
    clearSession();
    clearQueryCache();
    return null;
  }
}
