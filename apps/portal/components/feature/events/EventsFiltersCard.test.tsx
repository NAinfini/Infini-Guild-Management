// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
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
});
