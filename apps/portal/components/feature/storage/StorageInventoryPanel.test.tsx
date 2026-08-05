// @vitest-environment jsdom
import type { Storage, StorageItem } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageInventoryPanel } from "./StorageInventoryPanel";

const hookMocks = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
  useStorageItems: vi.fn(),
}));

class WideResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect() {}
  unobserve() {}
  observe() {
    this.callback(
      [{ contentRect: { width: 1200 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

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

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof StorageInventoryPanel>> = {},
) {
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
        {...overrides}
      />
    </MantineProvider>,
  );
}

describe("StorageInventoryPanel pagination", () => {
  beforeEach(() => {
    window.ResizeObserver = WideResizeObserver as unknown as typeof ResizeObserver;
    hookMocks.fetchNextPage.mockReset();
    hookMocks.refetch.mockReset();
    hookMocks.useStorageItems.mockReset();
    hookMocks.useStorageItems.mockReturnValue({
      items: [item],
      isLoading: false,
      isError: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: true,
      fetchNextPage: hookMocks.fetchNextPage,
      refetch: hookMocks.refetch,
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

  it("shows a retryable error without an empty or create prompt on initial failure", async () => {
    const user = userEvent.setup();
    hookMocks.useStorageItems.mockReturnValue({
      items: [],
      isLoading: false,
      isError: true,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: hookMocks.fetchNextPage,
      refetch: hookMocks.refetch,
    });

    renderPanel({ canManageItems: true, hasAnyItems: false });

    expect(screen.getByText("common:errors.connectionIssue")).toBeInTheDocument();
    expect(screen.queryByText("empty.noItems")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "action.createItem" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(hookMocks.refetch).toHaveBeenCalledOnce();
  });

  it("keeps cached inventory visible with a retry action after a background failure", async () => {
    const user = userEvent.setup();
    hookMocks.useStorageItems.mockReturnValue({
      items: [item],
      isLoading: false,
      isError: true,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: hookMocks.fetchNextPage,
      refetch: hookMocks.refetch,
    });

    renderPanel();

    expect(screen.getByText("Crystal")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(hookMocks.refetch).toHaveBeenCalledOnce();
  });

  it("groups wide-screen inventory filters on the left and actions on the right", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/StoragePage.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.storage-command \.content-filter-toolbar__layout\[data-compact="false"\][\s\S]*?grid-template-columns:\s*minmax\(16rem,\s*26rem\)\s+auto\s+minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(
      /\.storage-command \.content-filter-toolbar__layout\[data-compact="false"\] \.content-filter-toolbar__controls[\s\S]*?justify-content:\s*flex-start/,
    );
    expect(css).toMatch(
      /\.storage-command\s*\{[^}]*background:\s*var\(--storage-plate\)/,
    );
  });
});
