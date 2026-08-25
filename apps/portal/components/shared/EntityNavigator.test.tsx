import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntityNavigator } from "./EntityNavigator";

const responsive = vi.hoisted(() => ({ compact: false }));

vi.mock("@portal/hooks/useMediaQuery", () => ({
  useMediaQuery: () => responsive.compact,
}));

function NavigatorHarness() {
  const [value, setValue] = useState("main");

  return (
    <EntityNavigator
      label="Storage locations"
      countLabel="2 locations"
      items={[
        { value: "main", label: "Main vault" },
        {
          value: "materials",
          label: "Materials",
          mobileLabel: "Main vault · Materials",
          parentValue: "main",
        },
        { value: "raid", label: "Raid vault" },
        {
          value: "consumables",
          label: "Consumables",
          mobileLabel: "Raid vault · Consumables",
          parentValue: "raid",
        },
      ]}
      value={value}
      onChange={(item) => setValue(item.value)}
    />
  );
}

describe("EntityNavigator", () => {
  beforeEach(() => {
    responsive.compact = false;
  });

  it("uses one desktop entity tree instead of tabs or a duplicate Select", async () => {
    const user = userEvent.setup();
    render(<NavigatorHarness />);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Storage locations" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Main vault" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Materials" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Raid vault" }));

    expect(screen.queryByRole("button", { name: "Materials" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Consumables" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raid vault" })).toHaveAttribute("aria-current", "page");
  });

  it("uses the same item source in the compact Select", async () => {
    const user = userEvent.setup();
    responsive.compact = true;
    render(<NavigatorHarness />);

    expect(screen.queryByRole("navigation", { name: "Storage locations" })).not.toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: "Storage locations" });
    expect(select).toHaveTextContent("Main vault");

    await user.click(select);
    await user.click(await screen.findByText("Main vault · Materials"));

    expect(select).toHaveTextContent("Main vault · Materials");
  });
});
