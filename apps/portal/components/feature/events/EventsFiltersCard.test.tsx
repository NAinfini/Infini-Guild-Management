// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventsFiltersCard } from "./EventsFiltersCard";

const responsive = vi.hoisted(() => ({ mobile: false, width: 1200 }));

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

vi.mock("@mantine/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mantine/hooks")>();
  return {
    ...actual,
    useMediaQuery: () => responsive.mobile,
  };
});

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
    canManage: true,
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
    <MantineProvider>
      <EventsFiltersCard {...props} />
    </MantineProvider>,
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
  });

  it("keeps the existing desktop create action visible", () => {
    renderFilters();

    expect(screen.getByRole("button", { name: "button.create" })).toBeVisible();
  });

  it("does not expose a shared clear action for active filters", () => {
    renderFilters({
      searchQuery: "raid",
      eventType: "guild_war",
      eventStatus: "archived",
      pinnedOnly: true,
      lockedOnly: true,
    });

    expect(screen.queryByRole("button", { name: "common:filter.clearAll" })).not.toBeInTheDocument();
  });

  /* 周期模板视图只向管理员开放，并仅通过此切换器进入或退出。 */
  it("offers the recurring view only to managers", () => {
    renderFilters();
    expect(screen.getByRole("radio", { name: "view.recurring" })).toBeInTheDocument();

    cleanup();
    renderFilters({ canManage: false });
    // 无权限的人点进去只会看到空面板，所以档位本身就不该出现。
    expect(screen.queryByRole("radio", { name: "view.recurring" })).not.toBeInTheDocument();
  });
});
