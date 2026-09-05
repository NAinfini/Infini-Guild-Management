import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  RouteProgress,
  completeRouteProgress,
  startRouteProgress,
} from "./route-progress";

describe("RouteProgress", () => {
  it("reflects the router lifecycle without exposing duplicate status text", () => {
    const client = new QueryClient();
    const { container } = render(<QueryClientProvider client={client}><RouteProgress /></QueryClientProvider>);
    const progress = container.querySelector(".route-progress");

    expect(progress).not.toHaveAttribute("data-active");

    act(() => startRouteProgress());
    expect(progress).toHaveAttribute("data-active");

    act(() => completeRouteProgress());
    expect(progress).not.toHaveAttribute("data-active");
    expect(progress).toHaveAttribute("aria-hidden", "true");
  });
});
