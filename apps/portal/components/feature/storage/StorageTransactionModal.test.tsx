import { type CreateStorageTransactionPayload, type StorageItem, type MemberSummary } from "@guild/shared";
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
  rarity: "common",
  unit: null,
  quantity: 10,
  allow_member_deposit: true,
  allow_member_withdraw: true,
  images: [],
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

const member: MemberSummary = {
  id: "user-1",
  display_name: "Member One",
  role: "member",
  role_name: "Member",
  role_color: null,
  role_level: 1,
  is_active: true,
  deleted_at: null,
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
  last_login_at: null,
};

function renderModal(options: {
  canManageStock: boolean;
  mode?: "intake" | "distribute" | "adjust";
  initialItem?: StorageItem | null;
  itemsHasMore?: boolean;
  onLoadMoreItems?: () => void;
  users?: Array<{ user: MemberSummary }>;
  userLoadError?: {
    kind: "directory" | "next-page" | "identities";
    retry: () => Promise<unknown>;
    retrying: boolean;
  } | null;
}) {
  const onSubmit = vi.fn<(itemId: string, payload: CreateStorageTransactionPayload) => void>();
  render(
    <StorageTransactionModal
      opened
      items={[item]}
      users={options.users ?? [{ user: member }]}
      initialItem={options.initialItem === undefined ? item : options.initialItem}
      initialMode={options.mode ?? "intake"}
      canManageStock={options.canManageStock}
      itemsHasMore={options.itemsHasMore ?? false}
      itemsLoadingMore={false}
      itemSearch=""
      onItemSearchChange={vi.fn()}
      onLoadMoreItems={options.onLoadMoreItems ?? vi.fn()}
      userLoadError={options.userLoadError}
      defaultRecipientUserId={member.id}
      isSaving={false}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
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
    expect(screen.queryByRole("combobox", { name: "field.item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "field.member" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "action.submitDeposit" }));

    expect(onSubmit).toHaveBeenCalledWith(item.id, {
      idempotency_key: expect.any(String),
      type: "intake",
      quantity: 1,
      recipient_user_id: member.id,
      note: null,
    });
  });

  it("lets a stock manager submit a distribution for a selected member", async () => {
    const user = userEvent.setup();
    const onSubmit = renderModal({ canManageStock: true, mode: "distribute" });
    const submit = screen.getByRole("button", { name: "action.submit" });

    expect(screen.getByText("tx.adjust")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "field.item" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "field.member" })).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "field.member" }));
    await user.click(await screen.findByRole("option", { name: "Member One" }));
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith(item.id, {
      idempotency_key: expect.any(String),
      type: "distribute",
      quantity: 1,
      recipient_user_id: member.id,
      note: null,
    });
  });

  it("lets a stock manager record intake without attributing it to a member", async () => {
    const user = userEvent.setup();
    const onSubmit = renderModal({ canManageStock: true, mode: "intake" });
    const submit = screen.getByRole("button", { name: "action.submit" });

    expect(screen.getByRole("combobox", { name: "field.memberOptional" })).toHaveValue("");
    expect(submit).toBeEnabled();

    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith(item.id, {
      idempotency_key: expect.any(String),
      type: "intake",
      quantity: 1,
      recipient_user_id: null,
      note: null,
    });
  });

  it("requires explicit valid choices for a manual manager entry", async () => {
    const user = userEvent.setup();
    const onSubmit = renderModal({
      canManageStock: true,
      mode: "distribute",
      initialItem: null,
    });
    const itemSelect = screen.getByRole("combobox", { name: "field.item" });
    const memberSelect = screen.getByRole("combobox", { name: "field.member" });
    const quantityInput = screen.getByRole("textbox", { name: "field.quantity" });
    const submit = screen.getByRole("button", { name: "action.submit" });

    expect(itemSelect).toHaveValue("");
    expect(memberSelect).toHaveValue("");
    expect(submit).toBeDisabled();

    await user.click(itemSelect);
    await user.click(await screen.findByRole("option", { name: "Crystal (10)" }));
    expect(submit).toBeDisabled();

    await user.click(memberSelect);
    await user.click(await screen.findByRole("option", { name: "Member One" }));
    await user.clear(quantityInput);
    expect(submit).toBeDisabled();

    await user.type(quantityInput, "2");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith(item.id, {
      idempotency_key: expect.any(String),
      type: "distribute",
      quantity: 2,
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
      idempotency_key: expect.any(String),
      type: "adjust",
      target_quantity: 12,
      note: null,
    });
  });

  it("keeps an idempotency key for retries and replaces it for a new form intent", async () => {
    const user = userEvent.setup();
    const onSubmit = renderModal({ canManageStock: false });
    const submit = screen.getByRole("button", { name: "action.submitDeposit" });

    await user.click(submit);
    await user.click(submit);

    const firstPayload = onSubmit.mock.calls[0]![1];
    const retryPayload = onSubmit.mock.calls[1]![1];
    expect(firstPayload.idempotency_key).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,63}$/);
    expect(retryPayload.idempotency_key).toBe(firstPayload.idempotency_key);

    await user.type(screen.getByRole("textbox", { name: "field.note" }), "new note");
    await user.click(submit);

    expect(onSubmit.mock.calls[2]![1].idempotency_key).not.toBe(firstPayload.idempotency_key);
  });

  it("loads another server page in the global manager item picker", async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn();
    renderModal({
      canManageStock: true,
      initialItem: null,
      itemsHasMore: true,
      onLoadMoreItems: loadMore,
    });

    await user.click(screen.getByRole("button", { name: "action.loadMore" }));

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("offers member retry instead of reporting no users after a directory failure", async () => {
    const retry = vi.fn(async () => undefined);
    renderModal({
      canManageStock: true,
      mode: "distribute",
      users: [],
      userLoadError: { kind: "directory", retry, retrying: false },
    });

    expect(screen.getByText("loadError")).toBeInTheDocument();
    expect(screen.queryByText("empty.noUsers")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "field.member" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "action.retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("does not reset an in-progress entry when item or member search results change", async () => {
    const user = userEvent.setup();
    const commonProps = {
      opened: true,
      users: [{ user: member }],
      initialItem: null,
      initialMode: "intake" as const,
      canManageStock: true,
      defaultRecipientUserId: member.id,
      isSaving: false,
      onClose: vi.fn(),
      onSubmit: vi.fn(),
    };
    const { rerender } = render(
      <StorageTransactionModal {...commonProps} items={[item]} />,
    );
    await user.click(screen.getByRole("combobox", { name: "field.item" }));
    await user.click(await screen.findByRole("option", { name: "Crystal (10)" }));
    await user.click(screen.getByRole("combobox", { name: "field.memberOptional" }));
    await user.click(await screen.findByRole("option", { name: "Member One" }));
    const quantityInput = screen.getByRole("textbox", { name: "field.quantity" });
    await user.clear(quantityInput);
    await user.type(quantityInput, "5");

    rerender(
      <StorageTransactionModal
        {...commonProps}
        items={[item, { ...item, id: "item-2", name: "Ore" }]}
      />,
    );

    expect(screen.getByRole("textbox", { name: "field.quantity" })).toHaveValue("5");

    rerender(
      <StorageTransactionModal {...commonProps} items={[]} users={[]} />,
    );

    expect(screen.getByText("Crystal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "action.submit" })).toBeEnabled();
  });
});
