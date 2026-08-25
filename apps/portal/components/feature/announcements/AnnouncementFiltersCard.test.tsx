import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementFiltersCard } from "./AnnouncementFiltersCard";

if (!Element.prototype.getAnimations) {
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { value?: string }) =>
      values?.value ? `${key}: ${values.value}` : key,
  }),
}));

vi.mock("@portal/hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

describe("AnnouncementFiltersCard", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1200, 48),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses grouped status, sort, and binary filter controls", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    const onStatusFilterChange = vi.fn();
    const onSortOrderChange = vi.fn();
    const onPinnedFilterChange = vi.fn();

    render(
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
      />,
    );

    const search = screen.getByRole("textbox", { name: "aria.searchAnnouncements" });
    expect(search).toHaveValue("dragon");
    await user.click(screen.getByRole("button", { name: "common:action.clear" }));
    expect(onSearchChange).toHaveBeenCalledWith("");
    expect(search.closest(".content-filter-toolbar")).toHaveClass(
      "announcements-filter-toolbar",
    );
    await user.click(screen.getByRole("button", { name: "common:filter.toggle (3)" }));
    const filterDialog = await screen.findByRole("dialog", {
      name: /common:filter\.toggle/,
    });
    expect(filterDialog).toBeVisible();
    expect(within(filterDialog).getByRole("radiogroup", { name: "filter.status" })).toBeInTheDocument();
    expect(within(filterDialog).getByRole("radio", { name: "filter.archived" })).toBeChecked();
    expect(within(filterDialog).getByRole("radio", { name: "filter.sort.updated_asc" })).toBeChecked();
    expect(screen.queryByText(/filter.summary.search: dragon/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "aria.searchAnnouncements" }), {
      target: { value: "guild" },
    });
    fireEvent.click(within(filterDialog).getByRole("switch", { name: "filter.pinned" }));

    expect(onSearchChange).toHaveBeenCalledWith("guild");
    expect(onPinnedFilterChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("button", { name: "common:filter.clearAll" })).not.toBeInTheDocument();

    await user.click(within(filterDialog).getByRole("radio", { name: "filter.sort.updated_desc" }));
    expect(onSortOrderChange).toHaveBeenCalledWith("updated_desc");
  });

  it("keeps published as the external user's default status", async () => {
    const user = userEvent.setup();
    render(
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
      />,
    );

    await user.click(screen.getByRole("button", { name: "common:filter.toggle" }));
    expect(await screen.findByRole("radio", { name: "filter.published" })).toBeChecked();
  });
});
