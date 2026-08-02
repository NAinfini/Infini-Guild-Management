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
  initialItem?: StorageItem | null;
  itemsHasMore?: boolean;
  onLoadMoreItems?: () => void;
}) {
  const onSubmit = vi.fn<(itemId: string, payload: CreateStorageTransactionPayload) => void>();
  render(
    <MantineProvider>
      <StorageTransactionModal
        opened
        items={[item]}
        users={[{ user: member }]}
        initialItem={options.initialItem === undefined ? item : options.initialItem}
        initialMode={options.mode ?? "intake"}
        canManageStock={options.canManageStock}
        itemsHasMore={options.itemsHasMore ?? false}
        itemsLoadingMore={false}
        itemSearch=""
        onItemSearchChange={vi.fn()}
        onLoadMoreItems={options.onLoadMoreItems ?? vi.fn()}
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
    const submit = screen.getByRole("button", { name: "action.submit" });

    expect(screen.getByText("tx.adjust")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "field.item" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "field.member" })).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("textbox", { name: "field.member" }));
    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith(item.id, {
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

    expect(screen.getByRole("textbox", { name: "field.memberOptional" })).toHaveValue("");
    expect(submit).toBeEnabled();

    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith(item.id, {
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
    const itemSelect = screen.getByRole("textbox", { name: "field.item" });
    const memberSelect = screen.getByRole("textbox", { name: "field.member" });
    const quantityInput = screen.getByRole("textbox", { name: "field.quantity" });
    const submit = screen.getByRole("button", { name: "action.submit" });

    expect(itemSelect).toHaveValue("");
    expect(memberSelect).toHaveValue("");
    expect(submit).toBeDisabled();

    await user.click(itemSelect);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(submit).toBeDisabled();

    await user.click(memberSelect);
    await user.keyboard("{ArrowDown}{Enter}");
    await user.clear(quantityInput);
    expect(submit).toBeDisabled();

    await user.type(quantityInput, "2");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith(item.id, {
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
      type: "adjust",
      target_quantity: 12,
      note: null,
    });
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

  it("does not reset an in-progress entry when another item page arrives", async () => {
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
      <MantineProvider>
        <StorageTransactionModal {...commonProps} items={[item]} />
      </MantineProvider>,
    );
    await user.click(screen.getByRole("textbox", { name: "field.item" }));
    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(screen.getByRole("textbox", { name: "field.memberOptional" }));
    await user.keyboard("{ArrowDown}{Enter}");
    const quantityInput = screen.getByRole("textbox", { name: "field.quantity" });
    await user.clear(quantityInput);
    await user.type(quantityInput, "5");

    rerender(
      <MantineProvider>
        <StorageTransactionModal
          {...commonProps}
          items={[item, { ...item, id: "item-2", name: "Ore" }]}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("textbox", { name: "field.quantity" })).toHaveValue("5");

    rerender(
      <MantineProvider>
        <StorageTransactionModal {...commonProps} items={[]} />
      </MantineProvider>,
    );

    expect(screen.getByText("Crystal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "action.submit" })).toBeEnabled();
  });

  /*
   * 只验声明值，不验渲染结果——jsdom 的视口宽度写死 1024，resizeTo() 没实现，
   * 覆写 window.innerWidth 也不参与 CSS 解算，窄屏在这里造不出来。
   *
   * 另外 max-width 不能再用 toHaveStyle 断言：jsdom 30 起 getComputedStyle 会
   * 真的把 vw 算成像素（calc(100vw - 16px) → 1008px），而 toHaveStyle 读的正是
   * 计算值，拿它跟字面量比必然不等。29 版原样返回字符串才让这条一直是绿的。
   * min-height 是纯 px，不受影响，继续用 toHaveStyle。
   *
   * 窄屏下真的没被挤出视口，得靠能设视口的 Playwright 去证——目前三个 project
   * 都是 Desktop Chrome，这块覆盖是空的。
   */
  it("declares a viewport-bounded max width and touch-sized controls", () => {
    const { container } = render(
      <MantineProvider>
        <StorageTransactionModal
          opened
          items={[item]}
          users={[{ user: member }]}
          initialItem={null}
          initialMode="intake"
          canManageStock
          defaultRecipientUserId={member.id}
          isSaving={false}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      </MantineProvider>,
    );

    const content = container.ownerDocument.querySelector<HTMLElement>(".storage-modal-content");
    expect(content).toBeInTheDocument();
    expect(content?.style.maxWidth).toBe("calc(100vw - 16px)");
    expect(screen.getByRole("textbox", { name: "field.item" })).toHaveStyle({
      minHeight: "44px",
    });
    expect(screen.getByRole("button", { name: "action.submit" })).toHaveStyle({
      minHeight: "44px",
    });
  });
});
