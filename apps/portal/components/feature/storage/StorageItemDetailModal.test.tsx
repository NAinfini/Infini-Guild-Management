import type { StorageItem, StorageTransaction } from "@guild/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageItemDetailModal } from "./StorageItemDetailModal";

const storageHook = vi.hoisted(() => ({
  useStorageTransactions: vi.fn(),
}));

vi.mock("../../../hooks/useStorage", () => ({
  useStorageTransactions: storageHook.useStorageTransactions,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { page?: number }) =>
      key === "pagination.goToPage" ? String(options?.page) : key,
  }),
}));

const item = (
  id: string,
  images: StorageItem["images"] = [],
): StorageItem => ({
  id,
  storage_id: "storage-1",
  category_id: null,
  name: `Item ${id}`,
  description: null,
  rarity: "common",
  unit: null,
  quantity: 10,
  allow_member_deposit: true,
  allow_member_withdraw: true,
  images,
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
});

const transaction = (id: string): StorageTransaction => ({
  id,
  item_id: "item-1",
  item_name: "Item item-1",
  type: "intake",
  quantity_delta: 1,
  recipient_user_id: "user-1",
  recipient_display_name: "Member One",
  note: null,
  actor_id: "user-1",
  actor_display_name: "Member One",
  created_at: "2026-07-28T00:00:00.000Z",
});

function renderModal(currentItem: StorageItem) {
  return render(
    <StorageItemDetailModal
      opened
      item={currentItem}
      canEditItem={false}
      canManageStock={false}
      onClose={vi.fn()}
      onDeposit={vi.fn()}
      onWithdraw={vi.fn()}
      onEdit={vi.fn()}
    />,
  );
}

describe("StorageItemDetailModal ledger pagination", () => {
  beforeEach(() => {
    storageHook.useStorageTransactions.mockReset();
    storageHook.useStorageTransactions.mockImplementation(({ page }: { page: number }) => ({
      data: {
        data: [transaction(`tx-${page}`)],
        total: 40,
        page,
        limit: 20,
        total_pages: 2,
      },
      isFetching: false,
    }));
  });

  it("requests the selected ledger page", async () => {
    const user = userEvent.setup();
    renderModal(item("item-1"));

    await user.click(screen.getByRole("button", { name: "2" }));

    expect(storageHook.useStorageTransactions).toHaveBeenLastCalledWith({
      itemId: "item-1",
      page: 2,
      limit: 20,
      enabled: true,
    });
  });

  it("resets to page one when the selected item changes", async () => {
    const user = userEvent.setup();
    const view = renderModal(item("item-1"));
    await user.click(screen.getByRole("button", { name: "2" }));
    const callCountBeforeScopeChange = storageHook.useStorageTransactions.mock.calls.length;

    view.rerender(
      <StorageItemDetailModal
        opened
        item={item("item-2")}
        canEditItem={false}
        canManageStock={false}
        onClose={vi.fn()}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    const scopeChangeCalls = storageHook.useStorageTransactions.mock.calls
      .slice(callCountBeforeScopeChange)
      .map(([params]) => params);
    expect(scopeChangeCalls[0]).toMatchObject({ itemId: "item-2", page: 1 });
    expect(scopeChangeCalls).not.toContainEqual(expect.objectContaining({ itemId: "item-2", page: 2 }));

    await waitFor(() => {
      expect(storageHook.useStorageTransactions).toHaveBeenLastCalledWith({
        itemId: "item-2",
        page: 1,
        limit: 20,
        enabled: true,
      });
    });
  });

  it("does not render pagination for an empty single-page ledger", () => {
    storageHook.useStorageTransactions.mockReturnValue({
      data: {
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        total_pages: 1,
      },
      isFetching: false,
    });

    renderModal(item("item-1"));

    expect(screen.getByText("ledger.empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "pagination.2" })).not.toBeInTheDocument();
  });

  it("labels image navigation and disables controls at the accurate boundary", async () => {
    const user = userEvent.setup();
    renderModal(item("item-1", [
      { media_id: "image1234567890abcdef" },
      { media_id: "second1234567890abcde" },
    ]));

    const previous = screen.getByRole("button", { name: "detail.previousImage" });
    const next = screen.getByRole("button", { name: "detail.nextImage" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    await user.click(next);

    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();
  });

  it("shows the ledger title and subtitle", () => {
    renderModal(item("item-1"));

    expect(screen.getByText("ledger.title")).toBeInTheDocument();
    expect(screen.getByText("ledger.subtitle")).toBeInTheDocument();
  });

  it("announces a ledger refresh to assistive technology", () => {
    storageHook.useStorageTransactions.mockReturnValue({
      data: {
        data: [transaction("tx-refresh")],
        total: 1,
        page: 1,
        limit: 20,
        total_pages: 1,
      },
      isFetching: true,
    });

    renderModal(item("item-1"));

    expect(screen.getByRole("status", { name: "ledger.loading" })).toBeInTheDocument();
  });

  it("keeps cached ledger rows visible with a retry after a refresh failure", async () => {
    const refetch = vi.fn();
    storageHook.useStorageTransactions.mockReturnValue({
      data: {
        data: [{ ...transaction("tx-cached"), note: "cached ledger row" }],
        total: 1,
        page: 1,
        limit: 20,
        total_pages: 1,
      },
      isFetching: false,
      isError: true,
      refetch,
    });
    const user = userEvent.setup();

    renderModal(item("item-1"));

    expect(screen.getByText("cached ledger row")).toBeInTheDocument();
    expect(screen.getByText("ledger.error")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "action.retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("offers direct deposit and withdraw actions from item detail", async () => {
    const user = userEvent.setup();
    const onDeposit = vi.fn();
    const onWithdraw = vi.fn();
    const currentItem = item("item-1");

    render(
      <StorageItemDetailModal
        opened
        item={currentItem}
        canEditItem={false}
        canManageStock={false}
        onClose={vi.fn()}
        onDeposit={onDeposit}
        onWithdraw={onWithdraw}
        onEdit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "action.deposit" }));
    await user.click(screen.getByRole("button", { name: "action.withdraw" }));

    expect(onDeposit).toHaveBeenCalledWith(currentItem);
    expect(onWithdraw).toHaveBeenCalledWith(currentItem);
  });

  it("offers direct stock actions to managers when member self-service is closed", () => {
    render(
      <StorageItemDetailModal
        opened
        item={{
          ...item("item-1"),
          allow_member_deposit: false,
          allow_member_withdraw: false,
        }}
        canEditItem
        canManageStock
        onClose={vi.fn()}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "action.deposit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "action.withdraw" })).toBeInTheDocument();
  });
});
