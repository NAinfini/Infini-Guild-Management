import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  RouteProgress,
  completeRouteProgress,
  startRouteProgress,
} from "./route-progress";

describe("RouteProgress", () => {
  it("reflects the router lifecycle without exposing duplicate status text", () => {
    const { container } = render(<RouteProgress />);
    const progress = container.querySelector(".route-progress");

    expect(progress).not.toHaveAttribute("data-active");

    act(() => startRouteProgress());
    expect(progress).toHaveAttribute("data-active");

    act(() => completeRouteProgress());
    expect(progress).not.toHaveAttribute("data-active");
    expect(progress).toHaveAttribute("aria-hidden", "true");
  });
});
