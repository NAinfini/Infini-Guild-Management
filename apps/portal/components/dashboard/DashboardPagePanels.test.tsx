import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardPanelSkeleton } from "./DashboardPagePanels";

describe("DashboardPanelSkeleton", () => {
  it.each([
    ["signups", ".dashboard-panel-skeleton__day", 8],
    ["events", ".dashboard-panel-skeleton__event-row", 4],
    ["war", ".dashboard-panel-skeleton__war-stat", 4],
  ] as const)("matches the %s panel structure", (variant, selector, count) => {
    const { container } = render(<DashboardPanelSkeleton variant={variant} />);

    expect(container.firstElementChild).toHaveAttribute("data-variant", variant);
    expect(container.querySelectorAll(selector)).toHaveLength(count);
  });
});
