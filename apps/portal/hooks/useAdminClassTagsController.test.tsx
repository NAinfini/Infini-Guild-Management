import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { catalogRevisionToken } from "@guild/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useAdminClassTagsController } from "./useAdminClassTagsController";

const apiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  fetch: vi.fn(),
}));
const presentAppError = vi.hoisted(() => vi.fn());

vi.mock("../api/mutations/class-tags", () => ({
  createClassTag: apiMocks.create,
  updateClassTag: apiMocks.update,
  deleteClassTag: apiMocks.remove,
  reorderClassTags: apiMocks.reorder,
}));

vi.mock("../api/queries/class-tags", () => ({
  fetchClassTags: apiMocks.fetch,
}));

vi.mock("../utils/notifications", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("./useAppError", () => ({ presentAppError }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const tag = {
  id: "frontline",
  label: "Frontline",
  class_ids: ["warden"],
  sort_order: 0,
  usage_count: 1,
  created_at: "2026-07-29T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
};

function createWrapper(queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAdminClassTagsController", () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    presentAppError.mockReset();
  });

  it("refetches the tag catalog once after save and renders that response", async () => {
    const refreshed = [{ ...tag, label: "Core Frontline" }];
    apiMocks.fetch.mockResolvedValueOnce([tag]).mockResolvedValue(refreshed);
    apiMocks.update.mockResolvedValue(refreshed[0]);

    const { result } = renderHook(() => useAdminClassTagsController(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.draft.id).toBe("frontline"));

    act(() => result.current.save());

    await waitFor(() => {
      expect(result.current.savePending).toBe(false);
      expect(result.current.query.data?.[0]?.label).toBe("Core Frontline");
    });
    expect(apiMocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("opens a selected tag as an editable draft and clears dirty after an exact reversion", async () => {
    apiMocks.fetch.mockResolvedValue([tag]);
    const { result } = renderHook(() => useAdminClassTagsController(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.draft.id).toBe(tag.id));
    expect(result.current.opened).toBe(true);
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.toggleClass("mage"));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.toggleClass("mage"));
    expect(result.current.isDirty).toBe(false);
  });

  it("keeps the form-open tag revision when a dirty editor receives a background update", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    apiMocks.fetch.mockResolvedValue([tag]);
    const { result } = renderHook(() => useAdminClassTagsController(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.draft.id).toBe(tag.id));
    act(() => result.current.setDraft((current) => ({ ...current, label: "Unsaved Frontline" })));
    act(() => queryClient.setQueryData(queryKeys.classTags.list(), [{
      ...tag, label: "Remote Frontline", updated_at: "2026-07-29T00:00:01.000Z",
    }]));

    await waitFor(() => expect(result.current.query.data?.[0]?.label).toBe("Remote Frontline"));
    expect(result.current.draft.label).toBe("Unsaved Frontline");
    expect(result.current.draft.updatedAt).toBe(tag.updated_at);
  });

  it("routes a network save failure through the shared error presenter", async () => {
    const networkFailure = new ApiRequestError("Network unavailable", { status: 0 });
    apiMocks.fetch.mockResolvedValue([tag]);
    apiMocks.update.mockRejectedValue(networkFailure);
    const { result } = renderHook(() => useAdminClassTagsController(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.draft.id).toBe(tag.id));
    act(() => result.current.save());

    await waitFor(() => expect(result.current.savePending).toBe(false));
    expect(presentAppError).toHaveBeenCalledWith(networkFailure, "classTags.message.failed");
  });

  it("submits the pre-drag collection token and rolls the optimistic order back after a conflict", async () => {
    const second = { ...tag, id: "support", label: "Support", sort_order: 10 };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    apiMocks.fetch.mockResolvedValue([tag, second]);
    let rejectReorder: ((error: Error) => void) | undefined;
    apiMocks.reorder.mockReturnValue(new Promise((_, reject) => { rejectReorder = reject; }));
    const { result } = renderHook(() => useAdminClassTagsController(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.query.data).toHaveLength(2));
    act(() => result.current.reorder(second.id, tag.id));

    await waitFor(() => expect(apiMocks.reorder).toHaveBeenCalledWith(
      [second.id, tag.id], catalogRevisionToken([tag, second]),
    ));
    await waitFor(() => expect(result.current.query.data?.map((item) => item.id)).toEqual([second.id, tag.id]));
    const orderFailure = new Error("Class tag order is stale");
    await act(async () => { rejectReorder?.(orderFailure); });
    await waitFor(() => expect(result.current.query.data?.map((item) => item.id)).toEqual([tag.id, second.id]));
    expect(presentAppError).toHaveBeenCalledWith(orderFailure, "classTags.message.reorderFailed");
  });
});
