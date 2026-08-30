import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiRequestError } from "../../api/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementsPage } from "./AnnouncementsPage";

const controller = vi.hoisted(() => ({
  search: "",
  setSearch: vi.fn(),
  statusFilter: undefined as string | undefined,
  setStatusFilter: vi.fn(),
  categoryFilter: undefined as string | undefined,
  setCategoryFilter: vi.fn(),
  categoryOptions: ["announcement", "event", "war", "important"],
  sortOrder: "updated_desc" as "updated_desc" | "updated_asc",
  setSortOrder: vi.fn(),
  canEdit: true,
  canCreate: true,
  resetFilters: vi.fn(),
  handleCreateByStatus: vi.fn(),
  handleCloseEditor: vi.fn(),
  setSelectedId: vi.fn(async () => true),
  selectedId: null as string | null,
  isCreating: false,
  isBusy: false,
  savePending: false,
  deletePending: false,
  isDirty: false,
  isPublishReady: true,
  title: "",
  setTitle: vi.fn(),
  category: "announcement",
  setCategory: vi.fn(),
  bodyJson: "{}",
  setBodyJson: vi.fn(),
  pinned: false,
  setPinned: vi.fn(),
  scheduleEnabled: false,
  setScheduleEnabled: vi.fn(),
  publishAt: "",
  setPublishAt: vi.fn(),
  draftEnabled: false,
  setDraftEnabled: vi.fn(),
  archived: false,
  setArchived: vi.fn(),
  handleFinish: vi.fn(),
  handleDelete: vi.fn(),
  handleUploadAnnouncementImages: vi.fn(),
  attachments: [],
  attachmentUploading: false,
  attachmentMaxBytes: 10 * 1024 * 1024,
  attachmentQuota: 5,
  handleUploadAnnouncementAttachment: vi.fn(),
  handleRemoveAnnouncementAttachment: vi.fn(),
  rows: [
    {
      id: "announcement-1",
      title: "Weekly briefing",
      category: "announcement",
      view_count: 4,
    },
  ],
  pinnedRows: [
    { id: "pinned-1", title: "Pinned one", excerpt: "Pinned one summary", category: "announcement", view_count: 1, author: { display_name: "Author" }, publish_at: null, created_at: "2026-01-01T00:00:00.000Z", preview_media_id: null },
    { id: "pinned-2", title: "Pinned two", excerpt: "Pinned two summary", category: "event", view_count: 2, author: { display_name: "Author" }, publish_at: null, created_at: "2026-01-01T00:00:00.000Z", preview_media_id: null },
    { id: "pinned-3", title: "Pinned three", excerpt: "Pinned three summary", category: "war", view_count: 3, author: { display_name: "Author" }, publish_at: null, created_at: "2026-01-01T00:00:00.000Z", preview_media_id: null },
  ],
  listHasMore: false,
  listLoadingMore: false,
  onLoadMoreList: vi.fn(),
  selected: null as { id: string } | null,
  listQuery: { isError: false, isLoading: false, isFetching: false, refetch: vi.fn() },
  detailQuery: { isError: false, isLoading: false, isFetching: false, error: null as unknown, refetch: vi.fn() },
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
  AnnouncementFiltersCard: ({ sortOrder }: { sortOrder: string }) => (
    <div data-testid="announcement-filters" data-sort-order={sortOrder} />
  ),
}));

vi.mock("../feature/announcements/AnnouncementListCard", () => ({
  AnnouncementListCard: ({
    rows,
    emptyText,
    onSelect,
  }: {
    rows: Array<{ id: string; title: string }>;
    emptyText: ReactNode;
    onSelect: (id: string) => void;
  }) => (
    <section data-testid="announcement-list">
      {rows.length === 0 ? emptyText : rows.map((row) => (
        <button key={row.id} type="button" onClick={() => onSelect(row.id)}>
          {row.title}
        </button>
      ))}
    </section>
  ),
}));

vi.mock("../feature/announcements/AnnouncementDetailCard", () => ({
  AnnouncementDetailCard: ({
    navigation,
    selectedId,
    category,
  }: {
    navigation: ReactNode;
    selectedId: string | null;
    category: string;
  }) => (
    <section data-testid="announcement-detail" data-selected-id={selectedId ?? ""}>
      {navigation}
      <span>{category}</span>
    </section>
  ),
}));

vi.mock("@portal/components/shared/ContentPreviewCard", () => ({
  ContentPreviewCard: ({ title, onOpen }: { title: string; onOpen: () => void }) => (
    <button type="button" data-testid="pinned-announcement" onClick={onOpen}>{title}</button>
  ),
}));

vi.mock("../layout/PageLayout", () => ({
  PageLayout: ({
    children,
    toolbar,
    workspaceMode,
  }: {
    children: ReactNode;
    toolbar?: ReactNode;
    workspaceMode?: "scroll" | "contained";
  }) => (
    <div data-testid="page-layout" data-workspace-mode={workspaceMode}>
      <div data-testid="page-toolbar">{toolbar}</div>
      <div data-testid="page-workspace">{children}</div>
    </div>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderPage() {
  return render(<AnnouncementsPage />);
}

describe("AnnouncementsPage", () => {
  beforeEach(() => {
    controller.search = "";
    controller.statusFilter = undefined;
    controller.categoryFilter = undefined;
    controller.sortOrder = "updated_desc";
    controller.canEdit = true;
    controller.canCreate = true;
    controller.selectedId = null;
    controller.selected = null;
    controller.isCreating = false;
    controller.isBusy = false;
    controller.category = "announcement";
    controller.listQuery = { isError: false, isLoading: false, isFetching: false, refetch: vi.fn() };
    controller.detailQuery = { isError: false, isLoading: false, isFetching: false, error: null, refetch: vi.fn() };
    controller.rows = [{ id: "announcement-1", title: "Weekly briefing", category: "announcement", view_count: 4 }];
    controller.pinnedRows = [
      { id: "pinned-1", title: "Pinned one", excerpt: "Pinned one summary", category: "announcement", view_count: 1, author: { display_name: "Author" }, publish_at: null, created_at: "2026-01-01T00:00:00.000Z", preview_media_id: null },
      { id: "pinned-2", title: "Pinned two", excerpt: "Pinned two summary", category: "event", view_count: 2, author: { display_name: "Author" }, publish_at: null, created_at: "2026-01-01T00:00:00.000Z", preview_media_id: null },
      { id: "pinned-3", title: "Pinned three", excerpt: "Pinned three summary", category: "war", view_count: 3, author: { display_name: "Author" }, publish_at: null, created_at: "2026-01-01T00:00:00.000Z", preview_media_id: null },
    ];
    for (const value of Object.values(controller)) {
      if (typeof value === "function") value.mockReset?.();
    }
    controller.setSelectedId.mockResolvedValue(true);
  });

  it("renders the catalog with three pinned previews and a category rail", () => {
    renderPage();

    expect(screen.getByTestId("page-layout")).toHaveAttribute("data-workspace-mode", "scroll");
    expect(screen.getByTestId("page-toolbar")).toContainElement(screen.getByTestId("announcement-filters"));
    expect(screen.getAllByTestId("pinned-announcement")).toHaveLength(3);
    expect(screen.getByTestId("announcement-list")).toBeInTheDocument();
    expect(screen.queryByTestId("announcement-detail")).not.toBeInTheDocument();
    expect(document.querySelector(".content-pinned-section")).toHaveAttribute("data-slot", "card");

    const rail = document.querySelector<HTMLElement>(".content-category-rail");
    expect(rail).not.toBeNull();
    expect(within(rail as HTMLElement).getByRole("button", { name: /^category\.all/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(rail as HTMLElement).getByRole("button", { name: "category.event" })).toBeInTheDocument();
  });

  it("sizes the pinned grid from its item count and hides it when empty", () => {
    const pinnedRows = [...controller.pinnedRows];

    for (const count of [1, 2, 3]) {
      controller.pinnedRows = pinnedRows.slice(0, count);
      const { container, unmount } = renderPage();

      expect(container.querySelector(".content-pinned-grid")).toHaveAttribute("data-count", String(count));
      unmount();
    }

    controller.pinnedRows = [];
    const { container } = renderPage();
    expect(container.querySelector(".content-pinned-section")).not.toBeInTheDocument();
    controller.pinnedRows = pinnedRows;
  });

  it("does not repeat a pinned announcement in the catalog list", () => {
    controller.rows = [
      { id: "pinned-1", title: "Pinned one", category: "announcement", view_count: 1 },
      { id: "announcement-1", title: "Weekly briefing", category: "announcement", view_count: 4 },
    ];

    renderPage();

    expect(within(screen.getByTestId("announcement-list")).queryByText("Pinned one")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("announcement-list")).getByText("Weekly briefing")).toBeInTheDocument();
  });

  it("hides the pinned section while filtering and keeps matching pinned announcements in the results", () => {
    controller.search = "Pinned";
    controller.rows = [
      { id: "pinned-1", title: "Pinned one", category: "announcement", view_count: 1 },
    ];

    renderPage();

    expect(screen.queryByTestId("pinned-announcement")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("announcement-list")).getByText("Pinned one")).toBeInTheDocument();
  });

  it("opens a pinned item and changes the category filter from the catalog", () => {
    renderPage();

    fireEvent.click(screen.getAllByTestId("pinned-announcement")[1]!);
    expect(controller.setSelectedId).toHaveBeenCalledWith("pinned-2");

    const rail = document.querySelector<HTMLElement>(".content-category-rail");
    fireEvent.click(within(rail as HTMLElement).getByRole("button", { name: "category.event" }));
    expect(controller.setCategoryFilter).toHaveBeenCalledWith("event");
  });

  it("offers filter reset, rather than creation, when the catalog is empty because of a filter", () => {
    controller.rows = [];
    controller.search = "missing";
    renderPage();

    const emptyState = screen.getByText("empty.filtered").closest(".empty-state");
    expect(emptyState).not.toBeNull();
    fireEvent.click(within(emptyState as HTMLElement).getByRole("button", { name: "action.resetFilters" }));
    expect(controller.resetFilters).toHaveBeenCalledOnce();
  });

  it("renders an independent detail page and returns to the catalog", () => {
    controller.selectedId = "announcement-1";
    controller.selected = { id: "announcement-1" };
    renderPage();

    expect(screen.getByTestId("announcement-detail")).toHaveAttribute("data-selected-id", "announcement-1");
    expect(screen.queryByTestId("announcement-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("announcement-filters")).not.toBeInTheDocument();
    expect(screen.getByTestId("announcement-detail")).toContainElement(
      screen.getByRole("button", { name: "action.backToList" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "action.backToList" }));
    expect(controller.setSelectedId).toHaveBeenCalledWith(null);
  });

  it("shows visible and announced progress while a detail mutation is pending", () => {
    controller.selectedId = "announcement-1";
    controller.selected = { id: "announcement-1" };
    controller.isBusy = true;

    renderPage();

    const status = screen.getByRole("status", { name: "status.updating" });
    expect(status.querySelector("span")).not.toBeNull();
  });

  it("keeps cached detail content visible and retries a refresh failure", () => {
    const refetch = vi.fn();
    controller.selectedId = "announcement-1";
    controller.selected = { id: "announcement-1" };
    controller.detailQuery = {
      isError: true,
      isLoading: false,
      isFetching: false,
      error: new Error("refresh failed"),
      refetch,
    };

    renderPage();

    expect(screen.getByTestId("announcement-detail")).toBeInTheDocument();
    expect(screen.getByText("common:loadError")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("uses the same detail page for a new announcement with the default category", () => {
    controller.isCreating = true;
    renderPage();

    expect(screen.getByTestId("announcement-detail")).toHaveAttribute("data-selected-id", "new");
    expect(screen.getByTestId("announcement-detail")).toHaveTextContent("announcement");
  });

  it("returns to the catalog instead of presenting a missing detail as empty content", () => {
    controller.selectedId = "missing-announcement";
    controller.detailQuery = {
      isError: true,
      isLoading: false,
      isFetching: false,
      error: new ApiRequestError("Missing", { status: 404 }),
      refetch: vi.fn(),
    };

    renderPage();

    expect(screen.getByText("common:notFound.title")).toBeInTheDocument();
    expect(screen.queryByTestId("announcement-detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "action.backToList" }));
    expect(controller.setSelectedId).toHaveBeenCalledWith(null);
  });

  it("offers detail retry without replacing a transport failure with an empty state", () => {
    const refetch = vi.fn();
    controller.selectedId = "announcement-1";
    controller.detailQuery = {
      isError: true,
      isLoading: false,
      isFetching: false,
      error: new Error("offline"),
      refetch,
    };

    renderPage();

    expect(screen.getByText("common:loadError")).toBeInTheDocument();
    expect(screen.queryByTestId("announcement-detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
