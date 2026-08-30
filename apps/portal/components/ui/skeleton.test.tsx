import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("hides decorative content from assistive technology by default", () => {
    const { container } = render(<Skeleton className="h-10" />);
    const skeleton = container.firstElementChild;

    expect(skeleton).toHaveAttribute("data-slot", "skeleton");
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
  });

  it("allows an explicit accessibility override", () => {
    const { container } = render(<Skeleton aria-hidden={false} />);

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "false");
  });
});
