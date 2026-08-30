import { CLASS_VECTOR_ICON_IDS } from "@guild/shared";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CLASS_GLYPH_PATHS, ClassGlyphIcon } from "./ClassGlyphIcon";

describe("ClassGlyphIcon", () => {
  it("provides one source-owned game glyph for every class icon id", () => {
    expect(Object.keys(CLASS_GLYPH_PATHS)).toEqual([...CLASS_VECTOR_ICON_IDS]);

    for (const iconId of CLASS_VECTOR_ICON_IDS) {
      expect(CLASS_GLYPH_PATHS[iconId]).toMatch(/^M/);
      expect(CLASS_GLYPH_PATHS[iconId].length).toBeGreaterThan(80);
    }
  });

  it("renders the selected glyph as a current-color SVG", () => {
    const { container } = render(<ClassGlyphIcon iconId="shield" size={32} />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("viewBox", "0 0 512 512");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveAttribute("height", "32");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg?.querySelector("path")).toHaveAttribute("d", CLASS_GLYPH_PATHS.shield);
  });
});
