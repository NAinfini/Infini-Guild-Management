// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementsPage } from "./AnnouncementsPage";

const controller = vi.hoisted(() => ({
  search: "",
  statusFilter: undefined as string | undefined,
  pinnedFilter: false,
  canEdit: true,
  canCreate: true,
  resetFilters: vi.fn(),
  handleCreateByStatus: vi.fn(),
  handleCloseEditor: vi.fn(),
  setSelectedId: vi.fn(async () => true),
  selectedId: "announcement-1" as string | null,
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
  AnnouncementFiltersCard: () => null,
}));

vi.mock("../feature/announcements/AnnouncementListCard", () => ({
  AnnouncementListCard: ({
    emptyText,
    onSelect,
  }: {
    emptyText: ReactNode;
    onSelect: (id: string) => void;
  }) => (
    <div data-testid="announcement-list">
      {emptyText}
      <button type="button" onClick={() => onSelect("announcement-2")}>open announcement</button>
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
  render(
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
    controller.canEdit = true;
    controller.canCreate = true;
    controller.resetFilters.mockReset();
    controller.handleCreateByStatus.mockReset();
    controller.handleCloseEditor.mockReset();
    controller.setSelectedId.mockReset();
    controller.setSelectedId.mockResolvedValue(true);
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
});
