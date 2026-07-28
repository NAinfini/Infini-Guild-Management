// @vitest-environment jsdom
import type { StorageItem, StorageTransaction } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
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
  useTranslation: () => ({ t: (key: string) => key }),
}));

const item = (id: string): StorageItem => ({
  id,
  storage_id: "storage-1",
  category_id: null,
  name: `Item ${id}`,
  description: null,
  quantity: 10,
  allow_member_deposit: true,
  allow_member_withdraw: true,
  images: [],
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
  recipient_username: "Member One",
  note: null,
  actor_id: "user-1",
  actor_username: "Member One",
  created_at: "2026-07-28T00:00:00.000Z",
});

function renderModal(currentItem: StorageItem) {
  return render(
    <MantineProvider>
      <StorageItemDetailModal opened item={currentItem} onClose={vi.fn()} />
    </MantineProvider>,
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

    view.rerender(
      <MantineProvider>
        <StorageItemDetailModal opened item={item("item-2")} onClose={vi.fn()} />
      </MantineProvider>,
    );

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
});
