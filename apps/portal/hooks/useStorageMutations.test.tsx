import type { StorageItem, StorageTransaction } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../api/query-keys";
import { useStorageMutations } from "./useStorageMutations";

const service = vi.hoisted(() => ({
  createStorage: vi.fn(), updateStorage: vi.fn(), deleteStorage: vi.fn(),
  createStorageCategory: vi.fn(), updateStorageCategory: vi.fn(), deleteStorageCategory: vi.fn(),
  createStorageItem: vi.fn(), updateStorageItem: vi.fn(), deleteStorageItem: vi.fn(),
  uploadStorageItemImages: vi.fn(), deleteStorageItemImage: vi.fn(),
  createStorageTransaction: vi.fn(), createStorageBatchTransaction: vi.fn(),
}));
vi.mock("../services/StorageService", () => service);
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../utils/notifications", () => ({ notifySuccess: vi.fn() }));
vi.mock("./useAppError", () => ({ presentAppError: vi.fn() }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useStorageMutations(), { wrapper }) };
}

describe("useStorageMutations cache lifecycle", () => {
  it("updates one item detail and invalidates item lists without resetting all storage queries", async () => {
    const item = { id: "item-1", name: "Updated" } as StorageItem;
    service.updateStorageItem.mockResolvedValue(item);
    const { client, result } = setup();
    const resetSpy = vi.spyOn(client, "resetQueries");
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await result.current.updateItemMutation.mutateAsync({
      id: "item-1",
      payload: { name: "Updated", expected_updated_at: "2026-08-09T00:00:00.000Z" },
    });

    expect(client.getQueryData(queryKeys.storage.item("item-1"))).toBe(item);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.storage.itemsRoot() });
  });

  it("invalidates only the affected item, item lists, and transaction lists after a transaction", async () => {
    service.createStorageTransaction.mockResolvedValue({ item_id: "item-1", quantity_delta: 2 } as StorageTransaction);
    const { client, result } = setup();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await result.current.createTransactionMutation.mutateAsync({
      itemId: "item-1",
      payload: { idempotency_key: "mutation-stock-0001", type: "intake", quantity: 2 },
    });

    const keys = invalidateSpy.mock.calls.flatMap(([filters]) => filters?.queryKey ? [filters.queryKey] : []);
    expect(keys).toContainEqual(queryKeys.storage.item("item-1"));
    expect(keys).toContainEqual(queryKeys.storage.itemsRoot());
    expect(keys).toContainEqual([...queryKeys.storage.all, "transactions"]);
    expect(keys).not.toContainEqual(queryKeys.storage.all);
  });
});
