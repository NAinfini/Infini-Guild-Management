// @vitest-environment jsdom
import type { Storage, StorageItem } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StorageItemEditorModal } from "./StorageItemEditorModal";

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
});
