import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    const aliceKills = screen.getByLabelText("Alice — Kills");
    const aliceDeaths = screen.getByLabelText("Alice — Deaths");
    const bobKills = screen.getByLabelText("Bob — Kills");

    expect(aliceKills).toHaveAttribute("data-metric-grid", "conclude-war-member-stats");

    await user.click(aliceKills);
    await user.keyboard("{Enter}");
    expect(aliceDeaths).toHaveFocus();

    await user.click(aliceKills);
    await user.keyboard("{ArrowDown}");
    expect(bobKills).toHaveFocus();
  });

  it("groups final objectives into a compact two-sided ledger", () => {
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

    expect(screen.getByRole("table", { name: "conclude.section.objectives" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "history.compare.us" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "history.compare.enemy" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Kills" })).toBeInTheDocument();
  });

  it("clears war information after closing before the next open", async () => {
    const user = userEvent.setup();
    const props = {
      onClose: vi.fn(),
      onSubmit: vi.fn(),
      members,
      pending: false,
      warName: "Test War",
    };
    const { rerender } = render(
      <MantineProvider>
        <ConcludeWarModal opened {...props} />
      </MantineProvider>,
    );

    await user.type(screen.getByLabelText("conclude.field.enemyName"), "Old Rival");
    expect(screen.getByLabelText("conclude.field.enemyName")).toHaveValue("Old Rival");

    rerender(
      <MantineProvider>
        <ConcludeWarModal opened={false} {...props} />
      </MantineProvider>,
    );
    rerender(
      <MantineProvider>
        <ConcludeWarModal opened {...props} />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("conclude.field.enemyName")).toHaveValue("");
    });
  });

  it("cannot be dismissed while the destructive submission is pending", () => {
    const onClose = vi.fn();
    render(
      <MantineProvider>
        <ConcludeWarModal
          opened
          onClose={onClose}
          onSubmit={vi.fn()}
          members={members}
          pending
          warName="Test War"
        />
      </MantineProvider>,
    );

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "common:action.close" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "common:action.cancel" })).toBeDisabled();
  });
});
