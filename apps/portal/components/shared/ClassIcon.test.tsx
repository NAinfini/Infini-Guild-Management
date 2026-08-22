import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClassIcon } from "./ClassIcon";

const baseItem = {
  label: "Warden",
  color: "#61B8AA",
  icon_type: "vector" as const,
  vector_icon: "shield" as const,
  icon_media_id: null,
};

describe("ClassIcon", () => {
  it("renders a named vector marker with the configured class color", () => {
    render(<ClassIcon item={baseItem} label="Warden class" />);

    const marker = screen.getByRole("img", { name: "Warden class" });
    expect(marker).toHaveStyle({ "--class-color": "#61B8AA" });
    expect(marker.querySelector("svg")).toBeInTheDocument();
  });

  it("uses the shared view route and does not invent a fallback when an image fails", () => {
    const { container, rerender } = render(
      <ClassIcon
        item={{
          ...baseItem,
          icon_type: "image",
          vector_icon: null,
          icon_media_id: "media1234567890abcdef",
        }}
        label="Warden class"
      />,
    );

    const image = container.querySelector("img");
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining("/api/media/media1234567890abcdef/view"),
    );
    fireEvent.error(image!);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();

    rerender(
      <ClassIcon
        item={{
          ...baseItem,
          icon_type: "image",
          vector_icon: null,
          icon_media_id: "image1234567890abcdef",
        }}
        label="Warden class"
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("/api/media/image1234567890abcdef/view"),
    );
  });
});
