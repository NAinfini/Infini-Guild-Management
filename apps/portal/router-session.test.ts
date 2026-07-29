import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./api/client";
import { resolveRouteSession, type RouteSession } from "./router-session";

const session = {
  user: { id: "user-1", username: "member" },
  profile: { id: "profile-1", user_id: "user-1" },
} as RouteSession;

function createDeps(requestSession: () => Promise<RouteSession>) {
  return {
    getCachedSession: vi.fn(() => null),
    requestSession,
    setSession: vi.fn(),
    clearSession: vi.fn(),
    clearQueryCache: vi.fn(),
  };
}

describe("resolveRouteSession", () => {
  it("clears local session state only for an authoritative 401", async () => {
    const deps = createDeps(vi.fn().mockRejectedValue(
      new ApiRequestError("expired", { status: 401 }),
    ));

    await expect(resolveRouteSession(deps)).resolves.toBeNull();

    expect(deps.clearSession).toHaveBeenCalledOnce();
    expect(deps.clearQueryCache).toHaveBeenCalledOnce();
  });

  it.each([0, 500, 503])("preserves state and rethrows status %s failures", async (status) => {
    const error = new ApiRequestError("temporary failure", { status });
    const deps = createDeps(vi.fn().mockRejectedValue(error));

    await expect(resolveRouteSession(deps)).rejects.toBe(error);

    expect(deps.clearSession).not.toHaveBeenCalled();
    expect(deps.clearQueryCache).not.toHaveBeenCalled();
  });

  it("uses a successful response to populate the auth store", async () => {
    const deps = createDeps(vi.fn().mockResolvedValue(session));

    await expect(resolveRouteSession(deps)).resolves.toBe(session);
    expect(deps.setSession).toHaveBeenCalledWith(session.user, session.profile);
  });
});
