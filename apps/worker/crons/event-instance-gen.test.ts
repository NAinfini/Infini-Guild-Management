import { describe, expect, it } from "vitest";
import { computeHorizon } from "./event-instance-gen";

describe("event instance generation horizon", () => {
  it("generates recurring event instances for the next 8 weeks", () => {
    const now = new Date("2026-05-03T00:00:00.000Z");

    expect(computeHorizon(now).toISOString()).toBe("2026-06-28T00:00:00.000Z");
  });
});
