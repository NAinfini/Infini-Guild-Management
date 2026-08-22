// @vitest-environment node
import { describe, expect, it } from "vitest";
import { maskIdentifier } from "./admin";

describe("admin utils", () => {
  it("masks identifiers for non-admin viewers", () => {
    expect(maskIdentifier("1234567890", false)).toBe("1234***90");
    expect(maskIdentifier("abc", false)).toBe("a***");
    expect(maskIdentifier("1234567890", true)).toBe("1234567890");
  });
});
