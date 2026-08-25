import type { Storage, StorageItem } from "@guild/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageItemEditorModal } from "./StorageItemEditorModal";

const confirmMock = vi.hoisted(() => vi.fn());
const beforeUnloadMock = vi.hoisted(() => vi.fn());

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));

vi.mock("@portal/hooks/useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: beforeUnloadMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { index?: number; total?: number; item?: string }) => {
      if (key === "action.deleteImage") {
        return `Delete image ${options?.index} of ${options?.total} for ${options?.item}`;
      }
      return key;
    },
  }),
}));

const storage: Storage = {
  id: "storage-1",
  name: "Main vault",
  description: null,
  created_at: "2026-07-28T00:00:00.000Z",
  categories: [],
};

const item: StorageItem = {
  id: "item-1",
  storage_id: storage.id,
  category_id: null,
  name: "Crystal",
  description: null,
  quantity: 10,
  allow_member_deposit: true,
  allow_member_withdraw: true,
  images: [
    { media_id: "image1234567890abcdef" },
    { media_id: "second1234567890abcde" },
  ],
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

describe("StorageItemEditorModal", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(false);
    beforeUnloadMock.mockReset();
  });

  it("shows progress only on the target image and ignores a repeated click", async () => {
    const user = userEvent.setup();
    let finishDelete!: () => void;
    const onDeleteImage = vi.fn(() => new Promise<boolean>((resolve) => {
      finishDelete = () => resolve(true);
    }));

    render(
      <StorageItemEditorModal
        opened
        selectedStorage={storage}
        categories={[]}
        item={item}
        isSaving={false}
        isDeleting={false}
        isUploading={false}
        onClose={vi.fn()}
        onCreateItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onDeleteItem={vi.fn()}
        onUploadImages={vi.fn()}
        onDeleteImage={onDeleteImage}
      />,
    );

    const firstDeleteButton = screen.getByRole("button", { name: "Delete image 1 of 2 for Crystal" });
    const secondDeleteButton = screen.getByRole("button", { name: "Delete image 2 of 2 for Crystal" });
    await user.click(firstDeleteButton);

    expect(firstDeleteButton).toHaveAttribute("data-loading", "true");
    expect(secondDeleteButton).not.toHaveAttribute("data-loading", "true");
    await user.click(firstDeleteButton);
    expect(onDeleteImage).toHaveBeenCalledTimes(1);
    expect(onDeleteImage).toHaveBeenCalledWith("item-1", "image1234567890abcdef");

    finishDelete();
    await waitFor(() => expect(firstDeleteButton).not.toHaveAttribute("data-loading", "true"));
    expect(secondDeleteButton).not.toHaveAttribute("data-loading", "true");
  });

  it("does not close a dirty draft until discard is confirmed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <StorageItemEditorModal
        opened
        selectedStorage={storage}
        categories={[]}
        item={null}
        isSaving={false}
        isDeleting={false}
        isUploading={false}
        onClose={onClose}
        onCreateItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onDeleteItem={vi.fn()}
        onUploadImages={vi.fn()}
        onDeleteImage={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "field.itemName" }), "New item");
    await user.click(screen.getByRole("button", { name: "common:action.cancel" }));

    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "common:unsavedChanges.title",
      description: "common:unsavedChanges.message",
      confirmLabel: "common:action.discard",
      cancelLabel: "common:action.cancel",
      intent: "danger",
    }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets the baseline after a successful update", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onUpdateItem = vi.fn((
      _id: string,
      _payload: unknown,
      onSuccess: (savedItem: StorageItem) => void,
    ) => {
      onSuccess({ ...item, name: "Updated crystal" });
    });

    render(
      <StorageItemEditorModal
        opened
        selectedStorage={storage}
        categories={[]}
        item={item}
        isSaving={false}
        isDeleting={false}
        isUploading={false}
        onClose={onClose}
        onCreateItem={vi.fn()}
        onUpdateItem={onUpdateItem}
        onDeleteItem={vi.fn()}
        onUploadImages={vi.fn()}
        onDeleteImage={vi.fn()}
      />,
    );

    const nameInput = screen.getByRole("textbox", { name: "field.itemName" });
    await user.clear(nameInput);
    await user.type(nameInput, "Updated crystal");
    expect(beforeUnloadMock).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole("button", { name: "action.saveItem" }));
    await user.click(screen.getByRole("button", { name: "common:action.cancel" }));

    expect(onUpdateItem).toHaveBeenCalledOnce();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("routes the close button through the same discard confirmation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <StorageItemEditorModal
        opened
        selectedStorage={storage}
        categories={[]}
        item={null}
        isSaving={false}
        isDeleting={false}
        isUploading={false}
        onClose={onClose}
        onCreateItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onDeleteItem={vi.fn()}
        onUploadImages={vi.fn()}
        onDeleteImage={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "field.itemName" }), "New item");
    await user.click(screen.getByRole("button", { name: "common:action.close" }));

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("routes Escape through the overlay exit guard", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <StorageItemEditorModal
        opened
        selectedStorage={storage}
        categories={[]}
        item={null}
        isSaving={false}
        isDeleting={false}
        isUploading={false}
        onClose={onClose}
        onCreateItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onDeleteItem={vi.fn()}
        onUploadImages={vi.fn()}
        onDeleteImage={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "field.itemName" }), "New item");
    await user.keyboard("{Escape}");

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
