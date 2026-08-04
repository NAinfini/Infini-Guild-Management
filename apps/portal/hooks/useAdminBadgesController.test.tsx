// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../api/query-keys";
import { useAdminBadgesController } from "./useAdminBadgesController";

const serviceMocks = vi.hoisted(() => ({
  assignBadge: vi.fn(),
  createBadge: vi.fn(),
  deleteBadge: vi.fn(),
  fetchBadgeAssignments: vi.fn(),
  fetchBadges: vi.fn(),
  unassignBadge: vi.fn(),
  updateBadge: vi.fn(),
}));

vi.mock("../services/AdminService", () => serviceMocks);

vi.mock("../utils/notifications", () => ({
  notifySuccess: vi.fn(),
}));

vi.mock("./useAppError", () => ({
  useAppError: () => ({ showError: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const badge = {
  id: "badge-1",
  name: "Veteran",
  label_html: "Veteran",
  color: "#D4A843",
  description: null,
  sort_order: 0,
  created_at: "2026-08-03T00:00:00.000Z",
  updated_at: "2026-08-03T00:00:00.000Z",
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAdminBadgesController", () => {
  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) mock.mockReset();
    serviceMocks.fetchBadges.mockResolvedValue([]);
    serviceMocks.fetchBadgeAssignments.mockResolvedValue([]);
    serviceMocks.createBadge.mockResolvedValue(badge);
  });

  it("invalidates badges, users, and the infinite-stale current profile after a badge change", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAdminBadgesController(true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(serviceMocks.fetchBadges).toHaveBeenCalled());
    act(() => result.current.createBadge());

    await waitFor(() => expect(serviceMocks.createBadge).toHaveBeenCalled());
    await waitFor(() => {
      const invalidatedKeys = invalidateSpy.mock.calls.map(([filters]) => filters?.queryKey);
      expect(invalidatedKeys).toEqual(expect.arrayContaining([
        queryKeys.badges.all,
        queryKeys.users.all,
        queryKeys.myProfile.all,
      ]));
    });
  });
});
