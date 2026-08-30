import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { catalogRevisionToken } from "@guild/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useAdminBadgesController } from "./useAdminBadgesController";

const serviceMocks = vi.hoisted(() => ({
  assignBadge: vi.fn(),
  createBadge: vi.fn(),
  deleteBadge: vi.fn(),
  fetchBadgeAssignments: vi.fn(),
  fetchBadges: vi.fn(),
  reorderBadges: vi.fn(),
  unassignBadge: vi.fn(),
  updateBadge: vi.fn(),
}));
const showError = vi.hoisted(() => vi.fn());

vi.mock("../services/AdminService", () => serviceMocks);

vi.mock("../utils/notifications", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("./useAppError", () => ({
  useAppError: () => ({ showError }),
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

const secondBadge = { ...badge, id: "badge-2", name: "War Hero", label_html: "War Hero", sort_order: 1 };

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAdminBadgesController", () => {
  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) mock.mockReset();
    showError.mockReset();
    serviceMocks.fetchBadges.mockResolvedValue([]);
    serviceMocks.fetchBadgeAssignments.mockResolvedValue([]);
    serviceMocks.createBadge.mockResolvedValue(badge);
  });

  /*
   * 拖拽排序：整表提交，本地先按新顺序显示，请求失败要退回松手前那一份——
   * 不退回的话界面会一直显示一个服务端根本没接受的顺序。
   */
  it("shows the dragged order immediately and puts it back when the reorder is rejected", async () => {
    serviceMocks.fetchBadges.mockResolvedValue([badge, secondBadge]);
    const reordered = [{ ...secondBadge, sort_order: 0 }, { ...badge, sort_order: 10 }];
    serviceMocks.reorderBadges.mockResolvedValue(reordered);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAdminBadgesController(true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.badges).toHaveLength(2));
    act(() => result.current.reorderBadges(badge.id, secondBadge.id));

    await waitFor(() => expect(serviceMocks.reorderBadges, "带上去的是完整顺序，不是被拖的那一个")
      .toHaveBeenCalledWith(
        [secondBadge.id, badge.id],
        catalogRevisionToken([badge, secondBadge]),
      ));
    await waitFor(() => expect(result.current.badges.map((row) => row.id))
      .toEqual([secondBadge.id, badge.id]));

    const networkFailure = new ApiRequestError("Network unavailable", { status: 0 });
    serviceMocks.reorderBadges.mockRejectedValue(networkFailure);
    act(() => result.current.reorderBadges(secondBadge.id, badge.id));
    await waitFor(() => expect(
      queryClient.getQueryData(queryKeys.badges.list()),
      "请求被拒之后要回到松手前那份顺序",
    ).toEqual(reordered));
    expect(showError).toHaveBeenCalledWith(networkFailure, "badges.message.reorderFailed");
  });

  /* 进页面就落在第一枚上，右栏不该先摆一屏「选择一个徽章」。 */
  it("opens on the first badge and loads its assignments without a click", async () => {
    serviceMocks.fetchBadges.mockResolvedValue([badge, secondBadge]);
    const { result } = renderHook(() => useAdminBadgesController(true), {
      wrapper: createWrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });

    await waitFor(() => expect(result.current.selectedBadgeId).toBe(badge.id));
    expect(result.current.selectedBadge?.name).toBe(badge.name);
    await waitFor(() => expect(serviceMocks.fetchBadgeAssignments).toHaveBeenCalledWith(badge.id));
  });

  /* 新建时右栏是新建表单，兜底选中不能把它顶掉。 */
  it("leaves the detail pane to the create form instead of falling back to the first badge", async () => {
    serviceMocks.fetchBadges.mockResolvedValue([badge, secondBadge]);
    const { result } = renderHook(() => useAdminBadgesController(true), {
      wrapper: createWrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });

    await waitFor(() => expect(result.current.selectedBadgeId).toBe(badge.id));
    act(() => result.current.startCreate());

    expect(result.current.selectedBadgeId).toBeNull();
    expect(result.current.selectedBadge).toBeNull();

    act(() => result.current.discardChanges());
    await waitFor(() => expect(result.current.selectedBadgeId).toBe(badge.id));
  });

  /* 排序换的是顺序，不是「我在看哪一枚」。兜底只在落地那一次生效。 */
  it("keeps the auto-selected badge when a drag moves another one to the top", async () => {
    const reordered = [{ ...secondBadge, sort_order: 0 }, { ...badge, sort_order: 10 }];
    /* 重排落库后目录会被作废重拉，回来的就是新顺序——不这么桩，refetch 会把顺序拉回去。 */
    serviceMocks.fetchBadges
      .mockResolvedValueOnce([badge, secondBadge])
      .mockResolvedValue(reordered);
    serviceMocks.reorderBadges.mockResolvedValue(reordered);
    const { result } = renderHook(() => useAdminBadgesController(true), {
      wrapper: createWrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });

    await waitFor(() => expect(result.current.selectedBadgeId).toBe(badge.id));
    act(() => result.current.reorderBadges(badge.id, secondBadge.id));

    await waitFor(() => expect(result.current.badges[0]?.id).toBe(secondBadge.id));
    expect(result.current.selectedBadgeId).toBe(badge.id);
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

  it("sends null when an edited badge description is cleared", async () => {
    serviceMocks.fetchBadges.mockResolvedValue([{ ...badge, description: "Original description" }]);
    serviceMocks.updateBadge.mockResolvedValue(badge);
    const { result } = renderHook(() => useAdminBadgesController(true), {
      wrapper: createWrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });

    await waitFor(() => expect(result.current.selectedBadge).not.toBeNull());
    act(() => result.current.setForm((current) => ({ ...current, description: "" })));
    act(() => result.current.updateBadge(badge.id));

    await waitFor(() => expect(serviceMocks.updateBadge).toHaveBeenCalledWith(
      badge.id,
      expect.objectContaining({ description: null }),
    ));
  });

  it("uses one selected-badge baseline for fields and membership, clearing dirty after an exact reversion", async () => {
    serviceMocks.fetchBadges.mockResolvedValue([badge]);
    serviceMocks.fetchBadgeAssignments.mockResolvedValue([{ user_id: "user-1" }]);
    const { result } = renderHook(() => useAdminBadgesController(true), {
      wrapper: createWrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });

    await waitFor(() => expect(result.current.selectedBadgeId).toBe(badge.id));
    await waitFor(() => expect(result.current.draftMemberIds.has("user-1")).toBe(true));
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setForm((current) => ({ ...current, name: "Veteran Prime" })));
    expect(result.current.formDirty).toBe(true);
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.setForm((current) => ({ ...current, name: badge.name })));
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.toggleDraftMember("user-2"));
    expect(result.current.membershipDirty).toBe(true);
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.toggleDraftMember("user-2"));
    expect(result.current.membershipDirty).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it("keeps a dirty badge form and its original revision through a background catalog refresh", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    serviceMocks.fetchBadges.mockResolvedValue([badge]);
    serviceMocks.fetchBadgeAssignments.mockResolvedValue([]);
    serviceMocks.updateBadge.mockResolvedValue({ ...badge, name: "Unsaved Veteran" });
    const { result } = renderHook(() => useAdminBadgesController(true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.selectedBadgeId).toBe(badge.id));
    act(() => result.current.setForm((current) => ({ ...current, name: "Unsaved Veteran" })));
    act(() => queryClient.setQueryData(queryKeys.badges.list(), [{
      ...badge, name: "Remote Veteran", updated_at: "2026-08-03T00:00:01.000Z",
    }]));

    await waitFor(() => expect(result.current.badges[0]?.name).toBe("Remote Veteran"));
    expect(result.current.form.name).toBe("Unsaved Veteran");
    act(() => result.current.updateBadge(badge.id));
    await waitFor(() => expect(serviceMocks.updateBadge).toHaveBeenCalledWith(
      badge.id,
      expect.objectContaining({ expected_updated_at: badge.updated_at }),
    ));
  });
});
