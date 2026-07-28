import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GuildWarActiveTopCard } from "./GuildWarActiveTopCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const baseProps = {
  selectedEventId: "event-1",
  eventOptions: [{ value: "event-1", label: "Siege Night" }],
  eventPlaceholder: "Choose event",
  onSelectedEventIdChange: vi.fn(),
  canManage: true,
  activeSearch: "",
  onActiveSearchChange: vi.fn(),
  searchPlaceholder: "Search",
};

describe("GuildWarActiveTopCard", () => {
  it("exposes the team save action only when there are changes to persist", async () => {
    const onSaveTeams = vi.fn();
    const { rerender } = render(
      <MantineProvider>
        <GuildWarActiveTopCard
          {...baseProps}
          onSaveTeams={onSaveTeams}
          teamsDirty={false}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "active.saveTeams" })).toBeDisabled();

    rerender(
      <MantineProvider>
        <GuildWarActiveTopCard
          {...baseProps}
          onSaveTeams={onSaveTeams}
          teamsDirty
        />
      </MantineProvider>,
    );

    expect(screen.getByText("active.unsaved")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "active.saveTeams" }));
    expect(onSaveTeams).toHaveBeenCalledTimes(1);
  });

  it("locks event switching while a team save is in progress", () => {
    render(
      <MantineProvider>
        <GuildWarActiveTopCard
          {...baseProps}
          onSaveTeams={vi.fn()}
          teamsDirty
          saveTeamsPending
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("textbox", { name: "active.aria.selectEvent" })).toBeDisabled();
  });
});
