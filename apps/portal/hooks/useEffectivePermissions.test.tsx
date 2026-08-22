import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewingAsProvider } from "../context/ViewingAsContext";
import { useEffectivePermissions } from "./useEffectivePermissions";

const mocks = vi.hoisted(() => ({
  fetchRoles: vi.fn(),
  user: {
    id: "admin-1",
    username: "admin",
    role: "admin",
    role_name: "Guild Admin",
    role_color: "#ef4444",
    role_level: 999,
    permissions: {
      "admin.users.view": true,
      "admin.siteConfig.manage": true,
      "admin.roles.view": true,
      "admin.roles.manage": false,
    } as Record<string, boolean>,
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
    mocks.fetchRoles.mockResolvedValue([{
      id: "admin",
      name: "Guild Admin",
      level: 999,
      color: "#ef4444",
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      assigned_user_count: 1,
      permissions: {
        "admin.users.view": true,
        "admin.siteConfig.manage": true,
      },
    }]);
    mocks.user.role = "admin";
    mocks.user.permissions["admin.users.view"] = true;
    mocks.user.permissions["admin.siteConfig.manage"] = true;
    mocks.user.permissions["admin.roles.view"] = true;
    mocks.user.permissions["admin.roles.manage"] = false;
    mocks.user.permissions["admin.users.password"] = false;
    mocks.user.permissions["events.edit"] = false;
  });

  it("uses the D1-authoritative permissions embedded in the current session", () => {
    const { result } = renderHook(() => useEffectivePermissions(), { wrapper: createWrapper("admin") });

    expect(result.current.canManage(["admin.users.view"])).toBe(true);
    expect(result.current.isModerator).toBe(true);
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
    mocks.user.permissions["admin.roles.manage"] = false;
    mocks.user.permissions["events.edit"] = true;

    const { result } = renderHook(() => useEffectivePermissions(), { wrapper: createWrapper("member") });

    expect(mocks.fetchRoles).not.toHaveBeenCalled();
    expect(result.current.canManage(["events.edit"])).toBe(true);
    expect(result.current.isModerator).toBe(false);
  });

  it("loads D1 roles when manage permission is granted without view permission", async () => {
    mocks.user.permissions["admin.roles.view"] = false;
    mocks.user.permissions["admin.roles.manage"] = true;

    renderHook(() => useEffectivePermissions(), { wrapper: createWrapper("admin") });

    await waitFor(() => expect(mocks.fetchRoles).toHaveBeenCalledOnce());
  });

  it("recognizes a role with only an admin write permission as management-capable", () => {
    mocks.user.permissions["admin.users.view"] = false;
    mocks.user.permissions["admin.siteConfig.manage"] = false;
    mocks.user.permissions["admin.roles.view"] = false;
    mocks.user.permissions["admin.users.password"] = true;

    const { result } = renderHook(() => useEffectivePermissions(), { wrapper: createWrapper("admin") });

    expect(result.current.canManage(["admin.users.password"])).toBe(true);
    expect(result.current.isModerator).toBe(true);
  });
});
