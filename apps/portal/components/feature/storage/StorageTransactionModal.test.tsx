// @vitest-environment jsdom
import { PERMISSIONS, type CreateStorageTransactionPayload, type StorageItem, type User } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StorageTransactionModal } from "./StorageTransactionModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

const member: User = {
  id: "user-1",
  username: "Member One",
  role: "member",
  permissions: Object.fromEntries(PERMISSIONS.map((permission) => [permission, false])) as User["permissions"],
  is_active: true,
  deleted_at: null,
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

function renderModal(options: {
  canManageStock: boolean;
  mode?: "intake" | "distribute" | "adjust";
}) {
  const onSubmit = vi.fn<(itemId: string, payload: CreateStorageTransactionPayload) => void>();
  render(
    <MantineProvider>
      <StorageTransactionModal
        opened
        items={[item]}
        users={[{ user: member }]}
        initialItem={item}
        initialMode={options.mode ?? "intake"}
        canManageStock={options.canManageStock}
        defaultRecipientUserId={member.id}
        isSaving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    </MantineProvider>,
  );
  return onSubmit;
}

describe("StorageTransactionModal", () => {
  it("keeps the member flow focused on quantity and note", async () => {
    const user = userEvent.setup();
    const onSubmit = renderModal({ canManageStock: false });

    expect(screen.getByRole("textbox", { name: "field.quantity" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "field.note" })).toBeInTheDocument();
    expect(screen.queryByText("tx.adjust")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "field.item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "field.member" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "action.submitDeposit" }));

    expect(onSubmit).toHaveBeenCalledWith(item.id, {
      type: "intake",
      quantity: 1,
      recipient_user_id: member.id,
      note: null,
    });
  });

  it("lets a stock manager submit a distribution for a selected member", async () => {
    const user = userEvent.setup();
    const onSubmit = renderModal({ canManageStock: true, mode: "distribute" });

    expect(screen.getByText("tx.adjust")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "field.item" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "field.member" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "action.submit" }));

    expect(onSubmit).toHaveBeenCalledWith(item.id, {
      type: "distribute",
      quantity: 1,
      recipient_user_id: member.id,
      note: null,
    });
  });

  it("submits stocktake as a target quantity without a recipient", async () => {
    const user = userEvent.setup();
    const onSubmit = renderModal({ canManageStock: true, mode: "adjust" });
    const quantityInput = screen.getByRole("textbox", { name: "field.targetStock" });

    await user.clear(quantityInput);
    await user.type(quantityInput, "12");
    await user.click(screen.getByRole("button", { name: "action.submit" }));

    expect(onSubmit).toHaveBeenCalledWith(item.id, {
      type: "adjust",
      target_quantity: 12,
      note: null,
    });
  });
});
