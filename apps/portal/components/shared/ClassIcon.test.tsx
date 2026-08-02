// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClassIcon } from "./ClassIcon";

const baseItem = {
  label: "Warden",
  color: "#61B8AA",
  icon_type: "vector" as const,
  vector_icon: "shield" as const,
  icon_key: null,
};

describe("ClassIcon", () => {
  it("renders a named vector marker with the configured class color", () => {
    render(<ClassIcon item={baseItem} label="Warden class" />);

    const marker = screen.getByRole("img", { name: "Warden class" });
    expect(marker).toHaveStyle({ "--class-color": "#61B8AA" });
    expect(marker.querySelector("svg")).toBeInTheDocument();
  });

  it("falls back to the selected vector icon when a custom image fails", () => {
    const { container, rerender } = render(
      <ClassIcon
        item={{
          ...baseItem,
          icon_type: "image",
          icon_key: "class-icons/warden/custom.webp",
        }}
        label="Warden class"
      />,
    );

    const image = container.querySelector("img");
    expect(image).toBeInTheDocument();
    fireEvent.error(image!);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();

    rerender(
      <ClassIcon
        item={{
          ...baseItem,
          icon_type: "image",
          icon_key: "class-icons/warden/replacement.webp",
        }}
        label="Warden class"
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("replacement.webp"),
    );
  });
});
