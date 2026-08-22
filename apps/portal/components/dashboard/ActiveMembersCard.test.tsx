import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";
import { ActiveMembersCard } from "./ActiveMembersCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@portal/components/effects", () => ({
  NumberTicker: () => <span data-testid="animated-operational-value" />,
}));

describe("ActiveMembersCard", () => {
  it("renders factual guild KPIs as static, semantic values", () => {
    const { container } = render(
      <MantineProvider>
        <ActiveMembersCard
          activeMemberCount={18}
          totalMembersCount={24}
          allWarWinRate={62.5}
          activeEventsCount={3}
          memberStatsLoading={false}
          eventsLoading={false}
          warsLoading={false}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "card.activeMembers.title" })).toBeInTheDocument();
    expect(screen.queryByTestId("animated-operational-value")).not.toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("/24")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("62.5%")).toBeInTheDocument();

    expect(container.querySelector(".dashboard-kpi-grid")?.tagName).toBe("DIV");
    const metricLists = Array.from(container.querySelectorAll("dl.dashboard-kpi"));
    expect(metricLists).toHaveLength(3);
    for (const list of metricLists) {
      expect(Array.from(list.children, (child) => child.tagName)).toEqual(["DT", "DD"]);
    }
  });
});
