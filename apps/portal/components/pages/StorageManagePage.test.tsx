import type { Storage } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageManagePage } from "./StorageManagePage";

const treeState = vi.hoisted(() => ({
  data: undefined as { data: Storage[] } | undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../hooks/useStorage", () => ({
  useStorageTree: () => treeState,
}));

vi.mock("../../hooks/useStorageMutations", () => ({
  useStorageMutations: () => {
    const mutation = { mutateAsync: vi.fn() };
    return {
      createStorageMutation: mutation,
      updateStorageMutation: mutation,
      deleteStorageMutation: mutation,
      createCategoryMutation: mutation,
      updateCategoryMutation: mutation,
      deleteCategoryMutation: mutation,
    };
  },
}));

vi.mock("../../hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => vi.fn(),
}));

vi.mock("../feature/storage/StorageStructureManager", () => ({
  StorageStructureManager: ({ storages }: { storages: Storage[] }) => (
    <div data-testid="structure-manager">manager:{storages.length}</div>
  ),
}));

function renderPage() {
  render(
    <MantineProvider>
      <StorageManagePage />
    </MantineProvider>,
  );
}

describe("StorageManagePage query states", () => {
  beforeEach(() => {
    treeState.data = undefined;
    treeState.isLoading = false;
    treeState.isError = false;
    treeState.isFetching = false;
    treeState.refetch.mockReset();
  });

  it("shows a retryable connection error instead of the manager on initial failure", async () => {
    const user = userEvent.setup();
    treeState.isError = true;

    renderPage();

    expect(screen.getByText("common:errors.connectionIssue")).toBeInTheDocument();
    expect(screen.queryByTestId("structure-manager")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(treeState.refetch).toHaveBeenCalledOnce();
  });

  it("keeps cached structure visible with a retry action after a background failure", async () => {
    const user = userEvent.setup();
    treeState.data = {
      data: [{
        id: "storage-1",
        name: "Vault",
        description: null,
        created_at: "2026-08-04T00:00:00.000Z",
        categories: [],
      }],
    };
    treeState.isError = true;

    renderPage();

    expect(screen.getByTestId("structure-manager")).toHaveTextContent("manager:1");
    await user.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(treeState.refetch).toHaveBeenCalledOnce();
  });
});
