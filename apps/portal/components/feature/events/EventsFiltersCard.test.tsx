import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventsFiltersCard } from "./EventsFiltersCard";

const responsive = vi.hoisted(() => ({ mobile: false, width: 1200 }));

if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
}

class ResponsiveResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect() {}
  unobserve() {}
  observe() {
    this.callback(
      [{ contentRect: { width: responsive.width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderFilters(overrides: Partial<React.ComponentProps<typeof EventsFiltersCard>> = {}) {
  const props: React.ComponentProps<typeof EventsFiltersCard> = {
    searchQuery: "",
    eventType: undefined,
    eventStatus: "active",
    pinnedOnly: false,
    lockedOnly: false,
    viewMode: "cards",
    canCreate: true,
    onSearchChange: vi.fn(),
    onEventTypeChange: vi.fn(),
    onEventStatusChange: vi.fn(),
    onPinnedOnlyChange: vi.fn(),
    onLockedOnlyChange: vi.fn(),
    onViewModeChange: vi.fn(),
    onCreateEvent: vi.fn(),
    ...overrides,
  };

  render(
    <>
      <EventsFiltersCard {...props} />
    </>,
  );

  return props;
}

describe("EventsFiltersCard", () => {
  beforeEach(() => {
    responsive.mobile = false;
    responsive.width = 1200;
    window.ResizeObserver = ResponsiveResizeObserver as unknown as typeof ResizeObserver;
  });

  it("keeps the administrator create action visible and keyboard-operable on mobile", async () => {
    responsive.mobile = true;
    responsive.width = 390;
    const user = userEvent.setup();
    const props = renderFilters();

    const createButton = screen.getByRole("button", { name: "button.create" });
    expect(createButton).toBeVisible();

    createButton.focus();
    await user.keyboard("{Enter}");

    expect(props.onCreateEvent).toHaveBeenCalledOnce();
    expect(props.onCreateEvent).toHaveBeenCalledWith();
  });

  it("keeps the existing desktop create action visible", () => {
    renderFilters();

    expect(screen.getByRole("button", { name: "button.create" })).toBeVisible();
  });

  it("resets grouped filter controls without clearing the search query", async () => {
    const user = userEvent.setup();
    const props = renderFilters({
      searchQuery: "raid",
      eventType: "guild_war",
      eventStatus: "archived",
      pinnedOnly: true,
      lockedOnly: true,
    });

    await user.click(screen.getByRole("button", { name: "common:filter.toggle (4)" }));
    const filterDialog = await screen.findByRole("dialog", { name: /common:filter\.toggle/ });
    expect(within(filterDialog).getByRole("switch", { name: "filter.pinned" })).toBeChecked();
    expect(within(filterDialog).getByRole("switch", { name: "filter.locked" })).toBeChecked();

    await user.click(within(filterDialog).getByRole("button", { name: "common:filter.reset" }));
    expect(props.onEventTypeChange).toHaveBeenCalledWith(undefined);
    expect(props.onEventStatusChange).toHaveBeenCalledWith("active");
    expect(props.onPinnedOnlyChange).toHaveBeenCalledWith(false);
    expect(props.onLockedOnlyChange).toHaveBeenCalledWith(false);
    expect(props.onSearchChange).not.toHaveBeenCalled();
  });

  it("clears the search query from the input group affordance", async () => {
    const user = userEvent.setup();
    const props = renderFilters({ searchQuery: "raid" });

    await user.click(screen.getByRole("button", { name: "common:action.clear" }));

    expect(props.onSearchChange).toHaveBeenCalledWith("");
  });

  it("keeps the URL-backed cards and calendar switcher without a second workspace switch", () => {
    renderFilters();
    const controls = document.querySelector(".events-filter-view-controls");

    expect(controls).not.toBeNull();
    expect(screen.getByRole("tab", { name: "view.cards" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "view.calendar" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "view.recurring" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "view.events" })).not.toBeInTheDocument();
  });
});
