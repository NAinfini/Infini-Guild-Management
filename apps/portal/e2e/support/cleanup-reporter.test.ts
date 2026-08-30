import { describe, expect, it } from "vitest";
import { shouldCleanupManagedRunFiles } from "./cleanup-reporter";

describe("cleanup reporter ownership", () => {
  it("does not delete managed state for read-only Playwright listings", () => {
    expect(shouldCleanupManagedRunFiles(["node", "playwright", "test", "--list"])).toBe(false);
    expect(shouldCleanupManagedRunFiles(["node", "playwright", "test", "--list=true"])).toBe(false);
  });

  it("cleans managed state after an actual test run", () => {
    expect(shouldCleanupManagedRunFiles(["node", "playwright", "test"])).toBe(true);
  });
});
