// @vitest-environment jsdom
import type { StorageItem } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { StorageBatchPanel, type StorageBatchDraft } from "./StorageBatchPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.item ? `${key}:${String(options.item)}` : key,
  }),
}));

const items: StorageItem[] = [
  {
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
  },
  {
    id: "item-2",
    storage_id: "storage-1",
    category_id: null,
    name: "Ore",
    description: null,
    quantity: 4,
    allow_member_deposit: true,
    allow_member_withdraw: true,
    images: [],
    created_at: "2026-07-28T00:00:00.000Z",
    updated_at: "2026-07-28T00:00:00.000Z",
  },
];

const draft: StorageBatchDraft = {
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  type: "intake",
  quantities: { "item-1": 2, "item-2": 3 },
  recipientUserId: "user-1",
  note: "",
};

function renderPanel(overrides: Partial<ComponentProps<typeof StorageBatchPanel>> = {}) {
  const props: ComponentProps<typeof StorageBatchPanel> = {
    draft,
    items,
    users: [],
    currentUsername: "Member",
    canManageStock: false,
    isSaving: false,
    onTypeChange: vi.fn(),
    onRecipientChange: vi.fn(),
    onNoteChange: vi.fn(),
    onQuantityChange: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  render(
    <MantineProvider>
      <StorageBatchPanel {...props} />
    </MantineProvider>,
  );
  return props;
}

describe("StorageBatchPanel", () => {
  it("reviews selected items and removes only the requested row", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    expect(screen.getByText("Crystal")).toBeInTheDocument();
    expect(screen.getByText("Ore")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "action.removeBatchItem:Crystal" }));

    expect(props.onQuantityChange).toHaveBeenCalledWith("item-1", 0);
  });

  it("submits a non-empty attributed batch and keeps an empty batch disabled", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const { rerender } = render(
      <MantineProvider>
        <StorageBatchPanel
          draft={draft}
          items={items}
          users={[]}
          currentUsername="Member"
          canManageStock={false}
          isSaving={false}
          onTypeChange={vi.fn()}
          onRecipientChange={vi.fn()}
          onNoteChange={vi.fn()}
          onQuantityChange={vi.fn()}
          onClear={vi.fn()}
          onClose={vi.fn()}
          onSubmit={submit}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole("button", { name: "action.submitBatch" }));
    expect(submit).toHaveBeenCalledTimes(1);

    rerender(
      <MantineProvider>
        <StorageBatchPanel
          draft={{ ...draft, quantities: {} }}
          items={items}
          users={[]}
          currentUsername="Member"
          canManageStock={false}
          isSaving={false}
          onTypeChange={vi.fn()}
          onRecipientChange={vi.fn()}
          onNoteChange={vi.fn()}
          onQuantityChange={vi.fn()}
          onClear={vi.fn()}
          onClose={vi.fn()}
          onSubmit={submit}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "action.submitBatch" })).toBeDisabled();
  });
});
