// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DepthButton } from "./DepthButton";

describe("DepthButton disabled tooltip target", () => {
  it("wraps a disabled button so its tooltip remains reachable", () => {
    render(
      <MantineProvider>
        <DepthButton disabled tooltip="Unavailable">
          Copy
        </DepthButton>
      </MantineProvider>,
    );

    const button = screen.getByRole("button", { name: "Copy" });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute("data-disabled-tooltip-target");
  });
});
