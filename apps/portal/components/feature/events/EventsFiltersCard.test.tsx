// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventsFiltersCard } from "./EventsFiltersCard";

const responsive = vi.hoisted(() => ({ mobile: false }));

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
  });

  it("keeps the administrator create action visible and keyboard-operable on mobile", async () => {
    responsive.mobile = true;
    const user = userEvent.setup();
    const props = renderFilters();

    const createButton = screen.getByRole("button", { name: "button.create" });
    expect(createButton).toBeVisible();
    expect(createButton).toHaveStyle({ minHeight: "44px" });

    createButton.focus();
    await user.keyboard("{Enter}");

    expect(props.onCreateEvent).toHaveBeenCalledOnce();
  });

  it("keeps the existing desktop create action visible", () => {
    renderFilters();

    expect(screen.getByRole("button", { name: "button.create" })).toBeVisible();
  });

  /*
   * 周期模板并进这个切换器之后，它同时是进入模板视图和退出模板视图的唯一入口，
   * 顶部已经没有标签行兜底了。模板档本身的工具栏由 RecurringTemplatesTab 承载，
   * 那一侧的守卫在 RecurringTemplatesTab.test.tsx。
   */
  it("offers the recurring view only to managers", () => {
    renderFilters();
    expect(screen.getByRole("radio", { name: "view.recurring" })).toBeInTheDocument();

    cleanup();
    renderFilters({ canManage: false });
    // 无权限的人点进去只会看到空面板，所以档位本身就不该出现。
    expect(screen.queryByRole("radio", { name: "view.recurring" })).not.toBeInTheDocument();
  });
});
