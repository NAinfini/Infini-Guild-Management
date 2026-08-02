// @vitest-environment jsdom
import type { Storage, StorageItem } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageInventoryPanel } from "./StorageInventoryPanel";

const hookMocks = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  useStorageItems: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../hooks/useStorage", () => ({
  useStorageItems: hookMocks.useStorageItems,
}));

vi.mock("./StorageItemCard", () => ({
  StorageItemCard: ({ item }: { item: StorageItem }) => <div>{item.name}</div>,
}));

const storage: Storage = {
  id: "storage-1",
  name: "Vault",
  description: null,
  created_at: "2026-07-28T00:00:00.000Z",
  categories: [{ id: "category-1", name: "Materials" }],
};

const item: StorageItem = {
  id: "item-1",
  storage_id: storage.id,
  category_id: null,
  name: "Crystal",
  description: null,
  quantity: 10,
  allow_member_deposit: true,
  allow_member_withdraw: true,
  images: [],
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

function renderPanel() {
  render(
    <MantineProvider>
      <StorageInventoryPanel
        storage={storage}
        canManageItems={false}
        canManageStock={false}
        hasAnyItems
        onStartBatch={vi.fn()}
        onBatchQuantityChange={vi.fn()}
        onOpenItem={vi.fn()}
        onEditItem={vi.fn()}
        onOpenTransaction={vi.fn()}
      />
    </MantineProvider>,
  );
}

describe("StorageInventoryPanel pagination", () => {
  beforeEach(() => {
    hookMocks.fetchNextPage.mockReset();
    hookMocks.useStorageItems.mockReset();
    hookMocks.useStorageItems.mockReturnValue({
      items: [item],
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: true,
      fetchNextPage: hookMocks.fetchNextPage,
    });
  });

  it("loads the next server page from an explicit action", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByText("Crystal")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "action.loadMore" }));

    expect(hookMocks.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(hookMocks.useStorageItems).toHaveBeenCalledWith(expect.objectContaining({
      storageId: storage.id,
      stock: "all",
    }));
  });

  it("sends the stock filter to the server query", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("combobox", { name: "field.stock" }));
    fireEvent.click(screen.getByText("filter.empty"));

    expect(hookMocks.useStorageItems).toHaveBeenLastCalledWith(expect.objectContaining({
      stock: "empty",
    }));
  });

  it("uses the category rail as inventory navigation", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Materials" }));

    expect(hookMocks.useStorageItems).toHaveBeenLastCalledWith(expect.objectContaining({
      categoryId: "category-1",
    }));
  });
});
