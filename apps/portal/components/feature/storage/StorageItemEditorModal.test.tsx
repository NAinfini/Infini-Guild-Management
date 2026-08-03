// @vitest-environment jsdom
import type { Storage, StorageItem } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StorageItemEditorModal } from "./StorageItemEditorModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
    { id: "image-1", r2_key: "storage/item-1/one.webp" },
    { id: "image-2", r2_key: "storage/item-1/two.webp" },
  ],
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

describe("StorageItemEditorModal image deletion", () => {
  it("shows progress only on the target image and ignores a repeated click", async () => {
    const user = userEvent.setup();
    let finishDelete!: () => void;
    const onDeleteImage = vi.fn(() => new Promise<boolean>((resolve) => {
      finishDelete = () => resolve(true);
    }));

    render(
      <MantineProvider>
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
        />
      </MantineProvider>,
    );

    const deleteButtons = screen.getAllByRole("button", { name: "action.deleteImage" });
    await user.click(deleteButtons[0]!);

    expect(deleteButtons[0]).toHaveAttribute("data-loading", "true");
    expect(deleteButtons[1]).not.toHaveAttribute("data-loading", "true");
    await user.click(deleteButtons[0]!);
    expect(onDeleteImage).toHaveBeenCalledTimes(1);

    finishDelete();
    await waitFor(() => expect(deleteButtons[0]).not.toHaveAttribute("data-loading", "true"));
  });
});
