import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button accessibility", () => {
  it("activates semantic buttons from the keyboard", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Save</Button>);

    screen.getByRole("button", { name: "Save" }).focus();
    await user.keyboard("{Enter}");

    expect(onClick).toHaveBeenCalledOnce();
  });
});
