import { render, screen } from "@testing-library/react";
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
  it("does not expose a redundant manual save action", () => {
    render(<GuildWarActiveTopCard {...baseProps} onAddTeam={vi.fn()} onConcludeWar={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "active.saveTeams" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "active.addTeam" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "active.concludeWar" })).toBeInTheDocument();
  });

  it("locks event switching while team metadata is auto-saving", () => {
    render(<GuildWarActiveTopCard {...baseProps} saveTeamsPending />);

    expect(screen.getByRole("combobox", { name: "active.aria.selectEvent" })).toBeDisabled();
  });

  it("aligns the search and event selectors in one filter grid", () => {
    const { container } = render(<GuildWarActiveTopCard {...baseProps} />);

    const filters = container.querySelector(".guild-war-active-top-card__filters");
    expect(filters).not.toBeNull();
    expect(filters?.querySelector(".guild-war-active-top-card__search")).not.toBeNull();
    expect(filters?.querySelector(".guild-war-active-top-card__event")).not.toBeNull();
  });

  it("does not expose the end-war action without an eligible active selection", () => {
    render(<GuildWarActiveTopCard {...baseProps} selectedEventId={undefined} eventOptions={[]} />);

    expect(screen.queryByRole("button", { name: "active.concludeWar" })).not.toBeInTheDocument();
  });
});
