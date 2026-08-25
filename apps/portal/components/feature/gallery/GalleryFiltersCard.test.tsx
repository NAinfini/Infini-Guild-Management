import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryFiltersCard } from "./GalleryFiltersCard";

const responsive = vi.hoisted(() => ({ mobile: true }));
const confirm = vi.hoisted(() => vi.fn());

vi.mock("@portal/hooks/useMediaQuery", () => ({
  useMediaQuery: () => responsive.mobile,
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirm,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

Object.defineProperty(HTMLElement.prototype, "getAnimations", {
  configurable: true,
  value: () => [],
});

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

  const result = render(<GalleryFiltersCard {...props} />);

  return { ...result, props };
}

describe("GalleryFiltersCard responsive filters", () => {
  beforeEach(() => {
    responsive.mobile = true;
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
    const filterDialog = await screen.findByRole("dialog", { name: /common:filter\.toggle/ });
    expect(within(filterDialog).getByRole("radiogroup", { name: "aria.filterByType" })).toBeInTheDocument();
    expect(within(filterDialog).getByRole("radio", { name: "sort.newest" })).toBeChecked();
    expect(within(filterDialog).getByLabelText("aria.dateFrom")).toBeInTheDocument();
    expect(within(filterDialog).getByLabelText("aria.dateTo")).toBeInTheDocument();

    expect(within(filterDialog).getByLabelText("aria.dateFrom")).toHaveAttribute(
      "placeholder",
      "filter.dateFromPlaceholder",
    );
    expect(within(filterDialog).getByLabelText("aria.dateTo")).toHaveAttribute(
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
    const filterDialog = await screen.findByRole("dialog", { name: /common:filter\.toggle/ });
    fireEvent.change(within(filterDialog).getByLabelText("aria.dateFrom"), {
      target: { value: "2026-08-02" },
    });
    fireEvent.click(within(filterDialog).getByRole("radio", { name: "sort.oldest" }));
    fireEvent.click(within(filterDialog).getByRole("button", { name: "filter.clearDates" }));
    await user.click(within(filterDialog).getByRole("button", { name: "action.close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /common:filter\.toggle/ })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add media" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    expect(props.onSearchChange).toHaveBeenCalledWith("raid");
    expect(props.onDateFromChange).toHaveBeenCalledWith("2026-08-02");
    expect(props.onSortOrderChange).toHaveBeenCalledWith("asc");
    expect(props.onClearDates).toHaveBeenCalledOnce();
    expect(props.onAddMedia).toHaveBeenCalledOnce();
    await waitFor(() => expect(props.onBulkDelete).toHaveBeenCalledOnce());
  });

  it("uses a reset action instead of a legacy clear-all control", async () => {
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
    const filterDialog = await screen.findByRole("dialog", { name: /common:filter\.toggle/ });
    expect(within(filterDialog).getByRole("button", { name: "common:filter.reset" })).toBeInTheDocument();
  });
});
