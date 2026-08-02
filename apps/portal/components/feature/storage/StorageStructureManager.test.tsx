// @vitest-environment jsdom
import type { Storage } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageStructureManager } from "./StorageStructureManager";

const responsive = vi.hoisted(() => ({ mobile: false }));

vi.mock("@mantine/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mantine/hooks")>();
  return {
    ...actual,
    useMediaQuery: () => responsive.mobile,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const storage: Storage = {
  id: "storage-1",
  name: "Main vault",
  description: "Guild supplies",
  created_at: "2026-07-28T00:00:00.000Z",
  categories: [{ id: "category-1", name: "Materials" }],
};

const labels = {
  createTitle: "manageStorage.createTitle",
  editTitle: "manageStorage.editTitle",
  storageList: "manageStorage.storageList",
  name: "field.storageName",
  description: "field.storageDescription",
  emptyDescription: "empty.noDescription",
  create: "action.createStorage",
  save: "action.saveStorage",
  delete: "action.deleteStorage",
  cancel: "common:action.cancel",
  noStorages: "empty.noStorage",
  categoryName: "field.categoryName",
  createCategoryTitle: "manageStorage.createCategoryTitle",
  editCategoryTitle: "manageStorage.editCategoryTitle",
  createCategory: "action.createCategory",
  saveCategory: "action.saveCategory",
  deleteCategory: "action.deleteCategory",
  noCategories: "empty.noCategories",
  selectStructure: "manageStorage.selectStructure",
  changeSelection: "manageStorage.changeSelection",
  mobileHint: "manageStorage.mobileHint",
};

const callbacks = {
  onSelectStorage: vi.fn(),
  onSelectCategory: vi.fn(),
  onCreateStorage: vi.fn(),
  onUpdateStorage: vi.fn(),
  onDeleteStorage: vi.fn(),
  onCreateCategory: vi.fn(),
  onUpdateCategory: vi.fn(),
  onDeleteCategory: vi.fn(),
};

function renderModal() {
  render(
    <MantineProvider>
      <StorageStructureManager
        storages={[storage]}
        selectedStorage={storage}
        selectedCategoryId={null}
        isSaving={false}
        isDeleting={false}
        {...callbacks}
      />
    </MantineProvider>,
  );
}

describe("StorageStructureManager create drafts", () => {
  beforeEach(() => {
    for (const callback of Object.values(callbacks)) {
      callback.mockReset();
    }
    responsive.mobile = false;
  });

  it("keeps a new storage local until the user explicitly saves it", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: labels.create }));

    expect(callbacks.onCreateStorage).not.toHaveBeenCalled();
    expect(screen.getByText(labels.createTitle)).toBeInTheDocument();

    const nameInput = screen.getByRole("textbox", { name: labels.name });
    expect(nameInput).toHaveValue("");
    await user.type(nameInput, "Raid vault");
    await user.type(screen.getByRole("textbox", { name: labels.description }), "Weekly raid supplies");
    await user.click(screen.getAllByRole("button", { name: labels.create }).at(-1)!);

    expect(callbacks.onCreateStorage).toHaveBeenCalledTimes(1);
    expect(callbacks.onCreateStorage).toHaveBeenCalledWith(
      { name: "Raid vault", description: "Weekly raid supplies" },
      expect.any(Function),
    );
  });

  it("discards a canceled storage draft without creating a record", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: labels.create }));
    await user.type(screen.getByRole("textbox", { name: labels.name }), "Do not save");
    await user.click(screen.getByRole("button", { name: labels.cancel }));

    expect(callbacks.onCreateStorage).not.toHaveBeenCalled();
    expect(screen.queryByText(labels.createTitle)).not.toBeInTheDocument();
  });

  it("keeps a new category local until its create button is pressed", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: labels.createCategory }));

    expect(callbacks.onCreateCategory).not.toHaveBeenCalled();
    expect(screen.getByText(labels.createCategoryTitle)).toBeInTheDocument();

    const categoryInput = screen.getByRole("textbox", { name: labels.categoryName });
    expect(categoryInput).toHaveValue("");
    await user.type(categoryInput, "Consumables");
    await user.click(screen.getAllByRole("button", { name: labels.createCategory }).at(-1)!);

    expect(callbacks.onCreateCategory).toHaveBeenCalledTimes(1);
    expect(callbacks.onCreateCategory).toHaveBeenCalledWith(
      storage.id,
      { name: "Consumables" },
      expect.any(Function),
    );
  });

  it("keeps structure selection accessible from a left drawer on mobile", async () => {
    responsive.mobile = true;
    const user = userEvent.setup();
    renderModal();

    expect(screen.getByText(labels.mobileHint)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: labels.changeSelection }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Materials" }));
    expect(callbacks.onSelectCategory).toHaveBeenCalledWith(storage.id, "category-1");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
