import { describe, expect, it } from "vitest";
import { shouldApplyEtag } from "./etag";

describe("ETag middleware selection", () => {
  it("skips heavy aggregate and bulk JSON endpoints", () => {
    expect(shouldApplyEtag("/api/dashboard/summary", null)).toBe(false);
    expect(shouldApplyEtag("/api/search", null)).toBe(false);
    expect(shouldApplyEtag("/api/events/batch-details", null)).toBe(false);
    expect(shouldApplyEtag("/api/guild-war/history/batch", null)).toBe(false);
    expect(shouldApplyEtag("/api/admin/audit-log", null)).toBe(false);
  });

  it("skips responses with known large content length", () => {
    expect(shouldApplyEtag("/api/events", String(80 * 1024))).toBe(false);
  });

  it("keeps small normal JSON GET responses eligible", () => {
    expect(shouldApplyEtag("/api/events", "1024")).toBe(true);
  });
});
