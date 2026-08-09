// @vitest-environment jsdom
import type { StorageItem } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { StorageItemCard } from "./StorageItemCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "action.deposit": "Deposit",
      "action.withdraw": "Withdraw",
      "action.edit": "Edit",
      "category.uncategorized": "Uncategorized",
      "badge.depositEnabled": "Deposit enabled",
      "badge.withdrawEnabled": "Withdraw enabled",
      "badge.closed": "Closed",
    })[key] ?? key,
  }),
}));

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

function renderCard(
  permissions: { canEditItems: boolean; canAdjustStock: boolean },
  batch?: ComponentProps<typeof StorageItemCard>["batch"],
) {
  render(
    <MantineProvider>
      <StorageItemCard
        item={item}
        canEditItems={permissions.canEditItems}
        canManageStock={permissions.canAdjustStock}
        batch={batch}
        onOpen={vi.fn()}
        onDeposit={vi.fn()}
        onWithdraw={vi.fn()}
        onEdit={vi.fn()}
      />
    </MantineProvider>,
  );
}

describe("StorageItemCard permissions", () => {
  it("uses 44px-token hit areas for mobile card actions without inflating desktop controls", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/StoragePage.css"),
      "utf8",
    );
    const mobileStart = css.indexOf("@media (max-width: 40em)");
    const nextMedia = css.indexOf("\n@media", mobileStart + 1);
    const mobileCss = css.slice(mobileStart, nextMedia === -1 ? undefined : nextMedia);

    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expect(mobileCss).toMatch(
      /\.storage-item-card__actions \.mantine-Button-root\s*\{[^}]*min-block-size:\s*var\(--control-hit-area\)/s,
    );
    expect(mobileCss).toMatch(
      /\.storage-item-card__actions \.mantine-ActionIcon-root\s*\{[^}]*min-inline-size:\s*var\(--control-hit-area\)[^}]*min-block-size:\s*var\(--control-hit-area\)/s,
    );
  });

  it("opens an item without an image by pointer and keyboard", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();

    render(
      <MantineProvider>
        <StorageItemCard
          item={item}
          canEditItems={false}
          canManageStock={false}
          onOpen={onOpen}
          onDeposit={vi.fn()}
          onWithdraw={vi.fn()}
          onEdit={vi.fn()}
        />
      </MantineProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Crystal" });
    await user.click(trigger);
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(onOpen).toHaveBeenNthCalledWith(1, item);
    expect(onOpen).toHaveBeenNthCalledWith(2, item);
  });

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

  it("keeps direct stock actions available to managers for a managed-only item", () => {
    render(
      <MantineProvider>
        <StorageItemCard
          item={{
            ...item,
            allow_member_deposit: false,
            allow_member_withdraw: false,
          }}
          canEditItems
          canManageStock
          onOpen={vi.fn()}
          onDeposit={vi.fn()}
          onWithdraw={vi.fn()}
          onEdit={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "Deposit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });

  it("adjusts an eligible item inside batch mode", () => {
    const onChange = vi.fn();
    renderCard(
      { canEditItems: false, canAdjustStock: false },
      {
        type: "intake",
        quantity: 2,
        canManageStock: false,
        limitReached: false,
        onChange,
      },
    );

    screen.getByRole("button", { name: "action.increaseBatchItem" }).click();
    screen.getByRole("button", { name: "action.decreaseBatchItem" }).click();

    expect(onChange).toHaveBeenNthCalledWith(1, 3);
    expect(onChange).toHaveBeenNthCalledWith(2, 1);
  });

  it("does not add a twenty-first unique item", () => {
    renderCard(
      { canEditItems: false, canAdjustStock: false },
      {
        type: "intake",
        quantity: 0,
        canManageStock: false,
        limitReached: true,
        onChange: vi.fn(),
      },
    );

    expect(screen.getByRole("button", { name: "action.increaseBatchItem" })).toBeDisabled();
  });
});
