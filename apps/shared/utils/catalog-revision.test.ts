import { describe, expect, it } from "vitest";
import { catalogRevisionToken } from "./catalog-revision";

describe("catalogRevisionToken", () => {
  it("changes for either the ordered position or a row revision", () => {
    const baseline = [
      { id: "warden", sort_order: 0, updated_at: "2026-08-26T00:00:00.000Z" },
      { id: "seer", sort_order: 10, updated_at: "2026-08-26T00:00:00.000Z" },
    ];

    expect(catalogRevisionToken(baseline)).not.toBe(catalogRevisionToken([...baseline].reverse()));
    expect(catalogRevisionToken(baseline)).not.toBe(catalogRevisionToken([
      baseline[0]!,
      { ...baseline[1]!, updated_at: "2026-08-26T00:00:00.001Z" },
    ]));
  });
});
