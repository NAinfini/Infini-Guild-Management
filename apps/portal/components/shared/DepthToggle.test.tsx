// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DepthToggle } from "./DepthToggle";

describe("DepthToggle disabled tooltip target", () => {
  it("wraps a disabled toggle so its tooltip remains reachable", () => {
    render(
      <MantineProvider>
        <DepthToggle disabled tooltip="Unavailable">
          Join
        </DepthToggle>
      </MantineProvider>,
    );

    const button = screen.getByRole("button", { name: "Join" });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute("data-disabled-tooltip-target");
  });
});
