import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionHeader } from "./SectionHeader";

describe("SectionHeader", () => {
  it("exposes the section title as a level-three heading", () => {
    render(<SectionHeader title="Media" trailing="3 / 10" />);

    expect(screen.getByRole("heading", { level: 3, name: "Media" })).toBeInTheDocument();
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
  });

  it("supports a page-level h2 without changing the default card heading", () => {
    render(<SectionHeader title="Class catalog" headingLevel={2} />);

    expect(screen.getByRole("heading", { level: 2, name: "Class catalog" })).toBeInTheDocument();
  });
});
