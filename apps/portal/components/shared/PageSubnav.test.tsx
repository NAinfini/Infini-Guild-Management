import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PageSubnav } from "./PageSubnav";

describe("PageSubnav", () => {
  it("does not render navigation for a single available task", () => {
    render(
      <PageSubnav
        value="events"
        label="Event workspace"
        items={[{ value: "events", label: "Events" }]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("navigation", { name: "Event workspace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Event workspace" })).not.toBeInTheDocument();
  });

  it("exposes route tasks as one labelled navigation surface", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <PageSubnav
        value="profile"
        label="Profile workspace"
        items={[
          { value: "profile", label: "Profile" },
          { value: "availability", label: "Availability", indicator: <span>Unsaved</span> },
          { value: "account", label: "Account & security" },
        ]}
        onChange={onChange}
      />,
    );

    const navigation = screen.getByRole("navigation", { name: "Profile workspace" });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Account & security/ }));
    expect(onChange).toHaveBeenCalledWith("account");
  });
});
