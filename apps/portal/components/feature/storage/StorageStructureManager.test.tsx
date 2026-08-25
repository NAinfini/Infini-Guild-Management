import type { Storage } from "@guild/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageStructureManager } from "./StorageStructureManager";

const responsive = vi.hoisted(() => ({ mobile: false }));

vi.mock("@portal/hooks/useMediaQuery", () => ({
  useMediaQuery: () => responsive.mobile,
}));

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

const secondaryStorage: Storage = {
  id: "storage-2",
  name: "Raid vault",
  description: "Raid supplies",
  created_at: "2026-07-28T00:00:00.000Z",
  categories: [{ id: "category-2", name: "Consumables" }],
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

function renderModal(storages: Storage[] = [storage]) {
  render(
    <StorageStructureManager
      storages={storages}
      selectedStorage={storage}
      selectedCategoryId={null}
      {...callbacks}
    />,
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

  it("shows delete progress only on the target storage and ignores a repeated click", async () => {
    const user = userEvent.setup();
    let finishDelete!: () => void;
    callbacks.onDeleteStorage.mockReturnValue(new Promise<boolean>((resolve) => {
      finishDelete = () => resolve(true);
    }));
    renderModal([storage, secondaryStorage]);

    const mainRow = screen.getAllByText(storage.name)[0]!.closest(".storage-management-modal__tree-row--storage");
    const raidRow = screen.getByText(secondaryStorage.name).closest(".storage-management-modal__tree-row--storage");
    const mainDelete = within(mainRow as HTMLElement).getByRole("button", { name: labels.delete });
    const raidDelete = within(raidRow as HTMLElement).getByRole("button", { name: labels.delete });

    await user.click(mainDelete);

    expect(mainDelete).toHaveAttribute("data-loading", "true");
    expect(raidDelete).not.toHaveAttribute("data-loading", "true");
    await user.click(mainDelete);
    expect(callbacks.onDeleteStorage).toHaveBeenCalledTimes(1);

    finishDelete();
    await waitFor(() => expect(mainDelete).not.toHaveAttribute("data-loading", "true"));
  });
});
