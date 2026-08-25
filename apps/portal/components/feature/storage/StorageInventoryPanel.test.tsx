import type { Storage, StorageItem } from "@guild/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageInventoryPanel } from "./StorageInventoryPanel";

const hookMocks = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
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

vi.mock("@portal/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  const { categoryId = null, ...rest } = overrides;
  render(
    <StorageInventoryPanel
      storage={storage}
      categoryId={categoryId}
      canManageItems={false}
      canManageStock={false}
      hasAnyItems
      onStartBatch={vi.fn()}
      onBatchQuantityChange={vi.fn()}
      onOpenItem={vi.fn()}
      onEditItem={vi.fn()}
      onOpenTransaction={vi.fn()}
      {...rest}
    />,
  );
}

describe("StorageInventoryPanel pagination", () => {
  beforeEach(() => {
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

  it("clears the inventory search from the input group affordance", async () => {
    const user = userEvent.setup();
    renderPanel();

    const search = screen.getByRole("searchbox", { name: "filter.search" });
    await user.type(search, "crystal");
    await user.click(screen.getByRole("button", { name: "common:action.clear" }));

    expect(search).toHaveValue("");
  });

  it("sends the stock filter to the server query", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "common:filter.toggle" }));
    const filters = within(await screen.findByRole("dialog"));
    await user.click(filters.getByRole("radio", { name: "filter.empty" }));

    expect(hookMocks.useStorageItems).toHaveBeenLastCalledWith(expect.objectContaining({
      stock: "empty",
    }));
  });

  it("takes the category selected by the page-level entity navigator", () => {
    renderPanel({ categoryId: "category-1" });

    expect(screen.queryByRole("button", { name: "Materials" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "filter.category" })).not.toBeInTheDocument();
    expect(hookMocks.useStorageItems).toHaveBeenCalledWith(expect.objectContaining({
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

  it("uses the shared toolbar layout without page-specific compact overrides", () => {
    const storageCss = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/StoragePage.css"),
      "utf8",
    );
    const toolbarCss = readFileSync(
      resolve(process.cwd(), "apps/portal/components/shared/ContentFilterToolbar.css"),
      "utf8",
    );

    expect(toolbarCss).toMatch(/grid-template-areas:\s*"search filter view summary actions"/);
    expect(storageCss).not.toMatch(/data-compact|content-filter-toolbar__controls/);
    expect(storageCss).not.toMatch(/storage-category-rail|storage-command__category-mobile/);
    expect(storageCss).toMatch(
      /\.storage-semantic-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(180px,\s*220px\)\s+minmax\(0,\s*1fr\)/,
    );
    expect(storageCss).toMatch(
      /\.storage-command\s*\{[^}]*background:\s*var\(--storage-plate\)/,
    );
  });
});
