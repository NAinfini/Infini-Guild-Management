// @vitest-environment jsdom
import type { StorageItem } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StorageItemCard } from "./StorageItemCard";

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
  created_at: "2026-06-11T00:00:00.000Z",
  updated_at: "2026-06-11T00:00:00.000Z",
};

const labels = {
  deposit: "Deposit",
  withdraw: "Withdraw",
  edit: "Edit",
  uncategorized: "Uncategorized",
  stock: "Stock",
  depositEnabled: "Deposit enabled",
  withdrawEnabled: "Withdraw enabled",
  closed: "Closed",
};

function renderCard(permissions: { canEditItems: boolean; canAdjustStock: boolean }) {
  render(
    <MantineProvider>
      <StorageItemCard
        item={item}
        canEditItems={permissions.canEditItems}
        onOpen={vi.fn()}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
        onEdit={vi.fn()}
        labels={labels}
      />
    </MantineProvider>,
  );
}

describe("StorageItemCard permissions", () => {
  it("separates item editing controls from stock transaction controls", () => {
    renderCard({ canEditItems: false, canAdjustStock: true });

    expect(screen.getByRole("button", { name: "Deposit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("keeps member self-service buttons controlled by item settings, not item edit permission", () => {
    renderCard({ canEditItems: true, canAdjustStock: false });

    expect(screen.getByRole("button", { name: "Deposit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });
});
