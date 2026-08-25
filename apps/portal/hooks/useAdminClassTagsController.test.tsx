import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminClassTagsController } from "./useAdminClassTagsController";

const apiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  fetch: vi.fn(),
}));

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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAdminClassTagsController", () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
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
});
