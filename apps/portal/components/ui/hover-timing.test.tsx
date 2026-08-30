import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  TOOLTIP_CLOSE_DELAY_MS,
  TOOLTIP_GROUP_TIMEOUT_MS,
  TOOLTIP_OPEN_DELAY_MS,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

describe("shared hover overlay timing", () => {
  it.each(["default", "card"] as const)("supports keyboard focus and Escape dismissal for %s tooltips", async (variant) => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={<button type="button">Notifications</button>} />
          <TooltipContent variant={variant}>Recent notifications</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Recent notifications");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Notifications" })).toHaveFocus();
  });

  it("opens after the shared delay, ignores pointer interaction, and closes after leave", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider
        delay={TOOLTIP_OPEN_DELAY_MS}
        closeDelay={TOOLTIP_CLOSE_DELAY_MS}
        timeout={TOOLTIP_GROUP_TIMEOUT_MS}
      >
        <Tooltip>
          <TooltipTrigger render={<button type="button">Notifications</button>} />
          <TooltipContent variant="card">Recent notifications</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Notifications" });
    await user.hover(trigger);
    const popup = await screen.findByRole("tooltip");
    expect(popup).toHaveTextContent("Recent notifications");
    expect(popup).toHaveClass("pointer-events-none");

    await user.unhover(trigger);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(), {
      timeout: TOOLTIP_CLOSE_DELAY_MS + TOOLTIP_GROUP_TIMEOUT_MS + 150,
    });
  });
});
