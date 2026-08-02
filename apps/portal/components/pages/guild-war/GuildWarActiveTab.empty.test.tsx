// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GuildWarActiveEmptyState } from "./GuildWarActiveTab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("GuildWarActiveEmptyState", () => {
  it("offers event setup to viewers who can create events", async () => {
    const onCreateWarEvent = vi.fn();

    render(
      <MantineProvider>
        <GuildWarActiveEmptyState
          canCreateWarEvent
          onCreateWarEvent={onCreateWarEvent}
          onViewHistory={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("active.empty.managerDescription")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "active.empty.createAction" }));
    expect(onCreateWarEvent).toHaveBeenCalledTimes(1);
  });

  it("offers history as the next step to viewers without event-create permission", async () => {
    const onViewHistory = vi.fn();

    render(
      <MantineProvider>
        <GuildWarActiveEmptyState
          canCreateWarEvent={false}
          onCreateWarEvent={vi.fn()}
          onViewHistory={onViewHistory}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("active.empty.viewerDescription")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "active.empty.historyAction" }));
    expect(onViewHistory).toHaveBeenCalledTimes(1);
  });
});
