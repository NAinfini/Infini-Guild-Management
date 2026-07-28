// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  listQuery: { isError: false },
  detailQuery: { isError: false },
}));

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
  AnnouncementListCard: ({ emptyText }: { emptyText: ReactNode }) => emptyText,
}));

vi.mock("../feature/announcements/AnnouncementDetailCard", () => ({
  AnnouncementDetailCard: () => null,
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
});
