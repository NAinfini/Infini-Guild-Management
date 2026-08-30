import type { Storage, StorageItem } from "@guild/shared";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoragePage } from "./StoragePage";

const storageState = vi.hoisted(() => ({
  canManageStructure: true,
  canManageItems: false,
  canManageStock: false,
  search: {} as Record<string, unknown>,
  storages: [] as Storage[],
  allItems: [] as StorageItem[],
  manualHasMore: false,
  treeLoading: false,
  treeError: false,
  treeFetching: false,
  treeHasData: true,
  treeRefetch: vi.fn(),
}));

const storageHooks = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  useStorageItems: vi.fn(),
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

const mutationMocks = vi.hoisted(() => ({
  createBatchTransaction: vi.fn(),
  createItem: vi.fn(),
  uploadImages: vi.fn(),
}));
const beforeUnloadPromptMock = vi.hoisted(() => vi.fn());

const mutation = () => ({
  isPending: false,
  mutate: vi.fn(),
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { data: [] } }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => routerMocks.navigate,
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
      || (storageState.canManageItems && permissions.includes("admin.storage.items"))
      || (storageState.canManageStock && permissions.includes("admin.storage.stock")),
  }),
}));

vi.mock("../../hooks/useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: beforeUnloadPromptMock,
}));

vi.mock("../../hooks/useStorage", () => ({
  useStorageTree: () => ({
    data: storageState.treeHasData ? { data: storageState.storages } : undefined,
    isLoading: storageState.treeLoading,
    isError: storageState.treeError,
    isFetching: storageState.treeFetching,
    refetch: storageState.treeRefetch,
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
    createItemMutation: {
      isPending: false,
      mutate: mutationMocks.createItem,
    },
    updateItemMutation: mutation(),
    deleteItemMutation: mutation(),
    uploadImagesMutation: {
      isPending: false,
      mutate: mutationMocks.uploadImages,
    },
    deleteImageMutation: mutation(),
    createTransactionMutation: mutation(),
    createBatchTransactionMutation: {
      isPending: false,
      mutate: mutationMocks.createBatchTransaction,
    },
  }),
}));

vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string; display_name: string } }) => unknown) =>
    selector({ user: { id: "user-1", display_name: "Member" } }),
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
  StorageItemEditorModal: ({
    opened,
    selectedStorage,
    item: currentItem,
    onCreateItem,
    onUploadImages,
  }: {
    opened: boolean;
    selectedStorage: Storage | null;
    item: StorageItem | null;
    onCreateItem: (payload: {
      storage_id: string;
      category_id: null;
      name: string;
      description: null;
      rarity: "common";
      unit: null;
      allow_member_deposit: boolean;
      allow_member_withdraw: boolean;
    }, onSuccess: (item: StorageItem) => void) => void;
    onUploadImages: (itemId: string, files: File[]) => void;
  }) => opened
    ? (
        <div>
          <div data-testid="storage-editor-item">{currentItem?.id ?? "new"}</div>
          <div data-testid="storage-editor-scope">{selectedStorage?.id ?? "none"}</div>
          {!currentItem ? (
            <button
              type="button"
              onClick={() => onCreateItem({
                storage_id: selectedStorage?.id ?? "missing-storage",
                category_id: null,
                name: "Crystal",
                description: null,
                rarity: "common",
                unit: null,
                allow_member_deposit: false,
                allow_member_withdraw: false,
              }, () => {})}
            >
              editor-create
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onUploadImages(currentItem.id, [new File(["image"], "item.png", { type: "image/png" })])}
            >
              editor-upload
            </button>
          )}
        </div>
      )
    : null,
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
    structure_revision: 0,
    categories: [{ id: "category-1", name: "Materials" }],
  },
  {
    id: "storage-2",
    name: "Raid vault",
    description: null,
    created_at: "2026-07-28T00:00:00.000Z",
    structure_revision: 0,
    categories: [],
  },
];

const item: StorageItem = {
  id: "item-1",
  storage_id: "storage-1",
  category_id: null,
  name: "Crystal",
  description: null,
  rarity: "common",
  unit: null,
  quantity: 10,
  allow_member_deposit: true,
  allow_member_withdraw: true,
  images: [],
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

function renderPage() {
  return render(<StoragePage />);
}

describe("StoragePage recovery and filter isolation", () => {
  beforeEach(() => {
    storageState.canManageStructure = true;
    storageState.canManageItems = false;
    storageState.canManageStock = false;
    storageState.search = {};
    storageState.storages = [];
    storageState.allItems = [item];
    storageState.manualHasMore = false;
    storageState.treeLoading = false;
    storageState.treeError = false;
    storageState.treeFetching = false;
    storageState.treeHasData = true;
    storageState.treeRefetch.mockReset();
    storageHooks.fetchNextPage.mockReset();
    storageHooks.useStorageItems.mockReset();
    routerMocks.navigate.mockReset();
    mutationMocks.createBatchTransaction.mockReset();
    mutationMocks.createItem.mockReset();
    mutationMocks.uploadImages.mockReset();
    beforeUnloadPromptMock.mockReset();
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

  it("shows a retryable connection error without an empty or create state on initial failure", async () => {
    const user = userEvent.setup();
    storageState.treeError = true;
    storageState.treeHasData = false;

    renderPage();

    expect(screen.getByText("common:errors.connectionIssue")).toBeInTheDocument();
    expect(screen.queryByText("empty.noStorage")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "action.createStorage" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(storageState.treeRefetch).toHaveBeenCalledOnce();
  });

  it("keeps cached storage visible with a retry action after a background failure", async () => {
    const user = userEvent.setup();
    storageState.storages = [storages[0]!];
    storageState.treeError = true;

    renderPage();

    expect(screen.getAllByText("Main vault").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(storageState.treeRefetch).toHaveBeenCalledOnce();
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

  it("uses the category selected by the route search", () => {
    storageState.storages = storages;
    storageState.search = { storageId: "storage-1", categoryId: "category-1" };
    renderPage();

    expect(storageHooks.useStorageItems).toHaveBeenCalledWith(expect.objectContaining({
      storageId: "storage-1",
      categoryId: "category-1",
    }));
  });

  it("keeps entity navigator selections in the URL", async () => {
    const user = userEvent.setup();
    storageState.storages = storages;

    renderPage();

    const navigator = screen.getByRole("region", { name: "field.storage" });
    await user.click(within(navigator).getByRole("button", { name: "Raid vault" }));

    expect(routerMocks.navigate).toHaveBeenCalledWith({
      to: "/storage",
      search: { storageId: "storage-2" },
      replace: true,
      viewTransition: false,
    });

    routerMocks.navigate.mockReset();
    await user.click(within(navigator).getByRole("button", { name: "Materials" }));

    expect(routerMocks.navigate).toHaveBeenCalledWith({
      to: "/storage",
      search: { storageId: "storage-1", categoryId: "category-1" },
      replace: true,
      viewTransition: false,
    });
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
    await user.click(screen.getByRole("button", { name: "action.reviewBatch" }));
    await user.click(await screen.findByRole("button", { name: "action.submitBatch" }));

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

  it("keeps the active batch controls visible above the inventory", async () => {
    const user = userEvent.setup();
    storageState.storages = [storages[0]!];
    renderPage();

    await user.click(screen.getByRole("button", { name: "action.startBatch" }));

    expect(screen.getByText("batch.title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "action.reviewBatch" })).toBeInTheDocument();
  });

  it("protects a populated batch draft when leaving the storage route", async () => {
    const user = userEvent.setup();
    storageState.storages = [storages[0]!];
    renderPage();

    expect(beforeUnloadPromptMock).toHaveBeenLastCalledWith(false, {
      allowSamePathNavigation: true,
    });
    await user.click(screen.getByRole("button", { name: "action.startBatch" }));
    await user.click(screen.getByRole("button", { name: "add-item-1" }));

    expect(beforeUnloadPromptMock).toHaveBeenLastCalledWith(true, {
      allowSamePathNavigation: true,
    });
  });

  it("keeps a newly created item open so an admin can upload images immediately", async () => {
    const user = userEvent.setup();
    storageState.storages = [storages[0]!];
    storageState.canManageItems = true;
    renderPage();

    await user.click(screen.getByRole("button", { name: "action.createItem" }));
    await user.click(screen.getByRole("button", { name: "editor-create" }));

    const createOptions = mutationMocks.createItem.mock.calls[0]?.[1] as {
      onSuccess: (createdItem: StorageItem) => void;
    };
    act(() => createOptions.onSuccess(item));

    expect(screen.getByTestId("storage-editor-item")).toHaveTextContent(item.id);
    await user.click(screen.getByRole("button", { name: "editor-upload" }));
    expect(mutationMocks.uploadImages).toHaveBeenCalledWith({
      itemId: item.id,
      files: [expect.any(File)],
    });
  });

  it("keeps an open item editor bound to the storage where it was opened", async () => {
    const user = userEvent.setup();
    storageState.storages = storages;
    storageState.canManageItems = true;
    storageState.search = { storageId: "storage-1" };
    const view = renderPage();

    await user.click(screen.getByRole("button", { name: "action.createItem" }));
    expect(screen.getByTestId("storage-editor-scope")).toHaveTextContent("storage-1");

    storageState.search = { storageId: "storage-2" };
    view.rerender(<StoragePage />);
    expect(screen.getByTestId("storage-editor-scope")).toHaveTextContent("storage-1");
    await user.click(screen.getByRole("button", { name: "editor-create" }));

    expect(mutationMocks.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ storage_id: "storage-1" }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("keeps an open manual transaction picker bound to its original storage", async () => {
    const user = userEvent.setup();
    storageState.storages = storages;
    storageState.canManageStock = true;
    storageState.search = { storageId: "storage-1" };
    const view = renderPage();

    await user.click(screen.getByRole("button", { name: "action.manualEntry" }));
    storageState.search = { storageId: "storage-2" };
    view.rerender(<StoragePage />);

    expect(storageHooks.useStorageItems.mock.calls.some(([options]) => (
      options.storageId === "storage-1" && options.enabled === true
    ))).toBe(true);
  });
});
