import { describe, expect, it } from "vitest";
import { activeGame } from "../games";
import { CLASS_COLOR_GROUP, resolveClassDisplayColor } from "./classes";

describe("resolveClassDisplayColor", () => {
  it("uses the active game color mapping with a stable fallback", () => {
    const firstClass = activeGame.classes[0]!;
    expect(resolveClassDisplayColor(firstClass.id)).toBe(
      activeGame.classColorMapping[CLASS_COLOR_GROUP[firstClass.id]!],
    );
    expect(resolveClassDisplayColor("unknown-class")).toBe("yellow");
    expect(resolveClassDisplayColor(null, "gray")).toBe("gray");
  });
});
