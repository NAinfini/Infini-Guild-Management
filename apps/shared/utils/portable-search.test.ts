import { describe, expect, it } from "vitest";
import {
  escapeLikePattern,
  isPortableLikeSearch,
  isPortableLowercaseLikeSearch,
  lowercaseLikePattern,
} from "./portable-search";

describe("portable LIKE search", () => {
  it("measures the escaped UTF-8 pattern, including wildcard delimiters", () => {
    expect(escapeLikePattern("a%_\\b")).toBe("%a\\%\\_\\\\b%");
    expect(isPortableLikeSearch("界".repeat(16))).toBe(true);
    expect(isPortableLikeSearch("界".repeat(17))).toBe(false);
    expect(isPortableLikeSearch("%".repeat(24))).toBe(true);
    expect(isPortableLikeSearch("%".repeat(25))).toBe(false);
  });

  it("measures the final lowercase pattern rather than the source string", () => {
    expect(lowercaseLikePattern("İ")).toBe("%i̇%");
    expect(isPortableLowercaseLikeSearch("İ".repeat(16))).toBe(true);
    expect(isPortableLowercaseLikeSearch("İ".repeat(17))).toBe(false);
  });
});
