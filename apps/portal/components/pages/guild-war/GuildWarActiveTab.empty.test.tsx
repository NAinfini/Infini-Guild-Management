import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GuildWarActiveEmptyState, GuildWarTeamConflictAlert } from "./GuildWarActiveTab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("GuildWarActiveEmptyState", () => {
  it("offers event setup to viewers who can create events", async () => {
    const onCreateWarEvent = vi.fn();

    const { container } = render(
      <MantineProvider>
        <GuildWarActiveEmptyState
          canCreateWarEvent
          onCreateWarEvent={onCreateWarEvent}
          onViewHistory={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(container.querySelector(".guild-war-active-empty__state svg")).toBeInTheDocument();
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

describe("GuildWarTeamConflictAlert", () => {
  it("offers both conflict recovery choices", async () => {
    const onAcceptRemote = vi.fn();
    const onRetryLocal = vi.fn();

    render(
      <MantineProvider>
        <GuildWarTeamConflictAlert
          pending={false}
          onAcceptRemote={onAcceptRemote}
          onRetryLocal={onRetryLocal}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("active.teamConflict.description")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "active.teamConflict.useRemote" }));
    await userEvent.click(screen.getByRole("button", { name: "active.teamConflict.keepLocal" }));
    expect(onAcceptRemote).toHaveBeenCalledTimes(1);
    expect(onRetryLocal).toHaveBeenCalledTimes(1);
  });

  it("disables conflict recovery while a team save is pending", () => {
    render(
      <MantineProvider>
        <GuildWarTeamConflictAlert
          pending
          onAcceptRemote={vi.fn()}
          onRetryLocal={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "active.teamConflict.useRemote" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "active.teamConflict.keepLocal" })).toBeDisabled();
  });
});
