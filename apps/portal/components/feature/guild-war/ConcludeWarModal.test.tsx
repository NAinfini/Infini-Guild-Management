// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConcludeWarModal } from "./ConcludeWarModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === "conclude.aria.memberMetric") {
        return `${options?.member} — ${options?.metric}`;
      }
      if (key === "conclude.aria.objectiveMetric") {
        return options?.metric ?? key;
      }
      return key;
    },
  }),
}));

const members = [
  {
    userId: "user-1",
    username: "Alice",
    teamName: "Alpha",
    stats: { kills: 1, deaths: 0 },
  },
  {
    userId: "user-2",
    username: "Bob",
    teamName: "Bravo",
    stats: { kills: 2, deaths: 1 },
  },
];

describe("ConcludeWarModal", () => {
  it("renders member metrics as keyboard-navigable inputs by default", async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <ConcludeWarModal
          opened
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          members={members}
          pending={false}
          warName="Test War"
        />
      </MantineProvider>,
    );

    const aliceKills = screen.getByLabelText("Alice — conclude.col.kills");
    const aliceDeaths = screen.getByLabelText("Alice — conclude.col.deaths");
    const bobKills = screen.getByLabelText("Bob — conclude.col.kills");

    expect(aliceKills).toHaveAttribute("data-metric-grid", "conclude-war-member-stats");

    await user.click(aliceKills);
    await user.keyboard("{Enter}");
    expect(aliceDeaths).toHaveFocus();

    await user.click(aliceKills);
    await user.keyboard("{ArrowDown}");
    expect(bobKills).toHaveFocus();
  });
});
