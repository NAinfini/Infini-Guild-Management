// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewingAsProvider } from "../context/ViewingAsContext";
import { useEffectivePermissions } from "./useEffectivePermissions";

const mocks = vi.hoisted(() => ({
  fetchRoles: vi.fn(() => new Promise(() => undefined)),
  user: {
    id: "admin-1",
    username: "admin",
    role: "admin",
    permissions: {
      "admin.users.view": true,
      "admin.siteConfig.manage": true,
      "admin.roles.view": true,
    },
    is_active: true,
    deleted_at: null,
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
  },
}));

vi.mock("../services/AdminService", () => ({
  fetchRoles: mocks.fetchRoles,
}));

vi.mock("../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: typeof mocks.user }) => unknown) => selector({ user: mocks.user }),
}));

function createWrapper(viewingAs = "admin"): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ViewingAsProvider value={viewingAs}>{children}</ViewingAsProvider>
      </QueryClientProvider>
    );
  };
}

describe("useEffectivePermissions", () => {
  beforeEach(() => {
    mocks.fetchRoles.mockClear();
    mocks.user.role = "admin";
    mocks.user.permissions["admin.users.view"] = true;
    mocks.user.permissions["admin.siteConfig.manage"] = true;
    mocks.user.permissions["admin.roles.view"] = true;
  });

  it("uses session permissions for the active role while role configuration is loading", () => {
    const { result } = renderHook(() => useEffectivePermissions(), { wrapper: createWrapper("admin") });

    expect(result.current.isModerator).toBe(true);
    expect(result.current.canManage(["admin.users.view"])).toBe(true);
    expect(result.current.canManage(["admin.siteConfig.manage"])).toBe(true);
    expect(result.current.canManage(["admin.audit.view"])).toBe(false);
  });

  it("does not apply session permissions while viewing as a different role", () => {
    const { result } = renderHook(() => useEffectivePermissions(), { wrapper: createWrapper("member") });

    expect(result.current.isModerator).toBe(false);
    expect(result.current.canManage(["admin.users.view"])).toBe(false);
  });

  it("uses session permissions without requesting roles when the user cannot view roles", () => {
    mocks.user.role = "member";
    mocks.user.permissions["admin.users.view"] = false;
    mocks.user.permissions["admin.siteConfig.manage"] = false;
    mocks.user.permissions["admin.roles.view"] = false;

    const { result } = renderHook(() => useEffectivePermissions(), { wrapper: createWrapper("member") });

    expect(mocks.fetchRoles).not.toHaveBeenCalled();
    expect(result.current.canManage(["admin.users.view"])).toBe(false);
    expect(result.current.isModerator).toBe(false);
  });
});
