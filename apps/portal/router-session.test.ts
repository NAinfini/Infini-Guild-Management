import type { MemberProfile, User } from "@guild/shared";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./api/client";
import { createRouteSessionResolver } from "./router-session";
import { getSessionSnapshot, resolveSessionSnapshot, transitionSession, type PortalSession } from "./session-transition";
import { useAuthStore } from "./stores/auth";
import { deferred } from "./testing/deferred";

const session: PortalSession = {
  user: { id: "user-1", display_name: "member" } as User,
  profile: { user_id: "user-1" } as MemberProfile,
  session_scope: "normal",
};

function createResolver(queryClient: QueryClient, requestSession: () => Promise<PortalSession>) {
  return createRouteSessionResolver({
    getCachedSession: getSessionSnapshot,
    requestSession: () => resolveSessionSnapshot(queryClient, requestSession, { broadcast: false }),
    isSessionResolved: () => useAuthStore.getState().sessionResolved,
    markSessionResolved: () => useAuthStore.getState().markSessionResolved(),
  });
}

describe("route session resolution", () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession();
    useAuthStore.setState({ sessionResolved: false });
  });

  it("shares one anonymous probe between root and protected routes", async () => {
    const requestSession = vi.fn().mockRejectedValue(new ApiRequestError("expired", { status: 401 }));
    const resolver = createResolver(new QueryClient(), requestSession);
    const root = resolver.resolve();
    const protectedRoute = resolver.resolve();
    expect(protectedRoute).toBe(root);
    await expect(Promise.all([root, protectedRoute])).resolves.toEqual([null, null]);
    await expect(resolver.resolve()).resolves.toBeNull();
    expect(requestSession).toHaveBeenCalledOnce();
  });

  it("populates the auth store from the first successful probe", async () => {
    const resolver = createResolver(new QueryClient(), async () => session);
    await expect(resolver.resolve()).resolves.toEqual(session);
    expect(getSessionSnapshot()).toEqual(session);
  });

  it.each(["success", "error"])("returns the current session when the initial probe has a stale %s", async (completion) => {
    const queryClient = new QueryClient();
    const pending = deferred<PortalSession>();
    const resolver = createResolver(queryClient, () => pending.promise);
    const initial = resolver.resolve();
    transitionSession(queryClient, session, { broadcast: false });
    if (completion === "success") pending.resolve({ ...session, user: { ...session.user, id: "old-user" } });
    else pending.reject(new ApiRequestError("expired", { status: 401 }));
    await expect(initial).resolves.toEqual(session);
  });

  it("keeps a route anonymous after logout while its initial probe is pending", async () => {
    const queryClient = new QueryClient();
    const pending = deferred<PortalSession>();
    const resolver = createResolver(queryClient, () => pending.promise);
    const initial = resolver.resolve();
    transitionSession(queryClient, null, { broadcast: false });
    pending.resolve(session);
    await expect(initial).resolves.toBeNull();
    await expect(resolver.resolve()).resolves.toBeNull();
  });

  it("allows retry after a temporary initial failure", async () => {
    const requestSession = vi.fn().mockRejectedValueOnce(new ApiRequestError("unavailable", { status: 503 })).mockResolvedValueOnce(session);
    const resolver = createResolver(new QueryClient(), requestSession);
    await expect(resolver.resolve()).rejects.toMatchObject({ status: 503 });
    expect(useAuthStore.getState().sessionResolved).toBe(false);
    await expect(resolver.resolve()).resolves.toEqual(session);
  });
});
