import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryFiltersCard } from "./GalleryFiltersCard";

const responsive = vi.hoisted(() => ({ mobile: true }));
const confirm = vi.hoisted(() => vi.fn());

class MobileResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect() {}
  unobserve() {}
  observe() {
    this.callback(
      [{ contentRect: { width: 390 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

vi.mock("@mantine/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mantine/hooks")>();
  return {
    ...actual,
    useMediaQuery: () => responsive.mobile,
  };
});

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirm,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderFilters(
  overrides: Partial<React.ComponentProps<typeof GalleryFiltersCard>> = {},
) {
  const props: React.ComponentProps<typeof GalleryFiltersCard> = {
    typeFilter: undefined,
    onTypeFilterChange: vi.fn(),
    sortOrder: "desc",
    onSortOrderChange: vi.fn(),
    dateFrom: "2026-08-01",
    dateTo: "2026-08-04",
    search: "",
    onDateFromChange: vi.fn(),
    onDateToChange: vi.fn(),
    onSearchChange: vi.fn(),
    onClearDates: vi.fn(),
    canModerate: true,
    canUpload: true,
    selectedCount: 2,
    onBulkDelete: vi.fn(),
    bulkDeletePending: false,
    onAddMedia: vi.fn(),
    filterTypeLabel: "Filter type",
    bulkDeleteLabel: "Delete selected",
    addMediaLabel: "Add media",
    ...overrides,
  };

  const result = render(
    <MantineProvider>
      <GalleryFiltersCard {...props} />
    </MantineProvider>,
  );

  return { ...result, props };
}

describe("GalleryFiltersCard responsive filters", () => {
  beforeEach(() => {
    responsive.mobile = true;
    window.ResizeObserver = MobileResizeObserver as unknown as typeof ResizeObserver;
    confirm.mockReset();
    confirm.mockResolvedValue(true);
  });

  it("keeps media actions visible while 390px filters move into the drawer", async () => {
    const user = userEvent.setup();
    const { container } = renderFilters();

    expect(container.querySelector(".content-filter-toolbar")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add media" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /common:filter\.toggle/ }));
    const typeSelect = await screen.findByRole("combobox", {
      name: "aria.filterByType",
      hidden: true,
    });

    const choiceRow = document.querySelector(".gallery-filters__choice-row");
    const dateRow = document.querySelector(".gallery-filters__date-row");
    expect(choiceRow).not.toBeNull();
    expect(dateRow).not.toBeNull();

    expect(choiceRow).toContainElement(typeSelect);
    expect(choiceRow).toContainElement(screen.getByRole("radio", { name: "sort.newest", hidden: true }));
    expect(dateRow).toContainElement(screen.getByLabelText("aria.dateFrom"));
    expect(dateRow).toContainElement(screen.getByLabelText("aria.dateTo"));

    expect(screen.getByLabelText("aria.dateFrom")).toHaveAttribute(
      "placeholder",
      "filter.dateFromPlaceholder",
    );
    expect(screen.getByLabelText("aria.dateTo")).toHaveAttribute(
      "placeholder",
      "filter.dateToPlaceholder",
    );
  });

  it("preserves filter and permission-gated action callbacks", async () => {
    const user = userEvent.setup();
    const { props } = renderFilters();

    fireEvent.change(screen.getByLabelText("aria.searchCaption"), {
      target: { value: "raid" },
    });
    await user.click(screen.getByRole("button", { name: /common:filter\.toggle/ }));
    fireEvent.change(await screen.findByLabelText("aria.dateFrom"), {
      target: { value: "2026-08-02" },
    });
    fireEvent.click(await screen.findByRole("radio", { name: "sort.oldest", hidden: true }));
    fireEvent.click(await screen.findByRole("button", { name: "aria.clearDates", hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "Add media" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    expect(props.onSearchChange).toHaveBeenCalledWith("raid");
    expect(props.onDateFromChange).toHaveBeenCalledWith("2026-08-02");
    expect(props.onSortOrderChange).toHaveBeenCalledWith("asc");
    expect(props.onClearDates).toHaveBeenCalledOnce();
    expect(props.onAddMedia).toHaveBeenCalledOnce();
    await waitFor(() => expect(props.onBulkDelete).toHaveBeenCalledOnce());
  });

  it("does not expose a shared clear action in the compact filter panel", async () => {
    const user = userEvent.setup();
    renderFilters({
      search: "raid",
      typeFilter: "video",
      sortOrder: "asc",
    });

    await user.click(screen.getByRole("button", { name: /common:filter\.toggle/ }));
    expect(screen.queryByRole("button", {
      name: "common:filter.clearAll",
      hidden: true,
    })).not.toBeInTheDocument();
  });
});
