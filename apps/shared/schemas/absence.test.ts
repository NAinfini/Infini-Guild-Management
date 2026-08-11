import { describe, expect, it } from "vitest";
import { absenceWindowQuerySchema } from "./absence";

describe("absenceWindowQuerySchema", () => {
  it("accepts the shared maximum window and rejects a wider query", () => {
    expect(absenceWindowQuerySchema.safeParse({ from: "2026-01-01", to: "2027-01-01" }).success).toBe(true);
    expect(absenceWindowQuerySchema.safeParse({ from: "2026-01-01", to: "2027-01-02" }).success).toBe(false);
  });
});
