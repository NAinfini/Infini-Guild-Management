// @vitest-environment jsdom
import type { Storage, StorageItem } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoragePage } from "./StoragePage";

const storageState = vi.hoisted(() => ({
  canManageStructure: true,
  canManageStock: false,
  search: {} as Record<string, unknown>,
  storages: [] as Storage[],
  allItems: [] as StorageItem[],
  manualHasMore: false,
}));

const storageHooks = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  useStorageItems: vi.fn(),
}));

const mutationMocks = vi.hoisted(() => ({
  createBatchTransaction: vi.fn(),
}));

const mutation = () => ({
  isPending: false,
  mutate: vi.fn(),
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { data: [] } }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearch: () => storageState.search,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../hooks/useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({
    canManage: (permissions: string[]) =>
      (storageState.canManageStructure && permissions.includes("admin.storage.structure"))
      || (storageState.canManageStock && permissions.includes("admin.storage.stock")),
  }),
}));

vi.mock("../../hooks/useStorage", () => ({
  useStorageTree: () => ({
    data: { data: storageState.storages },
    isLoading: false,
  }),
  useStorageItems: storageHooks.useStorageItems,
  useStorageItem: () => ({ data: null }),
  useStorageTransactions: () => ({ data: { data: [] } }),
}));

vi.mock("../../hooks/useStorageMutations", () => ({
  useStorageMutations: () => ({
    createStorageMutation: mutation(),
    updateStorageMutation: mutation(),
    deleteStorageMutation: mutation(),
    createCategoryMutation: mutation(),
    updateCategoryMutation: mutation(),
    deleteCategoryMutation: mutation(),
    createItemMutation: mutation(),
    updateItemMutation: mutation(),
    deleteItemMutation: mutation(),
    uploadImagesMutation: mutation(),
    deleteImageMutation: mutation(),
    createTransactionMutation: mutation(),
    createBatchTransactionMutation: {
      isPending: false,
      mutate: mutationMocks.createBatchTransaction,
    },
  }),
}));

vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string; username: string } }) => unknown) =>
    selector({ user: { id: "user-1", username: "Member" } }),
}));

vi.mock("../feature/storage/StorageItemCard", () => ({
  StorageItemCard: ({
    item,
    batch,
  }: {
    item: StorageItem;
    batch?: { onChange: (quantity: number) => void };
  }) => (
    <div>
      {item.name}
      {batch ? (
        <button type="button" aria-label={`add-${item.id}`} onClick={() => batch.onChange(1)}>
          add
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("../feature/storage/StorageItemDetailModal", () => ({
  StorageItemDetailModal: () => null,
}));

vi.mock("../feature/storage/StorageItemEditorModal", () => ({
  StorageItemEditorModal: () => null,
}));

vi.mock("../feature/storage/StorageTransactionModal", () => ({
  StorageTransactionModal: ({
    opened,
    items,
    itemSearch,
    itemsHasMore,
    onItemSearchChange,
    onLoadMoreItems,
  }: {
    opened: boolean;
    items: StorageItem[];
    itemSearch?: string;
    itemsHasMore?: boolean;
    onItemSearchChange?: (value: string) => void;
    onLoadMoreItems?: () => void;
  }) => opened
    ? (
        <div>
          <div data-testid="storage-admin-items">{items.map((item) => item.name).join(",")}</div>
          {onItemSearchChange ? (
            <input
              aria-label="manual-item-search"
              value={itemSearch ?? ""}
              onChange={(event) => onItemSearchChange(event.currentTarget.value)}
            />
          ) : null}
          {itemsHasMore ? (
            <button type="button" onClick={onLoadMoreItems}>manual-load-more</button>
          ) : null}
        </div>
      )
    : null,
}));

const storages: Storage[] = [
  {
    id: "storage-1",
    name: "Main vault",
    description: null,
    created_at: "2026-07-28T00:00:00.000Z",
    categories: [],
  },
  {
    id: "storage-2",
    name: "Raid vault",
    description: null,
    created_at: "2026-07-28T00:00:00.000Z",
    categories: [],
  },
];

const item: StorageItem = {
  id: "item-1",
  storage_id: "storage-1",
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

function renderPage() {
  render(
    <MantineProvider>
      <StoragePage />
    </MantineProvider>,
  );
}

describe("StoragePage recovery and filter isolation", () => {
  beforeEach(() => {
    storageState.canManageStructure = true;
    storageState.canManageStock = false;
    storageState.search = {};
    storageState.storages = [];
    storageState.allItems = [item];
    storageState.manualHasMore = false;
    storageHooks.fetchNextPage.mockReset();
    storageHooks.useStorageItems.mockReset();
    mutationMocks.createBatchTransaction.mockReset();
    storageHooks.useStorageItems.mockImplementation((options: {
      search?: string;
      enabled?: boolean;
    } = {}) => ({
      items: options.search ? [] : storageState.allItems,
      isLoading: false,
      hasNextPage: Boolean(options.enabled && storageState.manualHasMore),
      isFetchingNextPage: false,
      fetchNextPage: storageHooks.fetchNextPage,
    }));
  });

  it("links a structure manager to the dedicated management route from the empty state", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "action.createStorage" })).toHaveAttribute(
      "href",
      "/storage/manage",
    );
  });

  it("does not expose the create action to users without structure permission", () => {
    storageState.canManageStructure = false;
    renderPage();

    expect(screen.queryByRole("button", { name: "action.createStorage" })).not.toBeInTheDocument();
  });

  it("uses the storage selected by the route search", () => {
    storageState.storages = storages;
    storageState.search = { storageId: "storage-2" };
    renderPage();

    expect(storageHooks.useStorageItems).toHaveBeenCalledWith(expect.objectContaining({
      storageId: "storage-2",
    }));
  });

  it("keeps manual entry independent from inventory filters", async () => {
    const user = userEvent.setup();
    storageState.storages = storages;
    storageState.canManageStock = true;
    renderPage();

    await user.type(screen.getByPlaceholderText("filter.search"), "no-match");

    const manualEntry = screen.getByRole("button", { name: "action.manualEntry" });
    expect(manualEntry).toBeEnabled();
    await user.click(manualEntry);

    expect(screen.getByTestId("storage-admin-items")).toHaveTextContent("Crystal");
    expect(storageHooks.useStorageItems).toHaveBeenCalledWith(expect.objectContaining({
      storageId: "storage-1",
      enabled: true,
    }));
  });

  it("searches and paginates the global manager item picker on the server", async () => {
    const user = userEvent.setup();
    storageState.storages = [storages[0]!];
    storageState.canManageStock = true;
    storageState.manualHasMore = true;
    renderPage();

    await user.click(screen.getByRole("button", { name: "action.manualEntry" }));
    await user.type(screen.getByRole("textbox", { name: "manual-item-search" }), "ore");
    await waitFor(() => {
      expect(storageHooks.useStorageItems).toHaveBeenCalledWith(expect.objectContaining({
        storageId: "storage-1",
        search: "ore",
        enabled: true,
      }));
    });
    await user.click(screen.getByRole("button", { name: "manual-load-more" }));

    expect(storageHooks.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("submits a stable attributed batch through the batch mutation", async () => {
    const user = userEvent.setup();
    storageState.storages = [storages[0]!];
    renderPage();

    await user.click(screen.getByRole("button", { name: "action.startBatch" }));
    await user.click(screen.getByRole("button", { name: "add-item-1" }));
    await user.click(screen.getByRole("button", { name: "action.submitBatch" }));

    expect(mutationMocks.createBatchTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency_key: expect.any(String),
        type: "intake",
        entries: [{ item_id: "item-1", quantity: 1 }],
        recipient_user_id: "user-1",
        note: null,
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("reveals the batch summary when the active batch button is pressed again", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    storageState.storages = [storages[0]!];
    renderPage();

    await user.click(screen.getByRole("button", { name: "action.startBatch" }));
    await user.click(screen.getByRole("button", { name: "batch.pendingItems" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end" });
  });
});
