import type { ExternalDashboardWar } from "@guild/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LastWarCard } from "./LastWarCard";
import type { DashboardLastWarMvp } from "./shared";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) => key,
  }),
}));

function war(overrides: Partial<ExternalDashboardWar> = {}): ExternalDashboardWar {
  return {
    id: "war-1",
    event_id: "event-1",
    war_name: "Citadel Siege",
    enemy_name: "Abyss Guard",
    result: "win",
    own_stats: { kills: 120, towers: 8, base_hp: 65, credits: 4200, distance: 900 },
    enemy_stats: { kills: 95, towers: 6, base_hp: 20, credits: 3900, distance: 760 },
    duration_minutes: 42,
    created_at: "2026-08-28T20:00:00.000Z",
    updated_at: "2026-08-28T21:00:00.000Z",
    ...overrides,
  };
}

const mvps: DashboardLastWarMvp = [
  { category: "damage", label: "Damage", name: "Aster", initials: "A", value: 128000 },
  { category: "healing", label: "Healing", name: "Beryl", initials: "B", value: 92000 },
  { category: "damage_taken", label: "Damage Taken", name: "Cinder", initials: "C", value: 74000 },
  { category: "building_damage", label: "Building Damage", name: "Dawn", initials: "D", value: 51000 },
];

describe("LastWarCard", () => {
  it("opens the selected war report and pages between recent wars", async () => {
    const onOpenHistory = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <LastWarCard
        recentWars={[
          war(),
          war({
            id: "war-2",
            war_name: "Moon Gate Defense",
            enemy_name: "Iron Lotus",
            result: "loss",
          }),
        ]}
        warMvps={[mvps, null]}
        isExternalView={false}
        onOpenHistory={onOpenHistory}
        onViewHistory={vi.fn()}
      />,
    );

    const scoreboard = within(container).getByRole("table", {
      name: "card.lastWar.comparison",
    });
    expect(within(scoreboard).getByRole("rowheader", { name: "Kills" })).toBeInTheDocument();
    expect(screen.getByText("Win")).toBeInTheDocument();
    expect(screen.getByText("Abyss Guard")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "card.lastWar.report" }));
    expect(onOpenHistory).toHaveBeenLastCalledWith("Citadel Siege");

    await user.click(screen.getByRole("button", { name: "card.lastWar.aria.nextWar" }));
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("Loss")).toBeInTheDocument();
    expect(screen.getByText("Iron Lotus")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "card.lastWar.report" }));
    expect(onOpenHistory).toHaveBeenLastCalledWith("Moon Gate Defense");
  });

  it("keeps the empty state as a direct route to war history", async () => {
    const onViewHistory = vi.fn();
    render(
      <LastWarCard
        recentWars={[]}
        warMvps={[]}
        isExternalView={false}
        onOpenHistory={vi.fn()}
        onViewHistory={onViewHistory}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "card.lastWar.viewHistory" }));
    expect(onViewHistory).toHaveBeenCalledOnce();
  });
});
