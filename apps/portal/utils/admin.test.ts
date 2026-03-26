import { describe, expect, it } from "vitest";
import { formatAuditDiffHeader, maskIdentifier } from "./admin";

describe("admin utils", () => {
  it("masks identifiers for non-admin viewers", () => {
    expect(maskIdentifier("1234567890", false)).toBe("1234***90");
    expect(maskIdentifier("abc", false)).toBe("a***");
    expect(maskIdentifier("1234567890", true)).toBe("1234567890");
  });

  it("formats audit diff headers from title, json details, and long raw text", () => {
    expect(formatAuditDiffHeader("Updated role", null)).toBe("Updated role");
    expect(formatAuditDiffHeader(null, JSON.stringify({ field: "role", value: "moderator" }))).toBe(
      "field: role | value: moderator",
    );
    expect(formatAuditDiffHeader(null, "x".repeat(120))).toBe(`${"x".repeat(100)}...`);
  });
});
