import type { MemberProfile, User } from "@guild/shared";
import { isApiRequestError } from "./api/client";

export type RouteSession = {
  user: User;
  profile: MemberProfile;
};

type RouteSessionDependencies = {
  getCachedSession: () => RouteSession | null;
  requestSession: () => Promise<RouteSession>;
  transitionSession: (session: RouteSession | null) => void;
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
