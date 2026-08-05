// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementFiltersCard } from "./AnnouncementFiltersCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { value?: string }) =>
      values?.value ? `${key}: ${values.value}` : key,
  }),
}));

class WideResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect() {}
  unobserve() {}
  observe() {
    this.callback(
      [{ contentRect: { width: 1200 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

describe("AnnouncementFiltersCard", () => {
  beforeEach(() => {
    window.ResizeObserver = WideResizeObserver as unknown as typeof ResizeObserver;
  });

  it("uses compact status and sort selects and wires all active filters", async () => {
    const onSearchChange = vi.fn();
    const onStatusFilterChange = vi.fn();
    const onSortOrderChange = vi.fn();
    const onPinnedFilterChange = vi.fn();

    render(
      <MantineProvider>
        <AnnouncementFiltersCard
          pinnedFilter
          statusFilter="archived"
          sortOrder="updated_asc"
          search="dragon"
          canEdit
          onPinnedFilterChange={onPinnedFilterChange}
          onStatusFilterChange={onStatusFilterChange}
          onSortOrderChange={onSortOrderChange}
          onSearchChange={onSearchChange}
        />
      </MantineProvider>,
    );

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    const search = screen.getByRole("textbox", { name: "aria.searchAnnouncements" });
    expect(search).toHaveValue("dragon");
    expect(search.closest(".content-filter-toolbar")).toHaveClass(
      "announcements-filter-toolbar",
    );
    expect(screen.getByRole("combobox", { name: "filter.status" })).toHaveValue("filter.archived");
    expect(screen.getByRole("combobox", { name: "filter.sort" })).toHaveValue("filter.sort.updated_asc");
    expect(screen.queryByText(/filter.summary.search: dragon/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "aria.searchAnnouncements" }), {
      target: { value: "guild" },
    });
    fireEvent.click(screen.getByRole("button", { name: "filter.pinned" }));

    expect(onSearchChange).toHaveBeenCalledWith("guild");
    expect(onPinnedFilterChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("button", { name: "common:filter.clearAll" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "filter.sort" }));
    fireEvent.click(await screen.findByRole("option", { name: "filter.sort.updated_desc" }));
    expect(onSortOrderChange).toHaveBeenCalledWith("updated_desc");
  });

  it("keeps published as the external user's default status", () => {
    render(
      <MantineProvider>
        <AnnouncementFiltersCard
          pinnedFilter={false}
          statusFilter={undefined}
          sortOrder="updated_desc"
          search=""
          canEdit={false}
          onPinnedFilterChange={vi.fn()}
          onStatusFilterChange={vi.fn()}
          onSortOrderChange={vi.fn()}
          onSearchChange={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("combobox", { name: "filter.status" })).toHaveValue("filter.published");
  });
});
