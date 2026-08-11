// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementsPage } from "./AnnouncementsPage";

const controller = vi.hoisted(() => ({
  search: "",
  statusFilter: undefined as string | undefined,
  pinnedFilter: false,
  sortOrder: "updated_desc" as "updated_desc" | "updated_asc",
  setSortOrder: vi.fn(),
  canEdit: true,
  canCreate: true,
  resetFilters: vi.fn(),
  handleCreateByStatus: vi.fn(),
  handleCloseEditor: vi.fn(),
  setSelectedId: vi.fn(async () => true),
  selectedId: "announcement-1" as string | null,
  isCreating: false,
  isPublishReady: true,
  rows: [],
  listQuery: { isError: false, isLoading: false },
  detailQuery: { isError: false, isLoading: false },
}));
const responsive = vi.hoisted(() => ({ mobile: false }));

vi.mock("@mantine/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mantine/hooks")>();
  return {
    ...actual,
    useMediaQuery: () => responsive.mobile,
  };
});

vi.mock("../../hooks/useAnnouncementsController", () => ({
  useAnnouncementsController: () => controller,
}));

vi.mock("../../hooks/useLoadWarningToast", () => ({
  useLoadWarningToast: vi.fn(),
}));

vi.mock("../../context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("../feature/announcements/AnnouncementFiltersCard", () => ({
  AnnouncementFiltersCard: ({
    sortOrder,
    onSortOrderChange,
  }: {
    sortOrder: string;
    onSortOrderChange: (value: "updated_desc" | "updated_asc") => void;
  }) => (
    <div data-testid="announcement-filters" data-sort={sortOrder}>
      <button type="button" onClick={() => onSortOrderChange("updated_desc")}>
        sort newest
      </button>
    </div>
  ),
}));

vi.mock("../feature/announcements/AnnouncementListCard", () => ({
  AnnouncementListCard: ({
    emptyText,
    onSelect,
    selectedId,
  }: {
    emptyText: ReactNode;
    onSelect: (id: string) => void;
    selectedId: string | null;
  }) => (
    <div data-testid="announcement-list">
      {emptyText}
      <button type="button" onClick={() => onSelect("announcement-2")}>open announcement</button>
      {selectedId ? (
        <button type="button" onClick={() => onSelect(selectedId)}>open selected announcement</button>
      ) : null}
    </div>
  ),
}));

vi.mock("../feature/announcements/AnnouncementDetailCard", () => ({
  AnnouncementDetailCard: () => <div data-testid="announcement-detail" />,
}));

vi.mock("../layout/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderPage() {
  return render(
    <MantineProvider>
      <AnnouncementsPage />
    </MantineProvider>,
  );
}

describe("AnnouncementsPage empty state", () => {
  beforeEach(() => {
    controller.search = "";
    controller.statusFilter = undefined;
    controller.pinnedFilter = false;
    controller.sortOrder = "updated_desc";
    controller.setSortOrder.mockReset();
    controller.canEdit = true;
    controller.canCreate = true;
    controller.resetFilters.mockReset();
    controller.handleCreateByStatus.mockReset();
    controller.handleCloseEditor.mockReset();
    controller.setSelectedId.mockReset();
    controller.setSelectedId.mockResolvedValue(true);
    controller.selectedId = "announcement-1";
    controller.isCreating = false;
    controller.detailQuery.isLoading = false;
    responsive.mobile = false;
  });

  it("offers creation when the resource is globally empty", () => {
    renderPage();

    const emptyState = screen.getByText("empty").closest(".empty-state");
    expect(emptyState).not.toBeNull();
    fireEvent.click(within(emptyState as HTMLElement).getByRole("button", {
      name: "action.newAnnouncement",
    }));

    expect(controller.handleCreateByStatus).toHaveBeenCalledOnce();
  });

  it("offers filter reset instead of creation when filters hide all results", () => {
    controller.search = "missing";
    renderPage();

    const emptyState = screen.getByText("empty.filtered").closest(".empty-state");
    expect(emptyState).not.toBeNull();
    expect(within(emptyState as HTMLElement).queryByRole("button", {
      name: "action.newAnnouncement",
    })).not.toBeInTheDocument();
    fireEvent.click(within(emptyState as HTMLElement).getByRole("button", {
      name: "action.resetFilters",
    }));

    expect(controller.resetFilters).toHaveBeenCalledOnce();
  });

  it("does not expose creation to a user who can edit but cannot create", () => {
    controller.canCreate = false;
    renderPage();

    const emptyState = screen.getByText("empty").closest(".empty-state");
    expect(emptyState).not.toBeNull();
    expect(within(emptyState as HTMLElement).queryByRole("button", {
      name: "action.newAnnouncement",
    })).not.toBeInTheDocument();
  });

  it("uses a list-first mobile flow and opens one detail task at a time", async () => {
    responsive.mobile = true;
    renderPage();

    expect(screen.getByTestId("announcement-list")).toBeInTheDocument();
    expect(screen.queryByTestId("announcement-detail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "open announcement" }));

    await waitFor(() => {
      expect(screen.getByTestId("announcement-detail")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("announcement-list")).not.toBeInTheDocument();
    expect(controller.setSelectedId).toHaveBeenCalledWith("announcement-2");

    fireEvent.click(screen.getByRole("button", { name: "action.backToList" }));
    await waitFor(() => {
      expect(screen.getByTestId("announcement-list")).toBeInTheDocument();
    });
    expect(controller.handleCloseEditor).toHaveBeenCalledOnce();
  });

  it("opens a preselected announcement on the first mobile click without restarting selection", () => {
    responsive.mobile = true;
    controller.detailQuery.isLoading = true;
    const page = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "open selected announcement" }));

    expect(screen.getByTestId("announcement-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("announcement-list")).not.toBeInTheDocument();
    expect(controller.setSelectedId).not.toHaveBeenCalled();

    controller.detailQuery.isLoading = false;
    page.rerender(
      <MantineProvider>
        <AnnouncementsPage />
      </MantineProvider>,
    );
    expect(screen.getByTestId("announcement-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("announcement-list")).not.toBeInTheDocument();
  });

  it("wires announcement sort and treats a non-default sort as an active filter", () => {
    controller.sortOrder = "updated_asc";
    renderPage();

    expect(screen.getByTestId("announcement-filters")).toHaveAttribute(
      "data-sort",
      "updated_asc",
    );
    expect(screen.getByText("empty.filtered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "sort newest" }));
    const filteredEmptyState = screen.getByText("empty.filtered").closest(".empty-state");
    expect(filteredEmptyState).not.toBeNull();
    fireEvent.click(
      within(filteredEmptyState as HTMLElement).getByRole("button", {
        name: "action.resetFilters",
      }),
    );

    expect(controller.setSortOrder).toHaveBeenCalledWith("updated_desc");
    expect(controller.resetFilters).toHaveBeenCalledOnce();
  });

  it("marks the desktop detail column and stretches short details to the workspace height", () => {
    renderPage();

    const detailColumn = document.querySelector(".announcements-page-column--detail");
    expect(detailColumn).not.toBeNull();
    expect(detailColumn).toContainElement(screen.getByTestId("announcement-detail"));

    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/AnnouncementsPage.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.announcements-detail-card\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?max-block-size:\s*100%/,
    );
  });
});
