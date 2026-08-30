// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./api/client";
import {
  createRouteSessionResolver,
  resolveRouteSession,
  type RouteSession,
} from "./router-session";

const session = {
  user: { id: "user-1", display_name: "member" },
  profile: { user_id: "user-1" },
} as RouteSession;

function createDeps(requestSession: () => Promise<RouteSession>) {
  return {
    getCachedSession: vi.fn(() => null),
    requestSession,
    transitionSession: vi.fn(),
  };
}

describe("resolveRouteSession", () => {
  it("clears local session state only for an authoritative 401", async () => {
    const deps = createDeps(vi.fn().mockRejectedValue(
      new ApiRequestError("expired", { status: 401 }),
    ));

    await expect(resolveRouteSession(deps)).resolves.toBeNull();

    expect(deps.transitionSession).toHaveBeenCalledOnce();
    expect(deps.transitionSession).toHaveBeenCalledWith(null);
  });

  it.each([0, 500, 503])("preserves state and rethrows status %s failures", async (status) => {
    const error = new ApiRequestError("temporary failure", { status });
    const deps = createDeps(vi.fn().mockRejectedValue(error));

    await expect(resolveRouteSession(deps)).rejects.toBe(error);

    expect(deps.transitionSession).not.toHaveBeenCalled();
  });

  it("uses a successful response to populate the auth store", async () => {
    const deps = createDeps(vi.fn().mockResolvedValue(session));

    await expect(resolveRouteSession(deps)).resolves.toBe(session);
    expect(deps.transitionSession).toHaveBeenCalledWith(session);
  });

  it("shares one anonymous probe between root and protected route resolution", async () => {
    let sessionResolved = false;
    const requestSession = vi.fn().mockRejectedValue(new ApiRequestError("expired", { status: 401 }));
    const deps = {
      ...createDeps(requestSession),
      isSessionResolved: () => sessionResolved,
      markSessionResolved: vi.fn(() => {
        sessionResolved = true;
      }),
    };
    const resolver = createRouteSessionResolver(deps);

    const rootResolution = resolver.resolve();
    const protectedResolution = resolver.resolve();

    expect(protectedResolution).toBe(rootResolution);
    await expect(Promise.all([rootResolution, protectedResolution])).resolves.toEqual([null, null]);
    expect(requestSession).toHaveBeenCalledOnce();
    await expect(resolver.resolve()).resolves.toBeNull();
    expect(requestSession).toHaveBeenCalledOnce();
  });
});
