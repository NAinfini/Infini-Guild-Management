import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStorageItems } from "./useStorage";

const serviceMocks = vi.hoisted(() => ({
  fetchStorageItems: vi.fn(),
}));

vi.mock("../services/StorageService", () => ({
  fetchStorageItem: vi.fn(),
  fetchStorageItems: serviceMocks.fetchStorageItems,
  fetchStorageTransactions: vi.fn(),
  fetchStorageTree: vi.fn(),
}));

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useStorageItems", () => {
  beforeEach(() => {
    serviceMocks.fetchStorageItems.mockReset();
  });

  it("appends cursor pages and exposes the next-page state", async () => {
    serviceMocks.fetchStorageItems.mockImplementation(({ cursor }: { cursor?: string }) =>
      Promise.resolve(cursor
        ? { data: [{ id: "item-2", name: "Second" }], next_cursor: null }
        : { data: [{ id: "item-1", name: "First" }], next_cursor: "cursor-2" }),
    );

    const { result } = renderHook(
      () => useStorageItems({
        storageId: "storage-1",
        categoryId: null,
        search: "",
        stock: "all",
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.items.map((item) => item.id)).toEqual(["item-1"]);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
    });
    expect(serviceMocks.fetchStorageItems).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: "cursor-2",
      stock: "all",
    }));
  });

  it("starts a separate first-page chain when a server-side filter changes", async () => {
    serviceMocks.fetchStorageItems.mockResolvedValue({ data: [], next_cursor: null });
    const { result, rerender } = renderHook(
      ({ stock }: { stock: "all" | "empty" }) => useStorageItems({
        storageId: "storage-1",
        categoryId: null,
        search: "crystal",
        stock,
      }),
      {
        initialProps: { stock: "all" as "all" | "empty" },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ stock: "empty" });
    await waitFor(() => expect(serviceMocks.fetchStorageItems).toHaveBeenCalledTimes(2));

    expect(serviceMocks.fetchStorageItems).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: undefined,
      search: "crystal",
      stock: "empty",
    }));
  });
});
